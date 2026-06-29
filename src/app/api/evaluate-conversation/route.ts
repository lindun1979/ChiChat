import { NextRequest } from "next/server";
import { GoogleGenAI } from "@google/genai";
import {
  buildEvaluationPrompt,
  normalizeEvalResponse,
  type EvalRequestParams,
} from "@/lib/evaluation";

const LLM_BASE = process.env.LLM_BASE_URL;
const LLM_KEY = process.env.LLM_API_KEY;
const LLM_MODEL = process.env.LLM_MODEL || "gemini-2.5-flash";
const GOOGLE_KEY = process.env.GOOGLE_AI_API_KEY || "";

const useGemini = !LLM_BASE;

export async function POST(req: NextRequest) {
  const apiKey = useGemini ? GOOGLE_KEY : LLM_KEY;
  if (!apiKey) {
    const missing = useGemini ? "GOOGLE_AI_API_KEY" : "LLM_API_KEY";
    return new Response(JSON.stringify({ error: `${missing} not set` }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const body: EvalRequestParams = await req.json();
  const { messages } = body;

  if (!messages?.length) {
    return new Response(JSON.stringify({ error: "No messages to evaluate" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const userMessages = messages.filter((m) => m.role === "user");
  const pronScores = userMessages
    .map((m) => m.pronOverall)
    .filter((s): s is number => s != null);
  const avgPron =
    pronScores.length > 0
      ? Math.round(pronScores.reduce((a, b) => a + b, 0) / pronScores.length)
      : undefined;

  const prompt = buildEvaluationPrompt(body);

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      let fullText = "";

      try {
        if (useGemini) {
          const ai = new GoogleGenAI({ apiKey: GOOGLE_KEY });
          const response = await ai.models.generateContentStream({
            model: LLM_MODEL,
            contents: prompt,
            config: {
              systemInstruction: "You are a Mandarin Chinese learning coach. Always respond in valid JSON.",
              temperature: 0.3,
              responseMimeType: "application/json",
            },
          });

          for await (const chunk of response) {
            const text = chunk.text ?? "";
            if (text) {
              fullText += text;
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ chunk: text })}\n\n`));
            }
          }
        } else {
          const res = await fetch(`${LLM_BASE}/chat/completions`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${LLM_KEY}`,
            },
            body: JSON.stringify({
              model: LLM_MODEL,
              messages: [
                {
                  role: "system",
                  content: "You are a Mandarin Chinese learning coach. Always respond in valid JSON.",
                },
                { role: "user", content: prompt },
              ],
              max_tokens: 16384,
              temperature: 0.3,
              stream: true,
            }),
          });

          if (!res.ok || !res.body) {
            const errText = await res.text();
            console.error("[evaluate] LLM error:", res.status, errText);
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: "LLM request failed" })}\n\n`));
            controller.close();
            return;
          }

          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed.startsWith("data: ")) continue;
              const payload = trimmed.slice(6);
              if (payload === "[DONE]") continue;

              try {
                const parsed = JSON.parse(payload);
                const delta = parsed.choices?.[0]?.delta;
                const text = delta?.content ?? delta?.reasoning_content ?? "";
                if (text) {
                  fullText += text;
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ chunk: text })}\n\n`));
                }
              } catch {
                // skip malformed SSE lines
              }
            }
          }
        }

        if (!fullText.trim()) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: "Empty response from LLM" })}\n\n`));
          controller.close();
          return;
        }

        const cleaned = fullText.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();
        const parsed: unknown = JSON.parse(cleaned);
        const result = normalizeEvalResponse(parsed, avgPron, {
          messages: body.messages,
          taskSlotValues: body.taskSlotValues,
          slots: body.slots,
          currentTier: body.currentTier,
        });

        console.log(
          `[evaluate] tier=${result.expressionTier} pron=${avgPron ?? "N/A"} dims=${result.dimensionFeedback.length} drills=${result.targetedDrills.length}`,
        );

        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ result })}\n\n`));
      } catch (e) {
        console.error("[evaluate] Error:", e instanceof Error ? e.message : e);
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ error: e instanceof Error ? e.message : String(e) })}\n\n`),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
