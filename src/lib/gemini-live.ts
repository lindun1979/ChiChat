import { GoogleGenAI, Modality, type Session, type LiveServerMessage } from "@google/genai";
import type { Task } from "./task-generator";
import type { Tier } from "./progression";
import { type ScenarioConfig, type SlotValues, buildSlotTool, buildCorrectionTool } from "./scenarios";

function buildSystemInstruction(scenario: ScenarioConfig, task?: Task, tier?: Tier): string {
  let instruction = scenario.systemInstruction;
  if (tier && scenario.tierInstructions?.[tier]) {
    instruction += `\n\nAdapt your behavior to this learner's level:\n${scenario.tierInstructions[tier]}`;
  }
  if (task) {
    instruction += `\n\n[Internal — the customer's goal this session is: ${task.objective}. Guide them naturally if they seem unsure, but don't reveal the goal directly. Let them practice on their own.]`;
  }
  instruction += `\n\nAfter each user speech turn, call correct_user_speech with the corrected transcript.\nRules:\n- Only fix words where ASR clearly misheard a similar-sounding word (homophones, accent errors)\n- Keep the user's EXACT phrasing, grammar, and sentence structure\n- Do NOT add words the user didn't say\n- Do NOT replace the user's words with words from your own response\n- If nothing needs fixing, call the function with the original transcript unchanged`;
  return instruction;
}

export type { SlotValues };

export interface LiveSessionCallbacks {
  onAudioData: (pcmBase64: string) => void;
  onInputTranscript: (text: string, finished: boolean) => void;
  onOutputTranscript: (text: string, finished: boolean) => void;
  onSlotUpdate: (slots: SlotValues) => void;
  onSpeechCorrection: (correctedText: string) => void;
  onTurnComplete: () => void;
  onError: (error: string) => void;
  onConnected: () => void;
  onInterrupted: () => void;
}

export interface LiveSession {
  sendAudio: (pcmBase64: string) => void;
  close: () => void;
}

export async function createLiveSession(
  apiKey: string,
  callbacks: LiveSessionCallbacks,
  scenario: ScenarioConfig,
  task?: Task,
  tier?: Tier,
): Promise<LiveSession> {
  const ai = new GoogleGenAI({ apiKey });
  let setupDone = false;
  let inputAccum = "";
  let outputAccum = "";

  const session = await ai.live.connect({
    model: "gemini-3.1-flash-live-preview",
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: scenario.voiceName },
        },
      },
      systemInstruction: buildSystemInstruction(scenario, task, tier),
      tools: [buildSlotTool(scenario), buildCorrectionTool()],
      inputAudioTranscription: {},
      outputAudioTranscription: {},
    },
    callbacks: {
      onopen() {
        callbacks.onConnected();
      },
      onmessage(msg: LiveServerMessage) {
        if (msg.setupComplete && !setupDone) {
          setupDone = true;
          session.sendClientContent({
            turns: [{ role: "user", parts: [{ text: scenario.openingAction }] }],
            turnComplete: true,
          });
          return;
        }
        handleMessage(msg, session, callbacks, { inputAccum, outputAccum }, (ia, oa) => {
          inputAccum = ia;
          outputAccum = oa;
        });
      },
      onerror(e: ErrorEvent) {
        callbacks.onError(e.message || "WebSocket error");
      },
      onclose(e: CloseEvent) {
        callbacks.onError(`Connection closed (${e.code}${e.reason ? ": " + e.reason : ""})`);
      },
    },
  });

  return {
    sendAudio(pcmBase64: string) {
      session.sendRealtimeInput({
        audio: { data: pcmBase64, mimeType: "audio/pcm;rate=16000" },
      });
    },
    close() {
      session.close();
    },
  };
}

function handleMessage(
  msg: LiveServerMessage,
  session: Session,
  callbacks: LiveSessionCallbacks,
  accum: { inputAccum: string; outputAccum: string },
  setAccum: (ia: string, oa: string) => void,
) {
  const content = msg.serverContent;
  let { inputAccum, outputAccum } = accum;

  if (content?.inputTranscription) {
    if (content.inputTranscription.text) {
      inputAccum += content.inputTranscription.text;
    }
    if (inputAccum) {
      callbacks.onInputTranscript(inputAccum, !!content.inputTranscription.finished);
    }
    if (content.inputTranscription.finished) {
      inputAccum = "";
    }
  }

  if (content?.outputTranscription) {
    if (content.outputTranscription.text) {
      outputAccum += content.outputTranscription.text;
    }
    if (outputAccum) {
      callbacks.onOutputTranscript(outputAccum, !!content.outputTranscription.finished);
    }
    if (content.outputTranscription.finished) {
      outputAccum = "";
    }
  }

  if (content?.interrupted) {
    callbacks.onInterrupted();
    inputAccum = "";
    outputAccum = "";
  }

  if (content?.modelTurn?.parts) {
    for (const part of content.modelTurn.parts) {
      if (part.inlineData?.data && part.inlineData.mimeType?.startsWith("audio/")) {
        callbacks.onAudioData(part.inlineData.data);
      }
    }
  }

  if (content?.turnComplete) {
    outputAccum = "";
    inputAccum = "";
    callbacks.onTurnComplete();
  }

  if (msg.toolCall?.functionCalls) {
    const responses: Array<{ id: string; name: string; response: Record<string, unknown> }> = [];
    for (const fc of msg.toolCall.functionCalls) {
      if (fc.name === "update_slots" && fc.args) {
        callbacks.onSlotUpdate(fc.args as SlotValues);
      }
      if (fc.name === "correct_user_speech" && fc.args) {
        const corrected = (fc.args as { corrected_transcript: string }).corrected_transcript;
        if (corrected) {
          callbacks.onSpeechCorrection(corrected);
        }
      }
      responses.push({
        id: fc.id!,
        name: fc.name!,
        response: { success: true },
      });
    }
    session.sendToolResponse({ functionResponses: responses });
  }

  setAccum(inputAccum, outputAccum);
}
