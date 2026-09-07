import { describe, expect, it } from "vitest";
import { CONFIG } from "../src/config.js";
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
    paint?: {
      pinch?: number | null;
      pinchMetres?: number | null;
      pinched?: boolean;
      touching?: boolean;
      painting?: boolean;
      tool?: string;
      strokes?: number;
      hovered?: string | null;
    };
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
      world: [],
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
      paint:
        options.paint === undefined
          ? null
          : {
              pinch: options.paint.pinch ?? null,
              pinchMetres: options.paint.pinchMetres ?? null,
              pinched: options.paint.pinched ?? false,
              // A pinched hand is touching unless the sample says otherwise.
              touching: options.paint.touching ?? options.paint.pinched ?? false,
              handSize:
                options.paint.pinch === null || options.paint.pinch === undefined ? null : 0.15,
              painting: options.paint.painting ?? false,
              tool: options.paint.tool ?? "brush #97eeda 0.018",
              strokes: options.paint.strokes ?? 0,
              hovered: options.paint.hovered ?? null,
              panels: [],
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

  it("says nothing about paint when the take never went there", () => {
    const digest = digestTrace([sample(0), sample(16)]);
    expect(digest.paint).toBeNull();
    expect(describeDigest(digest)).not.toContain("pinch");
  });

  it("reports where the pinch landed, how often it closed, and what was drawn", () => {
    const digest = digestTrace([
      sample(0, { gestures: ["None"], mode: "paint", paint: { pinch: 1.1 } }),
      sample(16, { gestures: ["None"], mode: "paint", paint: { pinch: 0.5 } }),
      sample(32, {
        gestures: ["None"],
        mode: "paint",
        paint: { pinch: 0.2, pinched: true, painting: true, strokes: 1 },
      }),
      sample(48, {
        gestures: ["None"],
        mode: "paint",
        paint: { pinch: 0.15, pinched: true, painting: true, strokes: 1, tool: "erase 0.036" },
      }),
      // No hand: the ratio is null and does not count against the pinch fraction.
      sample(64, { gestures: [], mode: "paint", paint: { pinch: null, strokes: 1 } }),
      sample(80, { gestures: ["None"], mode: "paint", paint: { pinch: 0.9, hovered: "erase" } }),
    ]);
    expect(digest.paint).toEqual({
      pinched: 0.4,
      loose: 0,
      painting: 2,
      strokes: 1,
      strokesDrawn: 1,
      pinch: { min: 0.15, median: 0.5, max: 1.1 },
      // Nothing in this take carried world landmarks.
      metres: null,
      histogram: [
        { at: 0.15, frames: 1 },
        { at: 0.2, frames: 1 },
        { at: 0.5, frames: 1 },
        { at: 0.9, frames: 1 },
        { at: 1.1, frames: 1 },
      ],
      // The one frame the stroke count rose on, which is the frame the gate
      // decided to start drawing.
      strokeStarts: [0.2],
      gate: {
        closeBelow: CONFIG.paint.pinch.closeBelow,
        openAbove: CONFIG.paint.pinch.openAbove,
      },
      tools: ["brush #97eeda 0.018", "erase 0.036", "brush #97eeda 0.018"],
    });
    expect(digest.hovered).toEqual([{ panel: "erase", frames: 1 }]);
    const line = describeDigest(digest);
    expect(line).toContain("pinched 40%");
    expect(line).toContain("1 line(s) drawn");
    expect(line).toContain("pinch 0.15-1.10");
    expect(line).toContain("3 tools");
  });

  it("counts the pinched frames whose ink was held back, and says so in one line", () => {
    // The instrument the parted-pinch complaint needed: `pinched` alone read
    // 68% on a take where the fingertips were apart for most of that. Older
    // traces carry no `touching` and are read as never loose. See ADR 0023.
    const digest = digestTrace([
      sample(0, { mode: "paint", paint: { pinch: 0.12, pinched: true, painting: true } }),
      sample(16, { mode: "paint", paint: { pinch: 0.24, pinched: true, touching: false } }),
      sample(32, { mode: "paint", paint: { pinch: 0.25, pinched: true, touching: false } }),
      sample(48, { mode: "paint", paint: { pinch: 0.11, pinched: true, touching: true } }),
      sample(64, { mode: "paint", paint: { pinch: 0.5 } }),
    ]);
    expect(digest.paint?.pinched).toBe(0.8);
    expect(digest.paint?.loose).toBe(0.5);
    expect(describeDigest(digest)).toContain("pinched 80% (50% of it loose)");
  });

  it("files a ratio sitting on a bucket edge in its own bucket", () => {
    // 0.15 / 0.05 is 2.9999999999999996, so dividing would file a hand held at
    // exactly one threshold in the bucket below it - and these buckets exist to
    // decide where a threshold goes.
    const digest = digestTrace([
      sample(0, { mode: "paint", paint: { pinch: 0.15 } }),
      sample(16, { mode: "paint", paint: { pinch: 0.15 } }),
      sample(32, { mode: "paint", paint: { pinch: 0.2 } }),
      sample(48, { mode: "paint", paint: { pinch: 0.34 } }),
    ]);
    expect(digest.paint?.histogram).toEqual([
      { at: 0.15, frames: 2 },
      { at: 0.2, frames: 1 },
      { at: 0.3, frames: 1 },
    ]);
  });

  it("names the ratio every line began at, and counts a line after a clear", () => {
    const digest = digestTrace([
      sample(0, { mode: "paint", paint: { pinch: 0.6, strokes: 0 } }),
      sample(16, { mode: "paint", paint: { pinch: 0.18, strokes: 1, painting: true } }),
      sample(32, { mode: "paint", paint: { pinch: 0.17, strokes: 1, painting: true } }),
      sample(48, { mode: "paint", paint: { pinch: 0.7, strokes: 1 } }),
      sample(64, { mode: "paint", paint: { pinch: 0.12, strokes: 2, painting: true } }),
      // The bin: back to nothing, and the next line is still a new line.
      sample(80, { mode: "paint", paint: { pinch: 0.7, strokes: 0 } }),
      sample(96, { mode: "paint", paint: { pinch: 0.19, strokes: 1, painting: true } }),
    ]);
    expect(digest.paint?.strokeStarts).toEqual([0.18, 0.12, 0.19]);
  });

  it("tells lines this take drew apart from lines already on the glass", () => {
    // A painting survives from one take to the next. The take that held one
    // pinch for thirty seconds started with five strokes on the glass and ended
    // with seven, and "7 stroke(s)" was read as six breaks. See friction 0031.
    const digest = digestTrace([
      sample(0, { mode: "paint", paint: { pinch: 0.6, strokes: 5 } }),
      sample(16, { mode: "paint", paint: { pinch: 0.1, strokes: 6, painting: true } }),
      sample(32, { mode: "paint", paint: { pinch: 0.1, strokes: 6, painting: true } }),
      sample(48, { mode: "paint", paint: { pinch: 0.7, strokes: 6 } }),
      sample(64, { mode: "paint", paint: { pinch: 0.1, strokes: 7, painting: true } }),
    ]);
    expect(digest.paint?.strokes).toBe(7);
    expect(digest.paint?.strokesDrawn).toBe(2);
    expect(describeDigest(digest)).toContain("2 line(s) drawn, 7 on the glass");
  });

  it("reports the metric gap when the take carried world landmarks", () => {
    const digest = digestTrace([
      sample(0, { mode: "paint", paint: { pinch: 0.5, pinchMetres: 0.0612 } }),
      sample(16, { mode: "paint", paint: { pinch: 0.1, pinchMetres: 0.0198 } }),
      sample(32, { mode: "paint", paint: { pinch: 0.12, pinchMetres: 0.0234 } }),
    ]);
    expect(digest.paint?.metres).toEqual({ min: 0.02, median: 0.023, max: 0.061 });
    expect(describeDigest(digest)).toContain("20-61 mm");
  });

  it("derives the loop rate from the trace's own gaps", () => {
    // 16 ms apart is 62.5 fps; one 50 ms gap is a dropped stretch at 20 fps.
    const digest = digestTrace([sample(0), sample(16), sample(32), sample(82)]);
    expect(digest.fps.max).toBeCloseTo(62.5, 1);
    expect(digest.fps.min).toBeCloseTo(20, 1);
    expect(digest.durationMs).toBe(82);
  });
});
