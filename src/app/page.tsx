"use client";

import { useRef, useEffect, useState } from "react";
import { useGeminiLive, type TranscriptMessage, type WordScore } from "@/hooks/useGeminiLive";
import type { SlotValues } from "@/lib/scenarios";
import { SCENARIOS, SCENARIO_LIST, type ScenarioConfig } from "@/lib/scenarios";
import { generateRandomTask, type Task } from "@/lib/task-generator";
import {
  type ConversationEvaluation,
  type EnrichedEvaluation,
  type DimensionFeedback,
  type ScenarioProgress,
  type Tier,
  loadProgress,
  updateProgress,
  TIER_LABELS,
} from "@/lib/progression";
import DrillView from "@/components/DrillView";

function scoreColor(score: number): string {
  if (score >= 80) return "#22c55e";
  if (score >= 60) return "#84cc16";
  if (score >= 40) return "#f97316";
  return "#ef4444";
}

function ColoredWords({ wordScores }: { wordScores: WordScore[] }) {
  return (
    <span>
      {wordScores.map((ws, i) => (
        <span key={i}>
          <span style={{ color: scoreColor(ws.score), fontWeight: 500 }}>{ws.word}</span>
          {i < wordScores.length - 1 && " "}
        </span>
      ))}
    </span>
  );
}

function tryParsePartialJson(text: string): Partial<EnrichedEvaluation> | null {
  const cleaned = text.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();
  if (!cleaned.startsWith("{")) return null;
  const closers = ["}", "]}", "]}}", "]}]}}", '"}}}', '"}}', '"}'];
  for (const closer of closers) {
    try {
      const obj = JSON.parse(cleaned + closer);
      if (obj && typeof obj === "object") return obj;
    } catch { /* continue */ }
  }
  try {
    const obj = JSON.parse(cleaned);
    if (obj && typeof obj === "object") return obj;
  } catch { /* not parseable yet */ }
  return null;
}

type Phase = "select" | "briefing" | "dialogue" | "review" | "coaching" | "drill";

function SceneBackground({ scenario }: { scenario: ScenarioConfig }) {
  return (
    <>
      <div
        className={`absolute inset-0 bg-cover bg-center ${scenario.theme.bgFallback}`}
        style={{ backgroundImage: `url(${scenario.bgImage})` }}
      />
      <div className={`absolute inset-0 bg-gradient-to-t ${scenario.theme.gradientFrom} ${scenario.theme.gradientVia} ${scenario.theme.gradientTo}`} />
    </>
  );
}

