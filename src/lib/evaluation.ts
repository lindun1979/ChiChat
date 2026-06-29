import type { Tier, DimensionFeedback, EnrichedEvaluation } from "./progression";

export interface EvalMessage {
  role: "user" | "npc";
  text: string;
  pronOverall?: number;
  wordScores?: { word: string; score: number }[];
}

export interface EvalRequestParams {
  messages: EvalMessage[];
  scenarioTitle: string;
  taskObjective: string;
  slots: { id: string; label: string; icon: string }[];
  taskSlotValues: Record<string, string>;
  filledSlots: Record<string, string | undefined>;
  currentTier: Tier;
  scenarioId: string;
}

type ApiEvalResult = Omit<EnrichedEvaluation, "tierImproved" | "priorTier" | "newTier">;

const TIER_LABELS: Record<Tier, string> = {
  1: "Beginner — needs heavy assistance, mostly single words or silence",
  2: "Basic — completes task with keywords/fragments",
  3: "Conversational — uses complete sentences",
  4: "Fluent — natural Mandarin with good flow",
};

const TIER_FEEDBACK_DIRECTION: Record<Tier, string> = {
  1: `Focus on basic sentence patterns ("我要...", "请给我...", "可以...吗？"). Acknowledge any attempt positively. Drills MUST be short, simple phrases (3-6 characters max).`,
  2: `Guide toward complete sentences. Show how to expand keywords into full requests ("绿茶" → "我想要一壶绿茶"). Drills should be simple but complete sentences.`,
  3: `Guide toward more natural expressions. Suggest native-like alternatives with proper measure words and particles. Drills can be moderately complex.`,
  4: `Suggest culturally nuanced, native-like expressions. Point out use of 了/吧/呢 particles, proper register, and colloquial phrases. Drills can include colloquial or advanced phrasing.`,
};

function formatTranscript(messages: EvalMessage[]): string {
  return messages
    .map((m) => {
      if (m.role === "npc") return `NPC: ${m.text}`;
      const pronLabel = m.pronOverall != null ? ` (pron: ${m.pronOverall})` : "";
      if (m.wordScores?.length) {
        const scored = m.wordScores.map((ws) => `[${ws.word}:${ws.score}]`).join(" ");
        return `Learner${pronLabel}: ${scored}`;
      }
      return `Learner${pronLabel}: ${m.text}`;
    })
    .join("\n");
}

function findTaskCriticalWeakWords(
  messages: EvalMessage[],
  taskSlotValues: Record<string, string>,
  slots: { id: string; label: string }[],
): { word: string; score: number; slotId: string; slotLabel: string }[] {
  const targetWords = new Map<string, { slotId: string; slotLabel: string }>();
  for (const slot of slots) {
    const val = taskSlotValues[slot.id];
    if (!val) continue;
    for (const w of val.split(/\s+/)) {
      targetWords.set(w, { slotId: slot.id, slotLabel: slot.label });
    }
  }

  const results: { word: string; score: number; slotId: string; slotLabel: string }[] = [];
  const seen = new Set<string>();

  for (const m of messages) {
    if (m.role !== "user" || !m.wordScores) continue;
    for (const ws of m.wordScores) {
      const key = ws.word;
      if (ws.score < 70 && targetWords.has(key) && !seen.has(key)) {
        seen.add(key);
        const info = targetWords.get(key)!;
        results.push({ word: ws.word, score: ws.score, ...info });
      }
    }
  }
  return results.sort((a, b) => a.score - b.score);
}

