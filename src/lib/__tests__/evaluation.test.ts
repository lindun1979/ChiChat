import { describe, it, expect } from "vitest";
import {
  buildEvaluationPrompt,
  normalizeEvalResponse,
  findTaskCriticalWeakWords,
  type EvalRequestParams,
  type EvalMessage,
} from "../evaluation";

const CAFE_SLOTS = [
  { id: "drink", label: "Drink", icon: "☕" },
  { id: "size", label: "Size", icon: "M" },
  { id: "milk_type", label: "Milk", icon: "🥛" },
  { id: "payment", label: "Pay", icon: "💳" },
];

const TASK_SLOT_VALUES = {
  drink: "espresso",
  size: "small",
  milk_type: "skim",
  payment: "cash",
};

const SAMPLE_MESSAGES: EvalMessage[] = [
  { role: "npc", text: "Welcome! What can I get for you?" },
  {
    role: "user",
    text: "I would like a small espresso with skim milk",
    pronOverall: 84,
    wordScores: [
      { word: "I", score: 95 },
      { word: "would", score: 92 },
      { word: "like", score: 90 },
      { word: "a", score: 88 },
      { word: "small", score: 85 },
      { word: "espresso", score: 38 },
      { word: "with", score: 90 },
      { word: "skim", score: 42 },
      { word: "milk", score: 90 },
    ],
  },
  { role: "npc", text: "One small espresso with skim milk. That'll be $3.50." },
];

function makeParams(overrides?: Partial<EvalRequestParams>): EvalRequestParams {
  return {
    messages: SAMPLE_MESSAGES,
    scenarioTitle: "咖啡馆点单",
    taskObjective: "Order a small espresso with skim milk, pay by cash",
    slots: CAFE_SLOTS,
    taskSlotValues: TASK_SLOT_VALUES,
    filledSlots: { drink: "espresso", size: "small", milk_type: "skim" },
    currentTier: 2 as const,
    scenarioId: "cafe",
    ...overrides,
  };
}

describe("findTaskCriticalWeakWords", () => {
  it("finds task-critical words with low scores", () => {
    const result = findTaskCriticalWeakWords(SAMPLE_MESSAGES, TASK_SLOT_VALUES, CAFE_SLOTS);
    expect(result).toHaveLength(2);
    expect(result[0].word).toBe("espresso");
    expect(result[0].score).toBe(38);
    expect(result[0].slotId).toBe("drink");
    expect(result[1].word).toBe("skim");
    expect(result[1].score).toBe(42);
  });

  it("ignores words with score >= 70", () => {
    const msgs: EvalMessage[] = [
      {
        role: "user",
        text: "espresso",
        wordScores: [{ word: "espresso", score: 75 }],
      },
    ];
    const result = findTaskCriticalWeakWords(msgs, TASK_SLOT_VALUES, CAFE_SLOTS);
    expect(result).toHaveLength(0);
  });

  it("ignores non-task words", () => {
    const msgs: EvalMessage[] = [
      {
        role: "user",
        text: "please",
        wordScores: [{ word: "please", score: 30 }],
      },
    ];
    const result = findTaskCriticalWeakWords(msgs, TASK_SLOT_VALUES, CAFE_SLOTS);
    expect(result).toHaveLength(0);
  });

  it("deduplicates across messages", () => {
    const msgs: EvalMessage[] = [
      { role: "user", text: "espresso", wordScores: [{ word: "espresso", score: 38 }] },
      { role: "user", text: "espresso", wordScores: [{ word: "espresso", score: 40 }] },
    ];
    const result = findTaskCriticalWeakWords(msgs, TASK_SLOT_VALUES, CAFE_SLOTS);
    expect(result).toHaveLength(1);
  });
});