function ScenarioSelectView({ onSelect }: { onSelect: (id: string) => void }) {
  const [progress, setProgress] = useState<Record<string, ScenarioProgress>>({});
  useEffect(() => { setProgress(loadProgress()); }, []);

  return (
    <div className="h-full flex flex-col items-center justify-center px-6">
      <h1 className="text-2xl font-bold text-white mb-2">Mandarin Voice Coach</h1>
      <p className="text-white/60 text-sm mb-8">Choose a scenario to start practicing</p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-2xl w-full">
        {SCENARIO_LIST.map((s) => {
          const p = progress[s.id];
          return (
            <button
              key={s.id}
              onClick={() => onSelect(s.id)}
              className="group bg-white/10 backdrop-blur-md hover:bg-white/20 rounded-2xl p-6 text-left transition-all duration-200 hover:scale-[1.02] border border-white/10 hover:border-white/20"
            >
              <span className="text-4xl block mb-3">{s.icon}</span>
              <h3 className="text-white font-bold text-base mb-1">{s.title}</h3>
              <span className={`text-xs font-medium ${s.theme.tagText} ${s.theme.tagBg} px-2 py-0.5 rounded inline-block mb-2`}>
                {s.levelTag}
              </span>
              {p && (
                <div className="mt-2 space-y-1">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 bg-white/10 rounded-full h-1.5">
                      <div
                        className="bg-green-400 rounded-full h-1.5 transition-all"
                        style={{ width: `${(p.currentTier / 4) * 100}%` }}
                      />
                    </div>
                    <span className="text-xs text-white/60">{TIER_LABELS[p.currentTier]}</span>
                  </div>
                  <p className="text-white/40 text-[10px]">
                    Practiced {p.attempts} time{p.attempts !== 1 ? "s" : ""}{p.bestPronScore > 0 ? ` · Best: ${p.bestPronScore}` : ""}
                  </p>
                </div>
              )}
              <p className="text-white/50 text-xs mt-1">{s.description}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function BriefingView({
  scenario,
  task,
  onStart,
}: {
  scenario: ScenarioConfig;
  task: Task;
  onStart: () => void;
}) {
  const t = scenario.theme;
  return (
    <div className="relative z-10 h-full flex items-center justify-center px-6">
      <div className="max-w-md w-full bg-white/95 backdrop-blur-md rounded-2xl shadow-2xl overflow-hidden">
        <div className={`bg-gradient-to-r ${t.headerBg} px-6 py-5 border-b ${t.headerBorder}`}>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-2xl">{scenario.icon}</span>
            <span className={`text-xs font-medium ${t.tagText} ${t.tagBg} px-2 py-0.5 rounded`}>
              {scenario.levelTag}
            </span>
          </div>
          <h1 className="text-lg font-bold text-gray-900 mt-2">
            Task: {task.objective}
          </h1>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div>
            <h3 className="text-xs font-medium text-gray-500 mb-2">Skills</h3>
            <div className="flex flex-wrap gap-1.5">
              {scenario.skills.map((skill) => (
                <span
                  key={skill}
                  className="text-xs bg-blue-50 text-blue-700 px-2.5 py-1 rounded-full"
                >
                  {skill}
                </span>
              ))}
            </div>
          </div>

          <div>
            <h3 className="text-xs font-medium text-gray-500 mb-2">Completion Criteria</h3>
            <div className="space-y-1">
              {scenario.completionCriteria(task.slotValues).map((c, i) => (
                <div key={i} className="flex items-center gap-2 text-sm text-gray-700">
                  <span className="w-5 h-5 rounded-full bg-gray-100 flex items-center justify-center text-xs text-gray-500">
                    {i + 1}
                  </span>
                  {c}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="px-6 py-4 bg-gray-50 border-t border-gray-100">
          <button
            onClick={onStart}
            className={`w-full py-3 ${t.btnBg} ${t.btnHover} text-white font-semibold rounded-xl transition-colors text-base`}
          >
            Start Conversation
          </button>
        </div>
      </div>
    </div>
  );
}

function TranscriptReviewView({
  scenario,
  messages,
  slots,
  task,
  fullAudioUrl,
  evaluating,
  evaluationReady,
  onGoToCoaching,
  onRetry,
}: {
  scenario: ScenarioConfig;
  messages: TranscriptMessage[];
  slots: SlotValues;
  task: Task;
  fullAudioUrl: string | null;
  evaluating: boolean;
  evaluationReady: boolean;
  onGoToCoaching: () => void;
  onRetry: () => void;
}) {
  const t = scenario.theme;
  const finalMessages = messages.filter((m) => m.final);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, []);

  return (
    <div className="relative z-10 h-full flex flex-col items-center justify-center px-6 py-8">
      <div className="max-w-lg w-full bg-white/95 backdrop-blur-md rounded-2xl shadow-2xl overflow-hidden flex flex-col" style={{ maxHeight: "720px" }}>
        <div className="px-6 py-4 border-b border-gray-100 shrink-0">
          <h2 className="text-base font-bold text-gray-900">Transcript</h2>
          <p className="text-xs text-gray-500 mt-0.5">{task.objective}</p>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
          {finalMessages.map((msg, i) => (
            <div key={i} className="flex gap-3">
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                  msg.role === "npc"
                    ? `${t.npcBadgeBg} ${t.npcBadgeText}`
                    : "bg-blue-100 text-blue-700"
                }`}
              >
                {msg.role === "npc" ? scenario.npcName[0] : "U"}
              </div>
              <div className="flex-1">
                <span className="text-xs font-medium text-gray-500">
                  {msg.role === "npc" ? scenario.npcName : "You"}
                </span>
                <p className="text-sm mt-0.5">
                  {msg.role === "user" && msg.wordScores ? (
                    <ColoredWords wordScores={msg.wordScores} />
                  ) : msg.role === "user" && msg.evalPending ? (
                    <span className="text-gray-400 italic">{msg.text} ...</span>
                  ) : (
                    <span className="text-gray-800">{msg.text}</span>
                  )}
                </p>
                {msg.role === "user" && msg.pronOverall != null && (
                  <span className="text-xs text-gray-400 ml-1">{msg.pronOverall}</span>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="px-6 py-3 border-t border-gray-100 shrink-0">
          <div className="flex items-center gap-2 mb-3">
            {scenario.slots.map(({ id, icon, label }) => (
              <div
                key={id}
                className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs ${
                  slots[id]
                    ? `${t.slotDoneBg} ${t.slotDoneText}`
                    : "bg-gray-100 text-gray-400"
                }`}
              >
                <span>{icon}</span>
                <span>{slots[id] || label}</span>
                {slots[id] && <span>✓</span>}
              </div>
            ))}
          </div>
          {fullAudioUrl && (
            <div className="mb-3 p-3 bg-white rounded-xl border border-gray-200">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-gray-600">Full Recording</span>
                <a
                  href={fullAudioUrl}
                  download="conversation.webm"
                  className="text-xs text-blue-500 hover:text-blue-700"
                >
                  Download
                </a>
              </div>
              <audio controls src={fullAudioUrl} className="w-full h-8" />
            </div>
          )}
          <div className="flex gap-2">
            <button
              onClick={onGoToCoaching}
              className="flex-1 py-2.5 bg-blue-500 hover:bg-blue-600 text-white font-semibold rounded-xl transition-colors text-sm flex items-center justify-center gap-2"
            >
              {evaluating && !evaluationReady && (
                <div className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
              )}
              View Coach Assessment
              {evaluationReady && <span>→</span>}
            </button>
            <button
              onClick={onRetry}
              className={`py-2.5 px-4 ${t.btnBg} ${t.btnHover} text-white font-semibold rounded-xl transition-colors text-sm`}
            >
              Try Again
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function extractKeyImprovements(evaluation: Partial<EnrichedEvaluation>): {
  type: "dimension" | "pronunciation";
  label: string;
  detail: string;
  score?: number;
}[] {
  const items: { type: "dimension" | "pronunciation"; label: string; detail: string; score?: number }[] = [];

  for (const df of evaluation.dimensionFeedback ?? []) {
    if (!df.completed) {
      items.push({ type: "dimension", label: df.slotLabel, detail: `Not completed: ${df.improvements || "You need to express this in the conversation"}` });
    }
  }

  const allWeakWords = [
    ...((evaluation.dimensionFeedback ?? []).flatMap((d) => d.weakWords || [])),
    ...(evaluation.pronunciationDetails?.weakWords || []),
  ];
  const seen = new Set<string>();
  for (const w of allWeakWords.sort((a, b) => a.score - b.score)) {
    if (seen.has(w.word.toLowerCase())) continue;
    seen.add(w.word.toLowerCase());
    items.push({ type: "pronunciation", label: w.word, detail: w.tip, score: w.score });
  }

  return items.slice(0, 3);
}

function CoachingView({
  scenario,
  evaluation,
  evaluating,
  partialEval,
  onDrill,
  onRetry,
  onBack,
}: {
  scenario: ScenarioConfig;
  evaluation: EnrichedEvaluation | null;
  evaluating: boolean;
  partialEval: Partial<EnrichedEvaluation> | null;
  onDrill: () => void;
  onRetry: () => void;
  onBack: () => void;
}) {
  const t = scenario.theme;
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});

  const toggleSection = (key: string) => {
    setExpandedSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const displayData = evaluation ?? partialEval;
  const isStreaming = evaluating && !evaluation;

  if (isStreaming && !displayData) {
    return (
      <div className="relative z-10 h-full flex flex-col items-center justify-center px-6 py-8">
        <div className="max-w-lg w-full bg-white/95 backdrop-blur-md rounded-2xl shadow-2xl p-8 text-center">
          <div className="w-10 h-10 border-3 border-gray-200 border-t-blue-500 rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-600 text-sm">Your coach is analyzing the conversation...</p>
          <button onClick={onBack} className="mt-4 text-xs text-gray-400 hover:text-gray-600">
            Back to transcript
          </button>
        </div>
      </div>
    );
  }

  if (!displayData) {
    return (
      <div className="relative z-10 h-full flex flex-col items-center justify-center px-6 py-8">
        <div className="max-w-lg w-full bg-white/95 backdrop-blur-md rounded-2xl shadow-2xl p-8 text-center">
          <p className="text-gray-600 text-sm mb-4">Evaluation could not complete. Please try again.</p>
          <div className="flex gap-2 justify-center">
            <button onClick={onBack} className="py-2 px-4 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl text-sm">
              Back to transcript
            </button>
            <button onClick={onRetry} className={`py-2 px-4 ${t.btnBg} ${t.btnHover} text-white rounded-xl text-sm`}>
              Try Again
            </button>
          </div>
        </div>
      </div>
    );
  }

  const keyImprovements = extractKeyImprovements(displayData as EnrichedEvaluation);

  return (
    <div className="relative z-10 h-full flex flex-col items-center justify-center px-6 py-8">
      <div className="max-w-lg w-full bg-white/95 backdrop-blur-md rounded-2xl shadow-2xl overflow-hidden flex flex-col" style={{ maxHeight: "720px" }}>
        <div className="px-6 py-4 border-b border-gray-100 shrink-0">
          <h2 className="text-base font-bold text-gray-900">Coach&apos;s Assessment</h2>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {/* Streaming indicator */}
          {isStreaming && (
            <div className="flex items-center gap-2 text-xs text-blue-500">
              <div className="w-4 h-4 border-2 border-blue-200 border-t-blue-500 rounded-full animate-spin" />
              Analyzing...
            </div>
          )}

          {/* Section 1: Tier + Encouragement */}
          {displayData.expressionTier && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className={`px-3 py-1 rounded-full text-xs font-bold ${
                  displayData.expressionTier >= 3 ? "bg-green-100 text-green-700" :
                  displayData.expressionTier >= 2 ? "bg-yellow-100 text-yellow-700" :
                  "bg-red-100 text-red-700"
                }`}>
                  Tier {displayData.expressionTier} · {TIER_LABELS[displayData.expressionTier as Tier]}
                </span>
                {displayData.pronunciationScore != null && (
                  <span className="text-xs text-gray-400">Pronunciation: {displayData.pronunciationScore}</span>
                )}
              </div>
              {displayData.tierImproved && (
                <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-2 mb-2">
                  <span className="text-green-700 text-sm font-medium">
                    Congrats! You leveled up from {TIER_LABELS[displayData.priorTier as Tier]} to {TIER_LABELS[displayData.newTier as Tier]}!
                  </span>
                </div>
              )}
              {displayData.encouragement && (
                <p className="text-sm text-gray-600">{displayData.encouragement}</p>
              )}
              {displayData.summary && (
                <p className="text-sm text-gray-700 mt-2">{displayData.summary}</p>
              )}
            </div>
          )}

          {/* Section 2: Key Improvements (always expanded) */}
          {keyImprovements.length > 0 && (
            <div>
              <h4 className="text-xs font-medium text-gray-500 mb-2">Key Improvements</h4>
              <div className="space-y-2">
                {keyImprovements.map((item, i) => (
                  <div key={i} className={`rounded-lg p-3 text-sm ${
                    item.type === "dimension" ? "bg-orange-50 border border-orange-100" : "bg-blue-50 border border-blue-100"
                  }`}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-xs font-bold ${
                        item.type === "dimension" ? "text-orange-600" : "text-blue-600"
                      }`}>
                        {item.type === "dimension" ? "Task" : "Pronunciation"}
                      </span>
                      <span className="text-gray-800 font-medium">{item.label}</span>
                      {item.score != null && (
                        <span className="text-xs" style={{ color: scoreColor(item.score) }}>{item.score}</span>
                      )}
                    </div>
                    <p className="text-gray-600 text-xs">{item.detail}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Section 3: Dimension Details (collapsible) */}
          {(displayData.dimensionFeedback?.length ?? 0) > 0 && (
            <div>
              <button
                onClick={() => toggleSection("dimensions")}
                className="flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-700 w-full"
              >
                <span className={`transition-transform ${expandedSections.dimensions ? "rotate-90" : ""}`}>▶</span>
                Dimension Details
              </button>
              {expandedSections.dimensions && (
                <div className="mt-2 space-y-2">
                  {displayData.dimensionFeedback!.map((df, i) => {
                    const slotDef = scenario.slots.find((s) => s.id === df.slotId);
                    return (
                      <div key={i} className="bg-gray-50 rounded-lg p-3 text-sm">
                        <div className="flex items-center gap-2 mb-1">
                          {slotDef && <span>{slotDef.icon}</span>}
                          <span className="font-medium text-gray-800">{df.slotLabel}</span>
                          <span className={df.completed ? "text-green-500 text-xs" : "text-red-400 text-xs"}>
                            {df.completed ? "✓" : "✗"}
                          </span>
                        </div>
                        {df.strengths && <p className="text-green-700 text-xs mb-1">{df.strengths}</p>}
                        {df.improvements && <p className="text-blue-700 text-xs">{df.improvements}</p>}
                        {df.weakWords && df.weakWords.length > 0 && (
                          <div className="mt-1 space-y-0.5">
                            {df.weakWords.map((w, j) => (
                              <div key={j} className="text-xs text-gray-500">
                                <span style={{ color: scoreColor(w.score) }} className="font-medium">{w.word}</span>
                                <span className="text-gray-400 ml-1">({w.score})</span>
                                <span className="ml-1">{w.tip}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Section 4: Pronunciation Details (collapsible) */}
          {(displayData.pronunciationDetails?.weakWords?.length ?? 0) > 0 && (
            <div>
              <button
                onClick={() => toggleSection("pronunciation")}
                className="flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-700 w-full"
              >
                <span className={`transition-transform ${expandedSections.pronunciation ? "rotate-90" : ""}`}>▶</span>
                Pronunciation
              </button>
              {expandedSections.pronunciation && (
                <div className="mt-2">
                  {displayData.pronunciationDetails!.overallComment && (
                    <p className="text-sm text-gray-600 mb-2">{displayData.pronunciationDetails!.overallComment}</p>
                  )}
                  <div className="space-y-1">
                    {displayData.pronunciationDetails!.weakWords.map((w, i) => (
                      <div key={i} className="flex items-center gap-2 text-sm bg-gray-50 rounded-lg px-3 py-2">
                        <span style={{ color: scoreColor(w.score) }} className="font-bold">{w.word}</span>
                        <span className="text-gray-400 text-xs">{w.score}</span>
                        {w.ipa && <span className="text-gray-500 text-xs font-mono">{w.ipa}</span>}
                        <span className="text-gray-600 text-xs flex-1">{w.tip}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Section 5: Suggestions (collapsible) */}
          {(displayData.suggestions?.length ?? 0) > 0 && (
            <div>
              <button
                onClick={() => toggleSection("suggestions")}
                className="flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-700 w-full"
              >
                <span className={`transition-transform ${expandedSections.suggestions ? "rotate-90" : ""}`}>▶</span>
                Better Expressions
              </button>
              {expandedSections.suggestions && (
                <div className="mt-2 space-y-2">
                  {displayData.suggestions!.map((s, i) => (
                    <div key={i} className="bg-blue-50 rounded-lg p-3 text-sm">
                      <div className="text-gray-500 line-through">{s.said}</div>
                      <div className="text-blue-700 font-medium">{s.better}</div>
                      <div className="text-gray-500 text-xs mt-1">{s.reason}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* General feedback */}
          {displayData.generalFeedback && (
            <p className="text-sm text-gray-600 bg-gray-50 rounded-lg p-3">{displayData.generalFeedback}</p>
          )}
        </div>

        {/* Bottom actions */}
        <div className="px-6 py-3 border-t border-gray-100 shrink-0">
          <div className="flex gap-2">
            {!isStreaming && (displayData.targetedDrills?.length ?? 0) > 0 && (
              <button
                onClick={onDrill}
                className="flex-1 py-2.5 bg-blue-500 hover:bg-blue-600 text-white font-semibold rounded-xl transition-colors text-sm"
              >
                Start Drills ({displayData.targetedDrills!.length})
              </button>
            )}
            <button
              onClick={onRetry}
              className={`py-2.5 px-4 ${t.btnBg} ${t.btnHover} text-white font-semibold rounded-xl transition-colors text-sm`}
            >
              Try Again
            </button>
            <button
              onClick={onBack}
              className="py-2.5 px-4 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl transition-colors text-sm"
            >
              Transcript
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LiveDialoguePage() {
  const { status, slots, messages, npcSpeaking, error, fullAudioUrl, connect, disconnect, reset, waitForEvalData } =
    useGeminiLive();

  const [phase, setPhase] = useState<Phase>("select");
  const [scenarioId, setScenarioId] = useState<string | null>(null);
  const [task, setTask] = useState<Task | null>(null);
  const [evaluation, setEvaluation] = useState<EnrichedEvaluation | null>(null);
  const [evaluating, setEvaluating] = useState(false);
  const [partialEval, setPartialEval] = useState<Partial<EnrichedEvaluation> | null>(null);
  const [priorTier, setPriorTier] = useState<Tier>(1);

  const scenario = scenarioId ? SCENARIOS[scenarioId] : null;

  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const allSlotsFilled = scenario
    ? scenario.slots.every((s) => !!slots[s.id])
    : false;

  function handleSelect(id: string) {
    const sc = SCENARIOS[id];
    const newTask = generateRandomTask(sc);
    setScenarioId(id);
    setTask(newTask);
    setPhase("briefing");
  }

  function handleStart() {
    if (!scenario || !task || !scenarioId) return;
    setPhase("dialogue");
    setEvaluation(null);
    const progress = loadProgress();
    const tier = progress[scenarioId]?.currentTier;
    connect(scenario, task, tier);
  }

  async function handleDisconnect() {
    if (!scenario || !task || !scenarioId) return;

    const progress = loadProgress();
    const currentPriorTier = (progress[scenarioId]?.currentTier ?? 1) as Tier;
    setPriorTier(currentPriorTier);

    disconnect();
    setPhase("review");
    setEvaluating(true);

    const readyMessages = await waitForEvalData(3000);

    const finalMessages = readyMessages
      .filter((m) => m.final && m.text.trim())
      .map((m) => ({
        role: m.role as "user" | "npc",
        text: m.text,
        pronOverall: m.pronOverall,
        wordScores: m.wordScores,
      }));

    setPartialEval(null);
    try {
      const res = await fetch("/api/evaluate-conversation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: finalMessages,
          scenarioTitle: scenario.title,
          taskObjective: task.objective,
          slots: scenario.slots.map((s) => ({ id: s.id, label: s.label, icon: s.icon })),
          taskSlotValues: task.slotValues,
          filledSlots: slots,
          currentTier: currentPriorTier,
          scenarioId,
        }),
      });
      if (!res.ok || !res.body) {
        console.error("Evaluation API error:", res.status);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data: ")) continue;
          try {
            const data = JSON.parse(trimmed.slice(6));
            if (data.chunk) {
              accumulated += data.chunk;
              const partial = tryParsePartialJson(accumulated);
              if (partial) setPartialEval(partial);
            }
            if (data.result) {
              const apiResult = data.result;
              const updatedProgress = updateProgress(scenarioId, apiResult);
              const tierImproved = updatedProgress.currentTier > currentPriorTier;
              const enriched: EnrichedEvaluation = {
                ...apiResult,
                tierImproved,
                priorTier: currentPriorTier,
                newTier: updatedProgress.currentTier as Tier,
              };
              setEvaluation(enriched);
              setPartialEval(null);
            }
            if (data.error) {
              console.error("Evaluation error:", data.error);
            }
          } catch {
            // skip malformed SSE
          }
        }
      }
    } catch (e) {
      console.error("Evaluation failed:", e);
    } finally {
      setEvaluating(false);
    }
  }

  function handleGoToCoaching() {
    setPhase("coaching");
  }

  function handleDrill() {
    setPhase("drill");
  }

  function handleDrillComplete() {
    setPhase("coaching");
  }

  function handleBackToReview() {
    setPhase("review");
  }

  function handleRetry() {
    reset();
    setScenarioId(null);
    setTask(null);
    setEvaluation(null);
    setPhase("select");
  }

  if (phase === "select") {
    return (
      <div className="max-w-4xl mx-auto p-4 w-full">
        <div
          className="relative rounded-3xl overflow-hidden shadow-2xl bg-gradient-to-br from-gray-900 to-gray-800"
          style={{ height: "min(720px, 100dvh - 2rem)" }}
        >
          <ScenarioSelectView onSelect={handleSelect} />
        </div>
      </div>
    );
  }

  if (!scenario || !task) return null;

  return (
    <div className="max-w-4xl mx-auto p-4 w-full">
      <div
        className="relative rounded-3xl overflow-hidden shadow-2xl"
        style={{ height: "min(720px, 100dvh - 2rem)" }}
      >
        <SceneBackground scenario={scenario} />

        {phase === "briefing" && (
          <BriefingView scenario={scenario} task={task} onStart={handleStart} />
        )}

        {phase === "review" && (
          <TranscriptReviewView
            scenario={scenario}
            messages={messages}
            slots={slots}
            task={task}
            fullAudioUrl={fullAudioUrl}
            evaluating={evaluating}
            evaluationReady={!!evaluation}
            onGoToCoaching={handleGoToCoaching}
            onRetry={handleRetry}
          />
        )}

        {phase === "coaching" && (
          <CoachingView
            scenario={scenario}
            evaluation={evaluation}
            evaluating={evaluating}
            partialEval={partialEval}
            onDrill={handleDrill}
            onRetry={handleRetry}
            onBack={handleBackToReview}
          />
        )}

        {phase === "drill" && evaluation?.targetedDrills && evaluation.targetedDrills.length > 0 && (
          <DrillView
            drills={evaluation.targetedDrills}
            onComplete={handleDrillComplete}
          />
        )}

        {phase === "dialogue" && (
          <>
            <div className="absolute inset-0 flex items-end justify-center pointer-events-none">
              <div
                className={`relative transition-transform duration-500 ${npcSpeaking ? "scale-[1.02]" : ""}`}
              >
                <img
                  src={scenario.portrait}
                  alt={scenario.npcName}
                  className="w-auto object-contain object-bottom drop-shadow-2xl"
                  style={{ height: "min(520px, 65dvh)", filter: "brightness(1.05)" }}
                />
                {npcSpeaking && (
                  <div
                    className="absolute inset-0 rounded-full opacity-20 animate-pulse"
                    style={{
                      background:
                        "radial-gradient(ellipse at center bottom, rgba(251,191,36,0.4), transparent 70%)",
                    }}
                  />
                )}
              </div>
            </div>

            <div className="relative z-10 h-full flex flex-col justify-between">
              <div className="flex items-center justify-between px-6 pt-5">
                <div className="flex items-center gap-2">
                  <div className="px-4 py-2 bg-black/30 backdrop-blur-md rounded-full">
                    <span className="text-white font-medium text-sm">{scenario.npcName}</span>
                    <span className="text-white/60 text-xs ml-2">{scenario.npcRole}</span>
                  </div>
                  {status === "connected" && (
                    <div className="px-3 py-2 bg-green-500/30 backdrop-blur-md rounded-full">
                      <span className="text-green-300 text-xs font-medium flex items-center gap-1.5">
                        <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
                        Live
                      </span>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-3 px-4 py-2.5 bg-black/30 backdrop-blur-md rounded-full">
                  {scenario.slots.map(({ id, icon }) => {
                    const done = !!slots[id];
                    return (
                      <div key={id} className="relative flex flex-col items-center">
                        <div
                          className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold transition-all duration-300 ${
                            done
                              ? "bg-green-500/90 text-white scale-110"
                              : "bg-white/20 text-white/50"
                          }`}
                          style={
                            done
                              ? {
                                  animation:
                                    "slot-pop 0.7s cubic-bezier(0.34,1.56,0.64,1) forwards, slot-ring 0.8s ease-out",
                                }
                              : undefined
                          }
                        >
                          {done ? "✓" : icon}
                        </div>
                        {done && (
                          <span className="text-[10px] text-green-300/80 mt-0.5">
                            {slots[id]}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="flex flex-col items-center gap-3 pb-6 px-6">
                <div
                  ref={scrollRef}
                  className="w-full max-w-lg max-h-48 overflow-y-auto px-4 py-3 bg-black/40 backdrop-blur-md rounded-2xl space-y-2"
                >
                  {messages.length === 0 && status !== "connected" && (
                    <p className="text-white/40 text-sm text-center">
                      Tap the mic to start your conversation
                    </p>
                  )}
                  {messages.filter((m) => m.final || messages.indexOf(m) >= messages.length - 2).map((msg, i) => (
                    <div
                      key={i}
                      className={`text-sm ${
                        msg.role === "npc"
                          ? scenario.theme.npcText
                          : "text-blue-200"
                      } ${!msg.final ? "opacity-50 italic" : ""}`}
                    >
                      <span className="font-semibold">
                        {msg.role === "npc" ? scenario.npcName : "You"}:
                      </span>{" "}
                      {msg.text}
                    </div>
                  ))}
                </div>

                {allSlotsFilled && (
                  <div className={`px-6 py-2.5 ${scenario.theme.completeBg} backdrop-blur-sm text-white rounded-full text-sm font-medium shadow-lg`}>
                    {scenario.completionMessage}
                  </div>
                )}

                {error && (
                  <div className="px-4 py-1.5 bg-red-500/80 backdrop-blur-sm text-white text-xs rounded-full">
                    {error}
                  </div>
                )}

                {status === "idle" || status === "error" ? (
                  <button
                    onClick={() => scenario && task && connect(scenario, task)}
                    className="w-20 h-20 rounded-full flex items-center justify-center bg-white/90 hover:bg-white hover:scale-105 transition-all duration-200 shadow-2xl"
                  >
                    <svg className="w-9 h-9 text-gray-700" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
                      <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
                    </svg>
                  </button>
                ) : status === "connecting" ? (
                  <div className="w-20 h-20 rounded-full flex items-center justify-center bg-white/30 shadow-2xl">
                    <div className="w-8 h-8 border-3 border-white/40 border-t-white rounded-full animate-spin" />
                  </div>
                ) : (
                  <button
                    onClick={handleDisconnect}
                    className="w-20 h-20 rounded-full flex items-center justify-center bg-red-500 hover:bg-red-600 transition-all duration-200 shadow-2xl ring-4 ring-red-500/30"
                  >
                    <div className="w-7 h-7 bg-white rounded-sm" />
                  </button>
                )}

                <p className="text-white/40 text-xs">
                  {status === "idle"
                    ? "Tap to start"
                    : status === "connecting"
                      ? "Connecting..."
                      : status === "connected"
                        ? "Listening — speak naturally"
                        : "Tap to retry"}
                </p>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
