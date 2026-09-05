import { describe, expect, it } from "vitest";
import { describeDigest, digestTrace, type TraceSample } from "../src/debug/trace.js";
import type { GestureName, Vec2 } from "../src/perception/types.js";

/**
 * The numbers a recording is read by.
 *
 * Nobody watches a debug video first; they read the digest and open the video
 * only if it says something interesting. So the digest has to be right about
 * the two questions it is asked: was anything there, and did the machine agree.
 */
function sample(
  ms: number,
  options: {
    gestures?: GestureName[];
    face?: boolean;
    cursor?: Vec2 | null;
    dwell?: number;
    activated?: boolean;
    hovered?: string | null;
    mode?: string;
    phase?: string;
    said?: string;
  } = {},
): TraceSample {
  const gestures = options.gestures ?? [];
  return {
    ms,
    seq: Math.round(ms / 16),
    hands: gestures.map((gesture, index) => ({
      side: index === 0 ? "right" : "left",
      gesture,
      confidence: 0.9,
      indexTip: { x: 0.5, y: 0.4 },
      palmCenter: { x: 0.5, y: 0.5 },
      landmarks: [],
    })),
    faces:
      options.face === true
        ? [{ trackId: "face-1", box: { x: 0.4, y: 0.2, width: 0.2, height: 0.3 }, confidence: 0.9 }]
        : [],
    cursor: {
      position: options.cursor === undefined ? { x: 0.5, y: 0.4 } : options.cursor,
      dwell: options.dwell ?? 0,
      activated: options.activated ?? false,
      gesture: gestures[0] ?? "None",
    },
    heard: options.said === undefined ? [] : [{ text: options.said, source: "microphone" }],
    scene: {
      mode: options.mode ?? "home",
      phase: options.phase ?? "idle",
      menu: {
        hovered: options.hovered ?? null,
        panels: [
          { id: "picture", rect: { x: 0.4, y: 0.03, width: 0.07, height: 0.13 }, glow: 0.5 },
        ],
      },
    },
  };
}

describe("digestTrace", () => {
  it("says nothing rather than dividing by zero on an empty take", () => {
    const digest = digestTrace([]);
    expect(digest.frames).toBe(0);
    expect(digest.handsSeen).toBe(0);
    expect(digest.fps.median).toBe(0);
  });

  it("reports how much of the take had a hand, a face and a cursor in it", () => {
    const digest = digestTrace([
      sample(0, { gestures: ["None"], face: true }),
      sample(16, { face: true, cursor: null, gestures: [] }),
      sample(32, { gestures: ["Victory"], face: true }),
      sample(48, { gestures: ["Victory"], face: true }),
    ]);
    expect(digest.frames).toBe(4);
    expect(digest.handsSeen).toBe(0.75);
    expect(digest.facesSeen).toBe(1);
    expect(digest.cursorSeen).toBe(0.75);
  });

  it("counts a two-handed gesture once, so a fraction stays a fraction", () => {
    // Counting per hand made a pair of open palms read as 200% of the take.
    const digest = digestTrace([
      sample(0, { gestures: ["Open_Palm", "Open_Palm"] }),
      sample(16, { gestures: ["Open_Palm", "Open_Palm"] }),
    ]);
    expect(digest.gestures).toEqual([{ gesture: "Open_Palm", frames: 2 }]);
    expect(describeDigest(digest)).toContain("Open_Palm 100%");
  });

  it("keeps both labels when the two hands disagree", () => {
    const digest = digestTrace([sample(0, { gestures: ["Victory", "None"] })]);
    expect(digest.gestures).toEqual([
      { gesture: "Victory", frames: 1 },
      { gesture: "None", frames: 1 },
    ]);
  });

  it("names the frames nothing was in, which is the usual answer", () => {
    const digest = digestTrace([sample(0, { gestures: [] }), sample(16, { gestures: [] })]);
    expect(digest.gestures).toEqual([{ gesture: "no hand", frames: 2 }]);
    expect(describeDigest(digest)).toContain("hands 0%");
  });

  it("records where the cursor was, how close it came, and what it picked", () => {
    const digest = digestTrace([
      sample(0, { gestures: ["Pointing_Up"], hovered: "picture", dwell: 0.2 }),
      sample(16, { gestures: ["Pointing_Up"], hovered: "picture", dwell: 0.9 }),
      sample(32, { gestures: ["Pointing_Up"], hovered: "picture", dwell: 1, activated: true }),
      sample(48, { gestures: ["Pointing_Up"], hovered: null }),
    ]);
    expect(digest.hovered).toEqual([{ panel: "picture", frames: 3 }]);
    expect(digest.maxDwell).toBe(1);
    expect(digest.activations).toBe(1);
  });

  it("follows the interface through the take, without repeating itself", () => {
    const digest = digestTrace([
      sample(0, { mode: "home", phase: "idle" }),
      sample(16, { mode: "home", phase: "idle" }),
      sample(32, { mode: "picture", phase: "idle" }),
      sample(48, { mode: "picture", phase: "countdown" }),
      sample(64, { mode: "picture", phase: "countdown" }),
    ]);
    expect(digest.visited).toEqual(["home/idle", "picture/idle", "picture/countdown"]);
  });

  it("keeps what was said, and when it was said", () => {
    const digest = digestTrace([
      sample(0),
      sample(1200, { said: " Stop." }),
      sample(1216),
      sample(2400, { said: "it never opened" }),
    ]);
    expect(digest.said).toEqual([
      { ms: 1200, text: " Stop.", source: "microphone" },
      { ms: 2400, text: "it never opened", source: "microphone" },
    ]);
    expect(describeDigest(digest)).toContain('said "Stop.", "it never opened"');
  });

  it("derives the loop rate from the trace's own gaps", () => {
    // 16 ms apart is 62.5 fps; one 50 ms gap is a dropped stretch at 20 fps.
    const digest = digestTrace([sample(0), sample(16), sample(32), sample(82)]);
    expect(digest.fps.max).toBeCloseTo(62.5, 1);
    expect(digest.fps.min).toBeCloseTo(20, 1);
    expect(digest.durationMs).toBe(82);
  });
});
