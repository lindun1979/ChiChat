import { NextRequest, NextResponse } from "next/server";

const MCP_URL = "https://mcp-global.cloud.chivox.com/mcp";

let cachedSession: { id: string; ts: number } | null = null;

async function createMcpSession(apiKey: string): Promise<string> {
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "chichat", version: "0.1.0" },
      },
    }),
  });

  const sessionId = res.headers.get("mcp-session-id");
  if (!sessionId) throw new Error("No MCP session ID");
  cachedSession = { id: sessionId, ts: Date.now() };
  return sessionId;
}

async function getMcpSession(apiKey: string): Promise<string> {
  if (cachedSession && Date.now() - cachedSession.ts < 3 * 60 * 1000) {
    return cachedSession.id;
  }
  return createMcpSession(apiKey);
}

async function callChivoxEval(apiKey: string, sessionId: string, refText: string, audioBase64: string, evalType: "word" | "sentence" = "sentence") {
  const toolName = evalType === "word" ? "cn_word_eval" : "cn_sentence_eval";
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Mcp-Session-Id": sessionId,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method: "tools/call",
      params: {
        name: toolName,
        arguments: { ref_text: refText, audio_base64: audioBase64, rank: 100 },
      },
    }),
  });

  const text = await res.text();
  if (text.startsWith("<") || !res.ok) {
    throw new Error("NON_JSON");
  }
  return JSON.parse(text);
}

export async function POST(req: NextRequest) {
  const chivoxKey = process.env.CHIVOX_MCP_API_KEY;
  if (!chivoxKey) {
    return NextResponse.json({ error: "CHIVOX_MCP_API_KEY not set" }, { status: 500 });
  }

  const body = await req.json();
  const { refText, audioBase64, type } = body;
  const evalType: "word" | "sentence" = type === "word" ? "word" : "sentence";

  if (!refText || !audioBase64) {
    return NextResponse.json({ error: "refText and audioBase64 required" }, { status: 400 });
  }

  console.log(`[chivox-eval] Received: refText="${refText}" type=${evalType}`);

  try {
    let sessionId = await getMcpSession(chivoxKey);
    let data;

    try {
      data = await callChivoxEval(chivoxKey, sessionId, refText, audioBase64, evalType);
    } catch (e) {
      if (e instanceof Error && e.message === "NON_JSON") {
        console.log("[chivox-eval] Stale session, retrying with fresh session...");
        cachedSession = null;
        sessionId = await createMcpSession(chivoxKey);
        try {
          data = await callChivoxEval(chivoxKey, sessionId, refText, audioBase64, evalType);
        } catch (e2) {
          console.error("[chivox-eval] Retry also failed:", e2 instanceof Error ? e2.message : e2);
          cachedSession = null;
          return NextResponse.json({ error: "Chivox evaluation failed" }, { status: 502 });
        }
      } else {
        console.error("[chivox-eval] ChiSheng error:", e instanceof Error ? e.message : e);
        cachedSession = null;
        return NextResponse.json({ error: "Chivox evaluation failed" }, { status: 502 });
      }
    }

    let fullResult;
    const textContent = data.result?.content?.[0]?.text;
    if (textContent) {
      try {
        fullResult = JSON.parse(textContent);
      } catch {
        console.error("[chivox-eval] Failed to parse:", textContent.substring(0, 200));
        return NextResponse.json({ error: "Chivox evaluation failed" }, { status: 502 });
      }
    }

    if (data.result?.isError || !fullResult?.result) {
      console.error("[chivox-eval] Chivox error:", textContent?.substring(0, 200));
      return NextResponse.json({ error: "Chivox evaluation failed" }, { status: 502 });
    }

    const result = fullResult.result;

    const audioBytes = Math.round(audioBase64.length * 3 / 4);
    console.log(`[chivox-eval] refText: "${refText}" type=${evalType} | audio: ${(audioBytes / 1024).toFixed(1)}KB | overall: ${result.overall} pron: ${result.pron} fluency: ${result.fluency?.overall} integrity: ${result.integrity}`);

    let wordScores;
    if (evalType === "word") {
      wordScores = [{ word: refText, score: result.overall ?? 0 }];
    } else {
      const details = result.details || [];
      wordScores = details.map((d: { char?: string; score?: number }) => ({
        word: d.char || "",
        score: d.score ?? 0,
      }));
    }

    const response = {
      overall: result.overall ?? 0,
      wordScores,
    };
    console.log(`[chivox-eval] Response: overall=${response.overall} words=${wordScores.length}`);
    return NextResponse.json(response);
  } catch (e: unknown) {
    console.error("[chivox-eval] Error:", e instanceof Error ? e.message : e);
    cachedSession = null;
    return NextResponse.json({ error: "Chivox evaluation failed" }, { status: 502 });
  }
}
