"use client";

import { useState, useRef, useCallback } from "react";
import type { WordScore } from "@/hooks/useGeminiLive";

function playTTS(text: string) {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "zh-CN";
  utterance.rate = 0.8;
  const voices = window.speechSynthesis.getVoices();
  const zhVoice = voices.find((v) => v.lang.startsWith("zh-CN"))
    || voices.find((v) => v.lang.startsWith("zh"));
  if (zhVoice) utterance.voice = zhVoice;
  window.speechSynthesis.speak(utterance);
}

function scoreColor(score: number): string {
  if (score >= 80) return "#22c55e";
  if (score >= 60) return "#84cc16";
  if (score >= 40) return "#f97316";
  return "#ef4444";
}

type DrillState = "ready" | "recording" | "evaluating" | "result";

interface DrillItem {
  phrase: string;
  reason: string;
  type?: "word" | "sentence";
}

function blobToBase64(blob: Blob): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve((reader.result as string).split(",")[1] || null);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(blob);
  });
}

export default function DrillView({
  drills,
  phrases,
  onComplete,
}: {
  drills?: DrillItem[];
  phrases?: string[];
  onComplete: () => void;
}) {
  const items: DrillItem[] = drills ?? (phrases || []).map((p) => ({ phrase: p, reason: "", type: "sentence" }));

  const [currentIdx, setCurrentIdx] = useState(0);
  const [state, setState] = useState<DrillState>("ready");
  const [wordScores, setWordScores] = useState<WordScore[] | null>(null);
  const [overall, setOverall] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordStartRef = useRef<number>(0);

  const item = items[currentIdx];
  if (!item) return null;
  const phrase = item.phrase;
  const isWord = item.type === "word";
  const passed = overall != null && overall >= 70;

  const startRecording = useCallback(async () => {
    setError(null);
    setWordScores(null);
    setOverall(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: true },
      });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus" : "audio/webm";
      const chunks: Blob[] = [];
      chunksRef.current = chunks;
      const recorder = new MediaRecorder(stream, { mimeType });
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
      recorder.start(200);
      recorderRef.current = recorder;
      recordStartRef.current = Date.now();
      setState("recording");
    } catch (e) {
      setError("Cannot access microphone");
      console.error(e);
    }
  }, []);

  const stopRecording = useCallback(async () => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state !== "recording") return;

    const elapsed = Date.now() - recordStartRef.current;
    if (elapsed < 500) {
      await new Promise((r) => setTimeout(r, 500 - elapsed));
    }

    setState("evaluating");
    const chunks = chunksRef.current;

    await new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
      recorder.stop();
    });

    recorder.stream.getTracks().forEach((t) => t.stop());
    recorderRef.current = null;

    const blob = new Blob(chunks, { type: recorder.mimeType });
    const audioBase64 = await blobToBase64(blob);

    if (!audioBase64) {
      setError("Recording failed, please try again");
      setState("ready");
      return;
    }

    try {
      const res = await fetch("/api/chivox-eval", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refText: phrase, audioBase64, type: isWord ? "word" : "sentence" }),
      });
      const data = await res.json();
      if (data.error) {
        setError("Evaluation failed, please retry");
        setState("ready");
        return;
      }
      setWordScores(data.wordScores || []);
      setOverall(data.overall ?? 0);
      setState("result");
    } catch {
      setError("Evaluation failed, please retry");
      setState("ready");
    }
  }, [phrase]);

  const handleMicClick = useCallback(() => {
    if (state === "ready") {
      startRecording();
    } else if (state === "recording") {
      stopRecording();
    }
  }, [state, startRecording, stopRecording]);

  function handleNext() {
    if (currentIdx + 1 >= items.length) {
      onComplete();
    } else {
      setCurrentIdx(currentIdx + 1);
      setState("ready");
      setWordScores(null);
      setOverall(null);
    }
  }

  function handleRetry() {
    setState("ready");
    setWordScores(null);
    setOverall(null);
  }

  return (
    <div className="relative z-10 h-full flex flex-col items-center justify-center px-6 py-8">
      <div className="max-w-lg w-full bg-white/95 backdrop-blur-md rounded-2xl shadow-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-gray-900">
              {isWord ? "Word Pronunciation" : "Sentence Pronunciation"}
            </h2>
            <span className="text-xs text-gray-400">
              {currentIdx + 1} / {items.length}
            </span>
          </div>
          <div className="w-full bg-gray-100 rounded-full h-1.5 mt-2">
            <div
              className="bg-blue-500 rounded-full h-1.5 transition-all"
              style={{ width: `${((currentIdx + (passed ? 1 : 0)) / items.length) * 100}%` }}
            />
          </div>
        </div>

        <div className="px-6 py-8 text-center">
          <div className="flex items-center justify-center gap-2 mb-2">
            <p className={`font-medium text-gray-900 ${isWord ? "text-2xl" : "text-lg"}`}>{phrase}</p>
            <button
              onClick={() => playTTS(phrase)}
              className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center transition-colors shrink-0"
              title="Listen to pronunciation"
            >
              <svg className="w-4 h-4 text-gray-600" fill="currentColor" viewBox="0 0 24 24">
                <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
              </svg>
            </button>
          </div>
          {item.reason && (
            <p className="text-xs text-gray-400 mb-4">{item.reason}</p>
          )}

          {state === "result" && wordScores && (
            <div className="mb-6">
              <p className="text-sm mb-2">
                {wordScores.map((ws, i) => (
                  <span key={i}>
                    <span style={{ color: scoreColor(ws.score), fontWeight: 500 }}>{ws.word}</span>
                    {i < wordScores.length - 1 && " "}
                  </span>
                ))}
              </p>
              <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium ${
                passed ? "bg-green-50 text-green-700" : "bg-orange-50 text-orange-700"
              }`}>
                <span className="text-lg">{passed ? "✓" : "↻"}</span>
                <span>{overall} — {passed ? "Passed!" : "Try again"}</span>
              </div>
            </div>
          )}

          {error && (
            <p className="text-sm text-red-500 mb-4">{error}</p>
          )}

          <div className="flex flex-col items-center gap-3">
            {(state === "ready" || state === "recording") && (
              <button
                onClick={handleMicClick}
                className={`w-20 h-20 rounded-full flex items-center justify-center shadow-lg transition-all ${
                  state === "recording"
                    ? "bg-red-500 text-white animate-pulse"
                    : "bg-blue-500 hover:bg-blue-600 text-white hover:scale-105"
                }`}
              >
                {state === "recording" ? (
                  <div className="w-7 h-7 bg-white rounded-sm" />
                ) : (
                  <svg className="w-9 h-9" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
                    <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
                  </svg>
                )}
              </button>
            )}

            {state === "evaluating" && (
              <div className="w-20 h-20 rounded-full bg-gray-200 flex items-center justify-center">
                <div className="w-8 h-8 border-3 border-gray-300 border-t-blue-500 rounded-full animate-spin" />
              </div>
            )}

            {state === "result" && (
              <div className="flex gap-3">
                {!passed && (
                  <button
                    onClick={handleRetry}
                    className="px-6 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium rounded-xl transition-colors text-sm"
                  >
                    Retry
                  </button>
                )}
                <button
                  onClick={handleNext}
                  className={`px-6 py-2.5 font-medium rounded-xl transition-colors text-sm ${
                    passed
                      ? "bg-green-500 hover:bg-green-600 text-white"
                      : "bg-blue-500 hover:bg-blue-600 text-white"
                  }`}
                >
                  {passed
                    ? currentIdx + 1 >= items.length ? "Done" : "Next"
                    : "Skip"}
                </button>
              </div>
            )}

            <p className="text-xs text-gray-400">
              {state === "ready" ? "Tap the mic to record" :
               state === "recording" ? "Recording — tap again to stop" :
               state === "evaluating" ? "Evaluating..." : ""}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