export function buildEvaluationPrompt(params: EvalRequestParams): string {
  const {
    messages,
    scenarioTitle,
    taskObjective,
    slots,
    taskSlotValues,
    filledSlots,
    currentTier,
  } = params;

  const transcript = formatTranscript(messages);

  const userMessages = messages.filter((m) => m.role === "user");
  const pronScores = userMessages
    .map((m) => m.pronOverall)
    .filter((s): s is number => s != null);
  const avgPron =
    pronScores.length > 0
      ? Math.round(pronScores.reduce((a, b) => a + b, 0) / pronScores.length)
      : undefined;

  const dimensionLines = slots
    .map((s, i) => {
      const expected = taskSlotValues[s.id] || "N/A";
      const filled = filledSlots[s.id];
      const status = filled ? `"${filled}" ✓` : "(not completed) ✗";
      return `${i + 1}. ${s.id} (${s.label}) — expected: "${expected}" — filled: ${status}`;
    })
    .join("\n");

  const criticalWeakWords = findTaskCriticalWeakWords(messages, taskSlotValues, slots);
  const criticalSection =
    criticalWeakWords.length > 0
      ? `\n⚠ Task-critical words with LOW pronunciation scores:\n${criticalWeakWords
          .map(
            (w) =>
              `- "${w.word}" (score: ${w.score}) — task dimension: ${w.slotId} (${w.slotLabel})`,
          )
          .join("\n")}\n→ These MUST be prioritized in your feedback and drills.`
      : "";

  return `You are a Mandarin Chinese learning coach. Analyze this conversation between a learner and an NPC in a "${scenarioTitle}" scenario.

Task objective: ${taskObjective}

Conversation transcript (numbers in [word:score] are Chivox pronunciation scores, 0-100):
${transcript}

${avgPron != null ? `Average pronunciation score: ${avgPron}/100` : "No pronunciation data available."}

Task dimensions (${slots.length} slots):
${dimensionLines}
${criticalSection}

TIER RUBRIC — evaluate expressionTier based on THIS conversation ONLY:
- Tier 1 (Beginner): Learner mostly silent, used only isolated words, or failed to communicate intent in Chinese
- Tier 2 (Basic): Learner communicated with keywords/fragments but not complete sentences ("绿茶", "一斤", "微信")
- Tier 3 (Conversational): Learner used complete sentences to accomplish the task ("我想要一壶绿茶", "请给我一斤西红柿")
- Tier 4 (Fluent): Learner used natural Mandarin with proper measure words, particles, and flow ("来一壶龙井吧，再配点花生")

CRITICAL: Evaluate expressionTier INDEPENDENTLY based on the conversation above. Do NOT anchor to the history tier below. A learner at history tier 1 CAN perform at tier 3 or 4 in this conversation.

Learner's history tier (for adapting feedback style only, NOT for evaluation): ${currentTier}

Feedback style direction:
${TIER_FEEDBACK_DIRECTION[currentTier as Tier]}

FEEDBACK PRIORITY (strict order):
1. Task dimension completion — for each slot, what did they do well / what needs improvement?
2. Task-critical word pronunciation — words in task dimensions with low Chivox scores (below 70)
3. General pronunciation — other low-scoring words
4. Expression upgrades — more natural/idiomatic alternatives

IMPORTANT evaluation principles:
- BARGE-IN is NOT a weakness. Interrupting the NPC mid-sentence is natural conversational behavior. Evaluate CONTENT, not timing.
- TASK COMPLETION matters most. Equivalent expressions count ("我用手机付" = paying by WeChat/Alipay).
- Use the CORRECTED transcript above as the basis for all evaluation. The text shown IS what the learner intended to say.
- When a word has a low Chivox score, it means the learner's PRONUNCIATION of that word was unclear — comment on the sound, not the vocabulary choice.
- If the learner used COMPLETE SENTENCES and accomplished the task, expressionTier MUST be at least 3.
- Drills MUST match the learner's tier level. ${currentTier <= 2 ? "Keep drills SHORT and SIMPLE (3-6 characters for words, 5-10 characters for sentences)." : "Drills can be moderately complex."}
- Pay attention to Mandarin-specific aspects: measure words (量词), sentence-final particles (了/吧/呢/吗), and word order.

Respond in JSON with this exact schema:
{
  "expressionTier": <1|2|3|4>,
  "summary": "<2-3 sentence evaluation in English, acknowledge strengths first>",
  "encouragement": "<1-2 sentence encouragement in English, appropriate for their tier level>",
  "dimensionFeedback": [
    {
      "slotId": "<slot id>",
      "slotLabel": "<slot label>",
      "completed": <true|false>,
      "strengths": "<what they did well for this dimension, in English>",
      "improvements": "<what could improve, in English. Empty string if nothing to improve>",
      "weakWords": [{"word": "<Chinese word>", "score": <chivox score>, "tip": "<pronunciation tip in English with pinyin>"}]
    }
  ],
  "generalFeedback": "<feedback on aspects beyond task dimensions, in English. null if nothing notable>",
  "pronunciationDetails": {
    "overallComment": "<overall pronunciation assessment in English>",
    "weakWords": [{"word": "<Chinese word>", "score": <score>, "ipa": "<pinyin with tones>", "tip": "<pronunciation tip in English>"}]
  },
  "suggestions": [{"said": "<what learner said in Chinese>", "better": "<better alternative in Chinese>", "reason": "<why, in English>"}],
  "targetedDrills": [{"type": "word|sentence", "phrase": "<the Chinese word or sentence to practice>", "reason": "<why this drill, in English>"}]
}

Output rules:
- dimensionFeedback: one entry per task dimension, in the same order as listed above
- suggestions: 1-3 items. If learner spoke well, suggest more natural/idiomatic alternatives for growth
- targetedDrills: 2-5 items. Each must target a specific weakness identified above
  - type "word": phrase is a SINGLE CHINESE WORD the learner mispronounced (e.g., "茉莉花茶")
  - type "sentence": phrase is a REAL USAGE SENTENCE containing weak words (e.g., "我想要一壶茉莉花茶")
  - NEVER use instructional format like "Can you say X?" or "Repeat after me: X"
- pronunciationDetails.weakWords: only words with Chivox score below 70
- Output valid JSON only, no markdown fences`;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isValidDimensionFeedback(v: unknown): v is DimensionFeedback {
  if (!isRecord(v)) return false;
  return (
    typeof v.slotId === "string" &&
    typeof v.slotLabel === "string" &&
    typeof v.completed === "boolean" &&
    typeof v.strengths === "string" &&
    typeof v.improvements === "string"
  );
}

function isValidWeakWord(
  v: unknown,
): v is { word: string; score: number; ipa?: string; tip: string } {
  if (!isRecord(v)) return false;
  return (
    typeof v.word === "string" && typeof v.score === "number" && typeof v.tip === "string"
  );
}

function isValidDrill(v: unknown): v is { phrase: string; reason: string; type?: string } {
  if (!isRecord(v)) return false;
  return typeof v.phrase === "string" && typeof v.reason === "string";
}

function isValidSuggestion(
  v: unknown,
): v is { said: string; better: string; reason: string } {
  if (!isRecord(v)) return false;
  return (
    typeof v.said === "string" && typeof v.better === "string" && typeof v.reason === "string"
  );
}

function generateFallbackDrills(
  messages: EvalMessage[],
  taskSlotValues: Record<string, string>,
  slots: { id: string; label: string }[],
  currentTier: number,
): { phrase: string; reason: string; type: "word" | "sentence" }[] {
  const criticalWords = findTaskCriticalWeakWords(messages, taskSlotValues, slots);
  if (criticalWords.length === 0) return [];

  const drills: { phrase: string; reason: string; type: "word" | "sentence" }[] = [];
  for (const w of criticalWords.slice(0, 3)) {
    drills.push({ phrase: w.word, type: "word", reason: `Practice pronouncing "${w.word}" (score: ${w.score})` });
    const simple = currentTier <= 2;
    const sentence = simple
      ? `我要${w.word}`
      : `请给我${w.word}，谢谢`;
    drills.push({ phrase: sentence, type: "sentence", reason: `Practice "${w.word}" in a sentence` });
  }
  return drills.slice(0, 5);
}

export function normalizeEvalResponse(
  raw: unknown,
  avgPron?: number,
  params?: {
    messages?: EvalMessage[];
    taskSlotValues?: Record<string, string>;
    slots?: { id: string; label: string }[];
    currentTier?: number;
  },
): Omit<EnrichedEvaluation, "tierImproved" | "priorTier" | "newTier"> {
  const r = isRecord(raw) ? raw : {};

  const rawTier = typeof r.expressionTier === "number" ? r.expressionTier : 2;
  const expressionTier = Math.max(1, Math.min(4, Math.round(rawTier))) as Tier;

  const dimensionFeedback = Array.isArray(r.dimensionFeedback)
    ? (r.dimensionFeedback.filter(isValidDimensionFeedback) as DimensionFeedback[])
    : [];

  for (const df of dimensionFeedback) {
    if (Array.isArray(df.weakWords)) {
      df.weakWords = df.weakWords.filter(isValidWeakWord);
    }
  }

  const pronWeakWords = isRecord(r.pronunciationDetails)
    ? Array.isArray((r.pronunciationDetails as Record<string, unknown>).weakWords)
      ? ((r.pronunciationDetails as Record<string, unknown>).weakWords as unknown[])
          .filter(isValidWeakWord)
          .slice(0, 5)
      : []
    : [];

  const pronComment = isRecord(r.pronunciationDetails)
    ? typeof (r.pronunciationDetails as Record<string, unknown>).overallComment === "string"
      ? ((r.pronunciationDetails as Record<string, unknown>).overallComment as string)
      : ""
    : "";

  const suggestions = Array.isArray(r.suggestions)
    ? (r.suggestions as unknown[]).filter(isValidSuggestion).slice(0, 3)
    : [];

  let targetedDrills = Array.isArray(r.targetedDrills)
    ? (r.targetedDrills as unknown[]).filter(isValidDrill).slice(0, 5).map((d) => {
        const drill = d as { phrase: string; reason: string; type?: string };
        const drillType = drill.type === "word" ? "word" as const : "sentence" as const;
        return { phrase: drill.phrase, reason: drill.reason, type: drillType };
      })
    : [];

  let drillPhrases = targetedDrills.map((d) => d.phrase);

  if (drillPhrases.length === 0 && Array.isArray(r.drillPhrases)) {
    drillPhrases = (r.drillPhrases as unknown[])
      .filter((p): p is string => typeof p === "string")
      .slice(0, 5);
    targetedDrills = drillPhrases.map((p) => ({
      phrase: p, reason: "", type: "sentence" as const,
    }));
  }

  if (
    drillPhrases.length === 0 &&
    params?.messages &&
    params?.taskSlotValues &&
    params?.slots
  ) {
    const fallback = generateFallbackDrills(
      params.messages,
      params.taskSlotValues,
      params.slots,
      params.currentTier ?? 2,
    );
    targetedDrills = fallback;
    drillPhrases = fallback.map((d) => d.phrase);
  }

  return {
    expressionTier,
    pronunciationScore: avgPron,
    summary: typeof r.summary === "string" && r.summary ? r.summary : "Evaluation complete.",
    encouragement: typeof r.encouragement === "string" ? r.encouragement : "",
    dimensionFeedback,
    generalFeedback:
      typeof r.generalFeedback === "string" && r.generalFeedback
        ? r.generalFeedback
        : undefined,
    pronunciationDetails: {
      weakWords: pronWeakWords as {
        word: string;
        score: number;
        ipa?: string;
        tip: string;
      }[],
      overallComment: pronComment,
    },
    suggestions: suggestions as { said: string; better: string; reason: string }[],
    targetedDrills: targetedDrills as { phrase: string; reason: string }[],
    drillPhrases,
  };
}

export { findTaskCriticalWeakWords };
