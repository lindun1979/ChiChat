"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import {
  createLiveSession,
  type LiveSession,
  type SlotValues,
  type LiveSessionCallbacks,
} from "@/lib/gemini-live";
import type { Task } from "@/lib/task-generator";
import type { Tier } from "@/lib/progression";
import type { ScenarioConfig } from "@/lib/scenarios";
import {
  nextTurnAction,
  type TurnCaptureState,
  type TurnEvent,
} from "@/lib/turn-capture";

export interface WordScore {
  word: string;
  score: number;
}

export interface TranscriptMessage {
  role: "user" | "npc";
  text: string;
  final: boolean;
  turnId?: string;
  wordScores?: WordScore[];
  pronOverall?: number;
  evalPending?: boolean;
}

export type SessionStatus = "idle" | "connecting" | "connected" | "error";

function decodePcmBase64ToFloat32(base64: string): Float32Array {
  const raw = atob(base64);
  const len = raw.length / 2;
  const float32 = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const lo = raw.charCodeAt(i * 2);
    const hi = raw.charCodeAt(i * 2 + 1);
    const int16 = (hi << 8) | lo;
    float32[i] = (int16 > 32767 ? int16 - 65536 : int16) / 32768;
  }
  return float32;
}

function uint8ToBase64(bytes: Uint8Array): string {
  const chunkSize = 8192;
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    parts.push(String.fromCharCode.apply(null, slice as unknown as number[]));
  }
  return btoa(parts.join(""));
}

function blobToBase64(blob: Blob): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve((reader.result as string).split(",")[1] || null);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(blob);
  });
}

