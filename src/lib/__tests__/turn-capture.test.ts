import { describe, it, expect } from "vitest";
import { nextTurnAction, type TurnCaptureState, type TurnEvent } from "../turn-capture";

function action(state: TurnCaptureState, event: TurnEvent) {
  return nextTurnAction(state, event);
}

describe("nextTurnAction", () => {
  // --- idle ---
  describe("idle state", () => {
    it("inputTranscript → capturing, generateTurnId, startNewRecorder", () => {
      const a = action("idle", "inputTranscript");
      expect(a.nextState).toBe("capturing");
      expect(a.generateTurnId).toBe(true);
      expect(a.startNewRecorder).toBe(true);
      expect(a.stopRecorder).toBe(false);
    });

    it.each(["outputTranscript", "turnComplete", "interrupted", "disconnect"] as TurnEvent[])(
      "%s → stays idle, no actions",
      (event) => {
        const a = action("idle", event);
        expect(a.nextState).toBe("idle");
        expect(a.stopRecorder).toBe(false);
        expect(a.consumeAudio).toBe(false);
        expect(a.discardAudio).toBe(false);
      },
    );
  });

  // --- capturing ---
  describe("capturing state", () => {
    it("inputTranscript → stays capturing", () => {
      const a = action("capturing", "inputTranscript");
      expect(a.nextState).toBe("capturing");
      expect(a.stopRecorder).toBe(false);
    });

    it("outputTranscript → sealed, stop + startNew", () => {
      const a = action("capturing", "outputTranscript");
      expect(a.nextState).toBe("sealed");
      expect(a.stopRecorder).toBe(true);
      expect(a.startNewRecorder).toBe(true);
      expect(a.consumeAudio).toBe(false);
    });

    it("turnComplete → idle, stop + consume + startNew (NPC skipped output)", () => {
      const a = action("capturing", "turnComplete");
      expect(a.nextState).toBe("idle");
      expect(a.stopRecorder).toBe(true);
      expect(a.consumeAudio).toBe(true);
      expect(a.startNewRecorder).toBe(true);
    });

    it("interrupted → idle, stop + discard + startNew", () => {
      const a = action("capturing", "interrupted");
      expect(a.nextState).toBe("idle");
      expect(a.stopRecorder).toBe(true);
      expect(a.discardAudio).toBe(true);
      expect(a.startNewRecorder).toBe(true);
      expect(a.consumeAudio).toBe(false);
    });

    it("disconnect → idle, stop + consume, no startNew", () => {
      const a = action("capturing", "disconnect");
      expect(a.nextState).toBe("idle");
      expect(a.stopRecorder).toBe(true);
      expect(a.consumeAudio).toBe(true);
      expect(a.startNewRecorder).toBe(false);
    });
  });

  // --- sealed ---
  describe("sealed state", () => {
    it("inputTranscript → stays sealed with warning", () => {
      const a = action("sealed", "inputTranscript");
      expect(a.nextState).toBe("sealed");
      expect(a.warn).toBeTruthy();
      expect(a.consumeAudio).toBe(false);
    });

    it("outputTranscript → stays sealed", () => {
      const a = action("sealed", "outputTranscript");
      expect(a.nextState).toBe("sealed");
    });

    it("turnComplete → idle, consume audio", () => {
      const a = action("sealed", "turnComplete");
      expect(a.nextState).toBe("idle");
      expect(a.consumeAudio).toBe(true);
      expect(a.discardAudio).toBe(false);
    });

    it("interrupted → stays sealed (preserves sealed audio)", () => {
      const a = action("sealed", "interrupted");
      expect(a.nextState).toBe("sealed");
      expect(a.discardAudio).toBe(false);
      expect(a.consumeAudio).toBe(false);
    });

    it("disconnect → idle, consume audio", () => {
      const a = action("sealed", "disconnect");
      expect(a.nextState).toBe("idle");
      expect(a.consumeAudio).toBe(true);
    });
  });
});