describe("buildEvaluationPrompt", () => {
  it("includes user message content in transcript", () => {
    const prompt = buildEvaluationPrompt(makeParams());
    expect(prompt).toContain("[espresso:38]");
    expect(prompt).toContain("[skim:42]");
    expect(prompt).toContain("Learner (pron: 84):");
  });

  it("uses plain text when no wordScores", () => {
    const msgs: EvalMessage[] = [
      { role: "user", text: "I would like espresso", pronOverall: 80 },
    ];
    const prompt = buildEvaluationPrompt(makeParams({ messages: msgs }));
    expect(prompt).toContain("I would like espresso");
  });

  it("includes word-level scores in [word:score] format", () => {
    const prompt = buildEvaluationPrompt(makeParams());
    expect(prompt).toContain("[espresso:38]");
    expect(prompt).toContain("[skim:42]");
    expect(prompt).toContain("[milk:90]");
  });

  it("marks task-critical low-score words", () => {
    const prompt = buildEvaluationPrompt(makeParams());
    expect(prompt).toContain("Task-critical words with LOW pronunciation scores");
    expect(prompt).toContain('"espresso" (score: 38) — task dimension: drink');
    expect(prompt).toContain('"skim" (score: 42) — task dimension: milk_type');
  });

  it("includes taskSlotValues and filledSlots", () => {
    const prompt = buildEvaluationPrompt(makeParams());
    expect(prompt).toContain('expected: "espresso"');
    expect(prompt).toContain('expected: "cash"');
    expect(prompt).toContain("(not completed) ✗");
  });

  it("adapts instructions to currentTier", () => {
    const tier1 = buildEvaluationPrompt(makeParams({ currentTier: 1 }));
    expect(tier1).toContain("basic sentence patterns");
    expect(tier1).toContain("SHORT and SIMPLE");

    const tier4 = buildEvaluationPrompt(makeParams({ currentTier: 4 }));
    expect(tier4).toContain("culturally nuanced");
    expect(tier4).toContain("moderately complex");
  });

  it("includes anti-anchoring instruction for tier evaluation", () => {
    const prompt = buildEvaluationPrompt(makeParams({ currentTier: 1 }));
    expect(prompt).toContain("Evaluate expressionTier INDEPENDENTLY");
    expect(prompt).toContain("for adapting feedback style only");
    expect(prompt).not.toContain("Current learner tier:");
  });

  it("includes tier rubric", () => {
    const prompt = buildEvaluationPrompt(makeParams());
    expect(prompt).toContain("TIER RUBRIC");
    expect(prompt).toContain("Tier 1 (Beginner)");
    expect(prompt).toContain("Tier 3 (Conversational)");
    expect(prompt).toContain("complete sentences");
  });

  it("does not include icon in prompt", () => {
    const prompt = buildEvaluationPrompt(makeParams());
    expect(prompt).not.toContain("☕");
    expect(prompt).not.toContain("🥛");
  });

  it("omits critical section when no weak task words", () => {
    const msgs: EvalMessage[] = [
      { role: "npc", text: "Hello" },
      {
        role: "user",
        text: "espresso",
        pronOverall: 90,
        wordScores: [{ word: "espresso", score: 85 }],
      },
    ];
    const prompt = buildEvaluationPrompt(makeParams({ messages: msgs }));
    expect(prompt).not.toContain("Task-critical words with LOW");
  });
});

