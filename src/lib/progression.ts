export type Tier = 1 | 2 | 3 | 4;

export interface ConversationEvaluation {
  expressionTier: Tier;
  pronunciationScore?: number;
  suggestions: { said: string; better: string; reason: string }[];
  drillPhrases: string[];
  summary: string;
}

export interface DimensionFeedback {
  slotId: string;
  slotLabel: string;
  completed: boolean;
  strengths: string;
  improvements: string;
  weakWords?: { word: string; score: number; tip: string }[];
}

export interface EnrichedEvaluation extends ConversationEvaluation {
  encouragement: string;
  dimensionFeedback: DimensionFeedback[];
  generalFeedback?: string;
  pronunciationDetails: {
    weakWords: { word: string; score: number; ipa?: string; tip: string }[];
    overallComment: string;
  };
  targetedDrills: { phrase: string; reason: string; type?: "word" | "sentence" }[];
  tierImproved: boolean;
  priorTier: Tier;
  newTier: Tier;
}

export interface ScenarioProgress {
  scenarioId: string;
  currentTier: Tier;
  attempts: number;
  bestPronScore: number;
  consecutiveHighCount: number;
}

const STORAGE_KEY = "chichat-progress";

export function loadProgress(): Record<string, ScenarioProgress> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function saveProgress(progress: Record<string, ScenarioProgress>) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
}

export function updateProgress(
  scenarioId: string,
  evaluation: ConversationEvaluation,
): ScenarioProgress {
  const all = loadProgress();
  const prev = all[scenarioId] ?? {
    scenarioId,
    currentTier: 1 as Tier,
    attempts: 0,
    bestPronScore: 0,
    consecutiveHighCount: 0,
  };

  const next: ScenarioProgress = {
    ...prev,
    attempts: prev.attempts + 1,
  };

  if (evaluation.pronunciationScore != null && evaluation.pronunciationScore > next.bestPronScore) {
    next.bestPronScore = evaluation.pronunciationScore;
  }

  if (evaluation.expressionTier >= prev.currentTier + 1) {
    next.consecutiveHighCount = prev.consecutiveHighCount + 1;
  } else {
    next.consecutiveHighCount = 0;
  }

  if (next.consecutiveHighCount >= 2 && prev.currentTier < 4) {
    next.currentTier = (prev.currentTier + 1) as Tier;
    next.consecutiveHighCount = 0;
  }

  all[scenarioId] = next;
  saveProgress(all);
  return next;
}

export const TIER_LABELS: Record<Tier, string> = {
  1: "Beginner",
  2: "Basic",
  3: "Conversational",
  4: "Fluent",
};