export function useGeminiLive() {
  const [status, setStatus] = useState<SessionStatus>("idle");
  const [slots, setSlots] = useState<SlotValues>({});
  const [messages, setMessages] = useState<TranscriptMessage[]>([]);
  const [npcSpeaking, setNpcSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fullAudioUrl, setFullAudioUrl] = useState<string | null>(null);

  const messagesRef = useRef<TranscriptMessage[]>([]);
  const setMessagesAndRef = useCallback((updater: TranscriptMessage[] | ((prev: TranscriptMessage[]) => TranscriptMessage[])) => {
    setMessages((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      messagesRef.current = next;
      return next;
    });
  }, []);

  const sessionRef = useRef<LiveSession | null>(null);
  const playbackCtxRef = useRef<AudioContext | null>(null);
  const micCtxRef = useRef<AudioContext | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const closedRef = useRef(false);

  // Ambient music
  const ambientRef = useRef<HTMLAudioElement | null>(null);
  const ambientSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const ambientGainRef = useRef<GainNode | null>(null);

  // Full conversation recording (NPC + user mixed)
  const mixDestRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const mixRecorderRef = useRef<MediaRecorder | null>(null);
  const mixChunksRef = useRef<Blob[]>([]);

  // Turn capture state machine + PCM ring buffer (PCM feeds Gemini, MediaRecorder feeds ChiSheng)
  const turnStateRef = useRef<TurnCaptureState>("idle");
  const sealedBlobRef = useRef<Promise<Blob | null> | null>(null);
  const turnIdRef = useRef<string | null>(null);
  const pendingEvalTextRef = useRef<string | null>(null);
  const correctedEvalTextRef = useRef<string | null>(null);
  const pcmRingRef = useRef<Int16Array[]>([]);
  const pcmTurnStartRef = useRef<number>(0);
  const PCM_RING_MAX = 40;   // ~10s at 4096 samples/chunk (~256ms each)
  const PCM_LOOKBACK = 8;    // ~2s lookback for barge-in coverage

  // Per-turn MediaRecorder for ChiSheng (WebM/opus — compressed, ChiSheng handles it)
  const turnRecorderRef = useRef<MediaRecorder | null>(null);
  const turnRecChunksRef = useRef<Blob[]>([]);

  // Queue-based audio playback
  const pcmQueueRef = useRef<Float32Array[]>([]);
  const queueOffsetRef = useRef(0);
  const playbackNodeRef = useRef<ScriptProcessorNode | null>(null);
  const speakingRef = useRef(false);
  const silenceCountRef = useRef(0);

  function startTurnRecorder() {
    if (turnRecorderRef.current?.state === "recording") return;
    const stream = micStreamRef.current;
    if (!stream) return;
    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus" : "audio/webm";
    const chunks: Blob[] = [];
    turnRecChunksRef.current = chunks;
    const recorder = new MediaRecorder(stream, { mimeType });
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    recorder.start(200);
    turnRecorderRef.current = recorder;
  }

  function stopTurnRecorder(): Promise<Blob | null> {
    const recorder = turnRecorderRef.current;
    const chunks = turnRecChunksRef.current;
    turnRecorderRef.current = null;
    turnRecChunksRef.current = [];
    if (!recorder || recorder.state !== "recording") {
      return Promise.resolve(chunks.length > 0 ? new Blob(chunks, { type: "audio/webm" }) : null);
    }
    return new Promise((resolve) => {
      recorder.onstop = () => {
        resolve(chunks.length > 0 ? new Blob(chunks, { type: recorder.mimeType }) : null);
      };
      recorder.stop();
    });
  }

  const cleanupMic = useCallback(() => {
    pcmRingRef.current = [];
    pcmTurnStartRef.current = 0;
    sealedBlobRef.current = null;
    turnStateRef.current = "idle";
    turnIdRef.current = null;
    pendingEvalTextRef.current = null;
    if (turnRecorderRef.current?.state === "recording") {
      turnRecorderRef.current.stop();
    }
    turnRecorderRef.current = null;
    turnRecChunksRef.current = [];
    processorRef.current?.disconnect();
    sourceRef.current?.disconnect();
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    processorRef.current = null;
    sourceRef.current = null;
    micStreamRef.current = null;
    micCtxRef.current?.close();
    micCtxRef.current = null;
  }, []);

  const cleanupPlayback = useCallback(() => {
    mixDestRef.current = null;
    playbackNodeRef.current?.disconnect();
    playbackNodeRef.current = null;
    pcmQueueRef.current = [];
    queueOffsetRef.current = 0;
    silenceCountRef.current = 0;
    if (ambientRef.current) {
      ambientRef.current.pause();
      ambientRef.current.src = "";
      ambientRef.current = null;
    }
    ambientSourceRef.current?.disconnect();
    ambientSourceRef.current = null;
    ambientGainRef.current?.disconnect();
    ambientGainRef.current = null;
    playbackCtxRef.current?.close();
    playbackCtxRef.current = null;
  }, []);

  const initPlayback = useCallback((ambientAudioPath: string) => {
    const ctx = new AudioContext({ sampleRate: 24000 });
    playbackCtxRef.current = ctx;

    const node = ctx.createScriptProcessor(2048, 0, 1);
    node.onaudioprocess = (e) => {
      const output = e.outputBuffer.getChannelData(0);
      let written = 0;

      while (written < output.length && pcmQueueRef.current.length > 0) {
        const chunk = pcmQueueRef.current[0];
        const offset = queueOffsetRef.current;
        const available = chunk.length - offset;
        const needed = output.length - written;
        const toCopy = Math.min(available, needed);

        output.set(chunk.subarray(offset, offset + toCopy), written);
        written += toCopy;
        queueOffsetRef.current = offset + toCopy;

        if (queueOffsetRef.current >= chunk.length) {
          pcmQueueRef.current.shift();
          queueOffsetRef.current = 0;
        }
      }

      for (let i = written; i < output.length; i++) {
        output[i] = 0;
      }

      if (written > 0) {
        silenceCountRef.current = 0;
        if (!speakingRef.current) {
          speakingRef.current = true;
          setNpcSpeaking(true);
        }
      } else {
        silenceCountRef.current++;
        if (speakingRef.current && silenceCountRef.current > 3) {
          speakingRef.current = false;
          setNpcSpeaking(false);
        }
      }
    };

    node.connect(ctx.destination);
    playbackNodeRef.current = node;

    // Mix destination for full conversation recording
    const mixDest = ctx.createMediaStreamDestination();
    mixDestRef.current = mixDest;
    node.connect(mixDest);

    try {
      const audio = new Audio(ambientAudioPath);
      audio.loop = true;
      audio.crossOrigin = "anonymous";
      ambientRef.current = audio;
      const src = ctx.createMediaElementSource(audio);
      ambientSourceRef.current = src;
      const gain = ctx.createGain();
      gain.gain.value = 0.12;
      ambientGainRef.current = gain;
      src.connect(gain).connect(ctx.destination);
      audio.play().catch(() => {
        const resume = () => {
          audio.play().catch(() => {});
          document.removeEventListener("click", resume);
          document.removeEventListener("touchstart", resume);
        };
        document.addEventListener("click", resume, { once: true });
        document.addEventListener("touchstart", resume, { once: true });
      });
    } catch {
      // Ambient music is non-critical
    }
  }, []);

  const enqueuePcm = useCallback((base64: string) => {
    const float32 = decodePcmBase64ToFloat32(base64);
    pcmQueueRef.current.push(float32);
  }, []);

  const flushPlaybackQueue = useCallback(() => {
    pcmQueueRef.current = [];
    queueOffsetRef.current = 0;
    silenceCountRef.current = 0;
    speakingRef.current = false;
    setNpcSpeaking(false);
  }, []);

  // Consume sealed/stopped audio: send to ChiSheng for scoring, bind results to message
  function clearEvalPending(turnId: string) {
    setMessagesAndRef((prev) =>
      prev.map((m) =>
        m.turnId === turnId && m.role === "user" ? { ...m, evalPending: false } : m,
      ),
    );
  }

  async function consumeAudio(blob: Blob, evalText: string, currentTurnId: string) {
    if (blob.size === 0) { clearEvalPending(currentTurnId); return; }

    const audioBase64 = await blobToBase64(blob);
    if (!audioBase64) { clearEvalPending(currentTurnId); return; }

    try {
      const res = await fetch("/api/chivox-eval", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refText: evalText, audioBase64 }),
      });
      const data = await res.json();
      if (!res.ok) { clearEvalPending(currentTurnId); return; }
      setMessagesAndRef((prev) => {
        let targetIdx = -1;
        for (let i = prev.length - 1; i >= 0; i--) {
          const m = prev[i];
          if (m.role === "user" && m.turnId === currentTurnId) {
            targetIdx = i;
            break;
          }
        }
        if (targetIdx === -1) {
          for (let i = prev.length - 1; i >= 0; i--) {
            const m = prev[i];
            if (m.role === "user" && m.final && !m.wordScores) {
              targetIdx = i;
              break;
            }
          }
        }
        if (targetIdx === -1) return prev;
        return prev.map((m, i) =>
          i === targetIdx
            ? {
                ...m,
                wordScores: data.wordScores || undefined,
                pronOverall: data.overall ?? undefined,
                evalPending: false,
              }
            : m
        );
      });
    } catch {
      setMessagesAndRef((prev) =>
        prev.map((m) =>
          m.turnId === currentTurnId && m.role === "user"
            ? { ...m, evalPending: false }
            : m
        )
      );
    }
  }

  // Apply turn state machine action — MediaRecorder for ChiSheng (WebM/opus), PCM ring for Gemini
  function applyTurnEvent(event: TurnEvent) {
    const action = nextTurnAction(turnStateRef.current, event);

    if (action.warn) {
      console.warn(`[turn-capture] ${action.warn}`);
    }

    const prevTurnId = turnIdRef.current;
    const prevEvalText = pendingEvalTextRef.current;

    if (action.generateTurnId) {
      turnIdRef.current = crypto.randomUUID();
    }

    // Stop per-turn MediaRecorder → Promise<Blob> (WebM/opus)
    let collectedBlobPromise: Promise<Blob | null> | null = null;
    if (action.stopRecorder) {
      collectedBlobPromise = stopTurnRecorder();
    }

    // Start new MediaRecorder for next turn
    if (action.startNewRecorder) {
      startTurnRecorder();
      pcmTurnStartRef.current = Math.max(0, pcmRingRef.current.length - PCM_LOOKBACK);
    }

    if (action.discardAudio) {
      collectedBlobPromise = null;
      sealedBlobRef.current = null;
      pendingEvalTextRef.current = null;
      correctedEvalTextRef.current = null;
      turnIdRef.current = null;
    }

    // On seal (capturing → sealed): store blob promise for later consumption
    if (action.nextState === "sealed" && turnStateRef.current === "capturing" && collectedBlobPromise) {
      sealedBlobRef.current = collectedBlobPromise;
    }

    if (action.consumeAudio) {
      const blobPromise = sealedBlobRef.current || collectedBlobPromise;
      const evalText = correctedEvalTextRef.current || prevEvalText;
      const tid = prevTurnId;
      sealedBlobRef.current = null;

      if (evalText && tid) {
        setMessagesAndRef((prev) =>
          prev.map((m) =>
            m.turnId === tid && m.role === "user" && !m.evalPending && !m.wordScores
              ? { ...m, evalPending: true }
              : m
          )
        );
        if (blobPromise) {
          blobPromise.then((blob) => {
            if (blob && blob.size > 0) {
              consumeAudio(blob, evalText, tid);
            } else {
              clearEvalPending(tid);
            }
          }).catch(() => clearEvalPending(tid));
        } else {
          clearEvalPending(tid);
        }
      }

      pendingEvalTextRef.current = null;
      correctedEvalTextRef.current = null;
      turnIdRef.current = null;
    }

    turnStateRef.current = action.nextState;
  }

  const connect = useCallback(async (scenario: ScenarioConfig, task?: Task, tier?: Tier) => {
    sessionRef.current?.close();
    sessionRef.current = null;
    cleanupMic();
    cleanupPlayback();

    setStatus("connecting");
    setError(null);
    setMessagesAndRef([]);
    setSlots({});
    setFullAudioUrl(null);
    closedRef.current = false;
    pendingEvalTextRef.current = null;
    correctedEvalTextRef.current = null;
    turnStateRef.current = "idle";
    turnIdRef.current = null;
    sealedBlobRef.current = null;

    try {
      const resp = await fetch("/api/gemini-token");
      const { apiKey } = await resp.json();
      if (!apiKey) throw new Error("No API key");

      initPlayback(scenario.ambientAudio);

      const callbacks: LiveSessionCallbacks = {
        onAudioData(pcmBase64) {
          enqueuePcm(pcmBase64);
        },
        onInputTranscript(text, finished) {
          if (!text.trim()) return;

          // State machine: idle → capturing on first input
          if (turnStateRef.current === "idle") {
            applyTurnEvent("inputTranscript");
          }

          pendingEvalTextRef.current = text.trim();

          if (finished) {
            const finalText = text.trim();
            const tid = turnIdRef.current;
            setMessagesAndRef((prev) => {
              const filtered = prev.filter((m) => !(m.role === "user" && !m.final));
              return [...filtered, { role: "user", text: finalText, final: true, turnId: tid || undefined }];
            });
          } else {
            setMessagesAndRef((prev) => {
              const filtered = prev.filter((m) => !(m.role === "user" && !m.final));
              return [...filtered, { role: "user", text, final: false }];
            });
          }
        },
        onOutputTranscript(text, finished) {
          // State machine: capturing → sealed on first NPC output
          if (turnStateRef.current === "capturing") {
            applyTurnEvent("outputTranscript");
          }

          if (finished && text.trim()) {
            const finalText = text.trim();
            setMessagesAndRef((prev) => {
              const filtered = prev.filter((m) => !(m.role === "npc" && !m.final));
              return [...filtered, { role: "npc", text: finalText, final: true }];
            });
          } else if (text.trim()) {
            setMessagesAndRef((prev) => {
              const filtered = prev.filter((m) => !(m.role === "npc" && !m.final));
              return [...filtered, { role: "npc", text, final: false }];
            });
          }
        },
        onSlotUpdate(newSlots) {
          setSlots((prev) => ({ ...prev, ...newSlots }));
        },
        onSpeechCorrection(correctedText) {
          correctedEvalTextRef.current = correctedText;
          const tid = turnIdRef.current;
          if (tid) {
            setMessagesAndRef((prev) =>
              prev.map((m) =>
                m.role === "user" && m.turnId === tid && m.final
                  ? { ...m, text: correctedText }
                  : m
              )
            );
          }
        },
        onTurnComplete() {
          // Finalize any non-final messages
          setMessagesAndRef((prev) =>
            prev.map((m) => (m.final ? m : { ...m, final: true }))
          );

          applyTurnEvent("turnComplete");

          // Start recorder for next user turn (captures audio BEFORE user speaks)
          startTurnRecorder();
        },
        onError(err) {
          if (closedRef.current) return;
          setError(err);
          setStatus("error");
        },
        onConnected() {
          setStatus("connected");
          startMic();
        },
        onInterrupted() {
          flushPlaybackQueue();
          applyTurnEvent("interrupted");
        },
      };

      const session = await createLiveSession(apiKey, callbacks, scenario, task, tier);
      sessionRef.current = session;

      async function startMic() {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true, noiseSuppression: true },
          });
          if (closedRef.current) { stream.getTracks().forEach(t => t.stop()); return; }
          micStreamRef.current = stream;

          // PCM capture for Gemini Live
          const micCtx = new AudioContext({ sampleRate: 16000 });
          micCtxRef.current = micCtx;
          const micSource = micCtx.createMediaStreamSource(stream);
          sourceRef.current = micSource;
          const processor = micCtx.createScriptProcessor(4096, 1, 1);
          processorRef.current = processor;

          processor.onaudioprocess = (e) => {
            if (closedRef.current || !sessionRef.current) return;
            const float32 = e.inputBuffer.getChannelData(0);
            const int16 = new Int16Array(float32.length);
            for (let i = 0; i < float32.length; i++) {
              const s = Math.max(-1, Math.min(1, float32[i]));
              int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
            }
            session.sendAudio(uint8ToBase64(new Uint8Array(int16.buffer)));

            // Buffer PCM for turn audio capture (same data Gemini receives)
            pcmRingRef.current.push(new Int16Array(int16));
            if (pcmRingRef.current.length > PCM_RING_MAX) {
              const trim = pcmRingRef.current.length - PCM_RING_MAX;
              pcmRingRef.current = pcmRingRef.current.slice(trim);
              pcmTurnStartRef.current = Math.max(0, pcmTurnStartRef.current - trim);
            }
          };

          micSource.connect(processor);
          processor.connect(micCtx.destination);

          // Connect mic to playback context for mixed conversation recording
          if (playbackCtxRef.current && mixDestRef.current) {
            const mixMicSrc = playbackCtxRef.current.createMediaStreamSource(stream);
            mixMicSrc.connect(mixDestRef.current);

            const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
              ? "audio/webm;codecs=opus" : "audio/webm";
            const chunks: Blob[] = [];
            const recorder = new MediaRecorder(mixDestRef.current.stream, { mimeType });
            recorder.ondataavailable = (ev) => { if (ev.data.size > 0) chunks.push(ev.data); };
            recorder.start(1000);
            mixRecorderRef.current = recorder;
            mixChunksRef.current = chunks;
          }
        } catch (micErr: unknown) {
          setError("Mic: " + (micErr instanceof Error ? micErr.message : String(micErr)));
          setStatus("error");
        }
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus("error");
    }
  }, [initPlayback, enqueuePcm, flushPlaybackQueue, cleanupMic, cleanupPlayback]);

  const disconnect = useCallback(() => {
    closedRef.current = true;
    sessionRef.current?.close();
    sessionRef.current = null;

    // Finalize all messages
    setMessagesAndRef((prev) =>
      prev.map((m) => (m.final ? m : { ...m, final: true }))
    );

    // Apply disconnect event to consume any pending audio
    applyTurnEvent("disconnect");
    cleanupMic();

    // Stop mix recorder → create full conversation audio → then cleanup playback
    if (mixRecorderRef.current?.state === "recording") {
      const recorder = mixRecorderRef.current;
      const chunks = mixChunksRef.current;
      recorder.onstop = () => {
        if (chunks.length > 0) {
          const blob = new Blob(chunks, { type: recorder.mimeType });
          setFullAudioUrl(URL.createObjectURL(blob));
        }
        cleanupPlayback();
      };
      recorder.stop();
      mixRecorderRef.current = null;
      mixChunksRef.current = [];
    } else {
      cleanupPlayback();
    }

    setStatus("idle");
    setNpcSpeaking(false);
  }, [cleanupMic, cleanupPlayback]);

  const reset = useCallback(() => {
    setMessagesAndRef([]);
    setSlots({});
    setError(null);
    setFullAudioUrl(null);
  }, []);

  useEffect(() => {
    return () => {
      closedRef.current = true;
      sessionRef.current?.close();
      cleanupMic();
      cleanupPlayback();
    };
  }, [cleanupMic, cleanupPlayback]);

  const waitForEvalData = useCallback((timeoutMs = 3000): Promise<TranscriptMessage[]> => {
    return new Promise((resolve) => {
      const deadline = Date.now() + timeoutMs;

      function check() {
        const msgs = messagesRef.current;
        const finalUserMsgs = msgs.filter((m) => m.final && m.role === "user");
        const allReady = finalUserMsgs.length === 0 || finalUserMsgs.every((m) => !m.evalPending);

        if (allReady || Date.now() >= deadline) {
          if (!allReady) {
            console.warn("[waitForEvalData] timeout, proceeding with available data");
          }
          resolve(msgs.filter((m) => m.final && m.text.trim()));
        } else {
          setTimeout(check, 300);
        }
      }
      check();
    });
  }, []);

  return {
    status,
    slots,
    messages,
    npcSpeaking,
    error,
    fullAudioUrl,
    connect,
    disconnect,
    reset,
    waitForEvalData,
  };
}