describe("normalizeEvalResponse", () => {
  const VALID_RESPONSE = {
    expressionTier: 2,
    summary: "你的表达不错。",
    encouragement: "继续加油！",
    dimensionFeedback: [
      {
        slotId: "drink",
        slotLabel: "饮品",
        completed: true,
        strengths: "成功点单",
        improvements: "发音需加强",
        weakWords: [{ word: "espresso", score: 38, tip: "注意重音" }],
      },
    ],
    pronunciationDetails: {
      overallComment: "整体发音良好",
      weakWords: [{ word: "espresso", score: 38, ipa: "/eˈspresəʊ/", tip: "重音在第二音节" }],
    },
    suggestions: [{ said: "small espresso", better: "a small espresso, please", reason: "更礼貌" }],
    targetedDrills: [
      { phrase: "I'd like an espresso, please.", reason: "练习 espresso 发音" },
    ],
  };

  it("passes through valid response", () => {
    const result = normalizeEvalResponse(VALID_RESPONSE, 84);
    expect(result.expressionTier).toBe(2);
    expect(result.pronunciationScore).toBe(84);
    expect(result.summary).toBe("你的表达不错。");
    expect(result.dimensionFeedback).toHaveLength(1);
    expect(result.targetedDrills).toHaveLength(1);
    expect(result.drillPhrases).toEqual(["I'd like an espresso, please."]);
  });

  it("clamps expressionTier to 1-4", () => {
    expect(normalizeEvalResponse({ expressionTier: 0 }).expressionTier).toBe(1);
    expect(normalizeEvalResponse({ expressionTier: 5 }).expressionTier).toBe(4);
    expect(normalizeEvalResponse({ expressionTier: 2.7 }).expressionTier).toBe(3);
  });

  it("provides defaults for missing fields", () => {
    const result = normalizeEvalResponse({});
    expect(result.expressionTier).toBe(2);
    expect(result.summary).toBe("Evaluation complete.");
    expect(result.encouragement).toBe("");
    expect(result.dimensionFeedback).toEqual([]);
    expect(result.pronunciationDetails.weakWords).toEqual([]);
    expect(result.pronunciationDetails.overallComment).toBe("");
    expect(result.suggestions).toEqual([]);
    expect(result.targetedDrills).toEqual([]);
    expect(result.drillPhrases).toEqual([]);
  });

  it("handles null/undefined input", () => {
    const result = normalizeEvalResponse(null);
    expect(result.expressionTier).toBe(2);
    expect(result.summary).toBe("Evaluation complete.");
  });

  it("filters invalid dimensionFeedback items", () => {
    const result = normalizeEvalResponse({
      dimensionFeedback: [
        { slotId: "drink", slotLabel: "饮品", completed: true, strengths: "好", improvements: "" },
        { slotId: 123 },
        "not an object",
        null,
      ],
    });
    expect(result.dimensionFeedback).toHaveLength(1);
    expect(result.dimensionFeedback[0].slotId).toBe("drink");
  });

  it("filters invalid weakWords items", () => {
    const result = normalizeEvalResponse({
      pronunciationDetails: {
        overallComment: "ok",
        weakWords: [
          { word: "espresso", score: 38, tip: "注意" },
          { word: "bad", score: "not a number", tip: "x" },
          null,
        ],
      },
    });
    expect(result.pronunciationDetails.weakWords).toHaveLength(1);
  });

  it("filters invalid targetedDrills items", () => {
    const result = normalizeEvalResponse({
      targetedDrills: [
        { phrase: "Good drill.", reason: "test" },
        { phrase: 123 },
        null,
      ],
    });
    expect(result.targetedDrills).toHaveLength(1);
    expect(result.drillPhrases).toEqual(["Good drill."]);
  });

  it("derives drillPhrases from targetedDrills", () => {
    const result = normalizeEvalResponse({
      targetedDrills: [
        { phrase: "A", reason: "r1", type: "word" },
        { phrase: "B", reason: "r2", type: "sentence" },
      ],
    });
    expect(result.drillPhrases).toEqual(["A", "B"]);
    expect(result.targetedDrills[0].type).toBe("word");
    expect(result.targetedDrills[1].type).toBe("sentence");
  });

  it("defaults drill type to sentence when missing", () => {
    const result = normalizeEvalResponse({
      targetedDrills: [
        { phrase: "Test phrase", reason: "test" },
      ],
    });
    expect(result.targetedDrills[0].type).toBe("sentence");
  });

  it("falls back to raw drillPhrases if targetedDrills empty", () => {
    const result = normalizeEvalResponse({
      targetedDrills: [],
      drillPhrases: ["fallback phrase 1", "fallback phrase 2"],
    });
    expect(result.drillPhrases).toEqual(["fallback phrase 1", "fallback phrase 2"]);
    expect(result.targetedDrills).toHaveLength(2);
  });

  it("generates fallback drills from low-score task words if both empty", () => {
    const result = normalizeEvalResponse({}, undefined, {
      messages: SAMPLE_MESSAGES,
      taskSlotValues: TASK_SLOT_VALUES,
      slots: CAFE_SLOTS,
      currentTier: 2,
    });
    expect(result.targetedDrills.length).toBeGreaterThan(0);
    expect(result.drillPhrases.length).toBeGreaterThan(0);
    expect(result.targetedDrills[0].phrase).toBe("espresso");
    expect(result.targetedDrills[0].type).toBe("word");
  });

  it("generates both word and sentence fallback drills", () => {
    const result = normalizeEvalResponse({}, undefined, {
      messages: SAMPLE_MESSAGES,
      taskSlotValues: TASK_SLOT_VALUES,
      slots: CAFE_SLOTS,
      currentTier: 1,
    });
    const types = result.targetedDrills.map((d) => d.type);
    expect(types).toContain("word");
    expect(types).toContain("sentence");
    const sentenceDrill = result.targetedDrills.find((d) => d.type === "sentence");
    expect(sentenceDrill?.phrase).toContain("我要");
  });

  it("does not include tierImproved/priorTier/newTier", () => {
    const result = normalizeEvalResponse(VALID_RESPONSE);
    expect("tierImproved" in result).toBe(false);
    expect("priorTier" in result).toBe(false);
    expect("newTier" in result).toBe(false);
  });
});
