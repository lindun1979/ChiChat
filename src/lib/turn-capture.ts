export type TurnCaptureState = "idle" | "capturing" | "sealed";

export type TurnEvent =
  | "inputTranscript"
  | "outputTranscript"
  | "turnComplete"
  | "interrupted"
  | "disconnect";

export interface TurnAction {
  nextState: TurnCaptureState;
  stopRecorder: boolean;
  startNewRecorder: boolean;
  generateTurnId: boolean;
  consumeAudio: boolean;
  discardAudio: boolean;
  warn?: string;
}

const NOOP: TurnAction = {
  nextState: "idle",
  stopRecorder: false,
  startNewRecorder: false,
  generateTurnId: false,
  consumeAudio: false,
  discardAudio: false,
};

export function nextTurnAction(
  state: TurnCaptureState,
  event: TurnEvent,
): TurnAction {
  if (state === "idle") {
    switch (event) {
      case "inputTranscript":
        return {
          ...NOOP,
          nextState: "capturing",
          generateTurnId: true,
          startNewRecorder: true,
        };
      case "outputTranscript":
      case "turnComplete":
      case "interrupted":
      case "disconnect":
        return { ...NOOP, nextState: "idle" };
    }
  }

  if (state === "capturing") {
    switch (event) {
      case "inputTranscript":
        return { ...NOOP, nextState: "capturing" };
      case "outputTranscript":
        return {
          ...NOOP,
          nextState: "sealed",
          stopRecorder: true,
          startNewRecorder: true,
        };
      case "turnComplete":
        // NPC didn't produce output transcript before turnComplete
        return {
          ...NOOP,
          nextState: "idle",
          stopRecorder: true,
          consumeAudio: true,
          startNewRecorder: true,
        };
      case "interrupted":
        return {
          ...NOOP,
          nextState: "idle",
          stopRecorder: true,
          discardAudio: true,
          startNewRecorder: true,
        };
      case "disconnect":
        return {
          ...NOOP,
          nextState: "idle",
          stopRecorder: true,
          consumeAudio: true,
        };
    }
  }

  if (state === "sealed") {
    switch (event) {
      case "inputTranscript":
        return {
          ...NOOP,
          nextState: "sealed",
          warn: "inputTranscript during sealed state, ignoring",
        };
      case "outputTranscript":
        return { ...NOOP, nextState: "sealed" };
      case "turnComplete":
        return {
          ...NOOP,
          nextState: "idle",
          consumeAudio: true,
        };
      case "interrupted":
        // User audio is already sealed (complete); barge-in only interrupts NPC output.
        // Preserve sealed audio — it will be consumed on the next turnComplete.
        return { ...NOOP, nextState: "sealed" };
      case "disconnect":
        return {
          ...NOOP,
          nextState: "idle",
          consumeAudio: true,
        };
    }
  }

  return { ...NOOP, nextState: state };
}

// --- PCM → WAV conversion ---

function writeString(view: DataView, offset: number, s: string) {
  for (let i = 0; i < s.length; i++) {
    view.setUint8(offset + i, s.charCodeAt(i));
  }
}

export function pcmToWav(chunks: Int16Array[], sampleRate: number): Blob {
  const totalSamples = chunks.reduce((sum, c) => sum + c.length, 0);
  const dataSize = totalSamples * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, "data");
  view.setUint32(40, dataSize, true);

  let off = 44;
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.length; i++) {
      view.setInt16(off, chunk[i], true);
      off += 2;
    }
  }

  return new Blob([buffer], { type: "audio/wav" });
}
