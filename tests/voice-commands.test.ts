import { describe, expect, it } from "vitest";
import { routeUtterance } from "../src/interaction/voice-commands.js";
import type { Utterance } from "../src/perception/types.js";
import { cleanTranscript, isHallucination, wordsOf } from "../src/perception/voice.js";

/**
 * What the station does about something it heard.
 *
 * The stakes are asymmetric. Missing a "stop" costs a second and a second try;
 * acting on the word "stop" inside a sentence somebody is dictating destroys
 * the recording they are describing. The rules below are written that way.
 */
function said(text: string): Utterance {
  return {
    text,
    words: wordsOf(text),
    startedAt: 0,
    endedAt: 1000,
    source: "microphone",
  };
}

describe("wordsOf", () => {
  it("strips what Whisper writes around a word", () => {
    // The model returns English, not tokens: " Stop." is the usual shape of it.
    expect(wordsOf(" Stop.")).toEqual(["stop"]);
    expect(wordsOf("OK, stop!")).toEqual(["ok", "stop"]);
    expect(wordsOf("it doesn't work")).toEqual(["it", "doesn't", "work"]);
  });

  it("has nothing to say about silence", () => {
    expect(wordsOf("")).toEqual([]);
    expect(wordsOf("  ...  ")).toEqual([]);
  });
});

describe("cleanTranscript", () => {
  it("drops the noises Whisper describes instead of transcribing", () => {
    // These are what it answers with when nobody is talking, and they would
    // otherwise be dictated into a bug report as though somebody said them.
    for (const noise of ["[BLANK_AUDIO]", "[ Silence ]", "(wind blowing)", "[MUSIC]"]) {
      expect(cleanTranscript(noise), noise).toBe("");
      expect(wordsOf(cleanTranscript(noise)), noise).toEqual([]);
    }
  });

  it("keeps the words either side of one", () => {
    expect(cleanTranscript(" It [door slams] stopped tracking. ")).toBe("It stopped tracking.");
  });

  it("leaves an ordinary sentence alone", () => {
    expect(cleanTranscript(" Stop.")).toBe("Stop.");
  });
});

describe("isHallucination", () => {
  it("drops what Whisper says about a room with nobody talking in it", () => {
    for (const noise of ["you", "thank you", "bye", "so"]) {
      expect(isHallucination(wordsOf(noise)), noise).toBe(true);
    }
  });

  it("keeps the same words inside a sentence, because people say them", () => {
    expect(isHallucination(wordsOf("thank you for fixing it"))).toBe(false);
    expect(isHallucination(wordsOf("so it lost my hand"))).toBe(false);
    expect(isHallucination(wordsOf("stop"))).toBe(false);
  });
});

describe("routeUtterance", () => {
  const recording = { dictating: false, recording: true };
  const idle = { dictating: false, recording: false };
  const naming = { dictating: true, recording: false };

  it("stops a running take when someone says so", () => {
    expect(routeUtterance(said(" Stop."), recording)).toEqual({ kind: "stop" });
    expect(routeUtterance(said("ok stop"), recording)).toEqual({ kind: "stop" });
  });

  it("hears stop inside a sentence, because people talk in sentences", () => {
    expect(routeUtterance(said("all right, stop now"), recording)).toEqual({ kind: "stop" });
  });

  it("does not hear it inside another word", () => {
    expect(routeUtterance(said("it stopped tracking"), recording)).toEqual({ kind: "none" });
    expect(routeUtterance(said("the stoplight"), recording)).toEqual({ kind: "none" });
  });

  it("does nothing when there is nothing to stop", () => {
    expect(routeUtterance(said("stop"), idle)).toEqual({ kind: "none" });
  });

  it("writes down everything while a description is waiting for words", () => {
    expect(routeUtterance(said(" It lost my hand when I stepped back."), naming)).toEqual({
      kind: "dictate",
      text: "It lost my hand when I stepped back.",
    });
  });

  it("writes down the word stop rather than obeying it while dictating", () => {
    // Somebody describing a bug says "it stopped" and "stop tracking me". None
    // of that may operate the recorder they are describing.
    expect(routeUtterance(said("and then it just stopped, so I said stop"), naming)).toEqual({
      kind: "dictate",
      text: "and then it just stopped, so I said stop",
    });
  });

  it("ignores an utterance with no words in it", () => {
    expect(routeUtterance(said("   "), naming)).toEqual({ kind: "none" });
  });
});
