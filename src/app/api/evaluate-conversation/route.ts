import { NextRequest, NextResponse } from "next/server";
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
    return NextResponse.json({ error: `${missing} not set` }, { status: 500 });
  }

  const body: EvalRequestParams = await req.json();
  const { messages } = body;

  if (!messages?.length) {
    return NextResponse.json({ error: "No messages to evaluate" }, { status: 400 });
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

  try {
    let rawText: string;

    if (useGemini) {
      const ai = new GoogleGenAI({ apiKey: GOOGLE_KEY });
      const response = await ai.models.generateContent({
        model: LLM_MODEL,
        contents: prompt,
        config: {
          systemInstruction: "You are a Mandarin Chinese learning coach. Always respond in valid JSON.",
          temperature: 0.3,
          responseMimeType: "application/json",
        },
      });
      rawText = response.text?.trim() ?? "";
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
              content:
                "You are a Mandarin Chinese learning coach. Always respond in valid JSON.",
            },
            { role: "user", content: prompt },
          ],
          max_tokens: 16384,
          temperature: 0.3,
          response_format: { type: "json_object" },
        }),
      });

      const data = await res.json();
      const choice = data.choices?.[0];
      const msg = choice?.message;
      rawText = (msg?.content?.trim() || msg?.reasoning_content?.trim()) ?? "";

      if (choice?.finish_reason === "length") {
        console.error(`[evaluate] Response truncated (finish_reason=length), rawText length=${rawText.length}`);
        return NextResponse.json(
          { error: "LLM response truncated, please retry" },
          { status: 502 },
        );
      }
    }

    if (!rawText) {
      return NextResponse.json(
        { error: "Empty response from LLM" },
        { status: 502 },
      );
    }

    const cleaned = rawText.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();
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
    return NextResponse.json(result);
  } catch (e) {
    console.error(
      "[evaluate] Error:",
      e instanceof Error ? e.message : e,
    );
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
