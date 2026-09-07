import { CONFIG } from "../config.js";
import type { GestureName, Rect, Vec2, Vec3 } from "../perception/types.js";
import type { SceneSample } from "../ui/experience.js";

/**
 * What one recording remembers about every frame, and what it adds up to.
 *
 * The video shows what the camera saw. The trace shows what the machine made of
 * it, which is the half that is usually wrong, and the digest is that half in
 * numbers small enough to print. A recording nobody has watched can still say
 * "a hand was in 82% of frames and the gesture came back None in all of them",
 * and that sentence is the whole point of the tool.
 *
 * Kept apart from the recorder because it is the only part of this that is pure
 * logic, so it is the only part that can be unit tested. See tests/trace.test.ts.
 */

/** One processed frame, projected down to what a bug report can use. */
export interface TraceSample {
  /** ms from the start of the video, so it doubles as a scrub position. */
  ms: number;
  seq: number;
  hands: Array<{
    side: string;
    gesture: GestureName;
    confidence: number;
    indexTip: Vec2;
    palmCenter: Vec2;
    landmarks: Vec2[];
    /** In metres, to a tenth of a millimetre. Empty on takes from before ADR 0021. */
    world: Vec3[];
  }>;
  faces: Array<{ trackId: string; box: Rect; confidence: number }>;
  cursor: { position: Vec2 | null; dwell: number; activated: boolean; gesture: GestureName };
  /**
   * Where the interface was while that was happening. Without it a trace can
   * say the cursor was at 0.5, 0.2 and never that the tile was there too.
   */
  scene: SceneSample;
  /** Anything said on this frame. Usually empty. See ADR 0016. */
  heard: Array<{ text: string; source: string }>;
}

export type { SceneSample };

/** A recording's trace in numbers. Computed in the browser, stored with the take. */
export interface TraceDigest {
  frames: number;
  durationMs: number;
  /** Fraction of frames with at least one hand, face, cursor. */
  handsSeen: number;
  facesSeen: number;
  cursorSeen: number;
  /** Frames in which at least one hand held each label, most frequent first. */
  gestures: Array<{ gesture: string; frames: number }>;
  /** Frames the cursor spent over each panel. */
  hovered: Array<{ panel: string; frames: number }>;
  maxDwell: number;
  activations: number;
  /** Modes and phases the interface passed through, in order. */
  visited: string[];
  /** Everything said during the take, in order, with when it was said. */
  said: Array<{ ms: number; text: string; source: string }>;
  /**
   * Paint mode, when the take passed through it.
   *
   * This is the block CONFIG.paint.pinch is tuned from, so it reports the
   * *distribution* rather than only the extremes. A hand meaning to paint and
   * the same hand merely moving are two clusters of ratio about 0.3 apart, and
   * min/median/max over a whole take smears them into one number; the
   * histogram keeps them apart, and the threshold belongs in the valley
   * between them. `strokeStarts` is the sharpest evidence of all: the ratio at
   * the instant the gate decided to begin each line. A line the person did not
   * mean to draw names the number that let it through.
   */
  paint: {
    /** Fraction of the frames that had a hand in which it was pinched. */
    pinched: number;
    /**
     * Fraction of the pinched frames in which the fingers had left contact and
     * the ink was being held back. Zero on takes from before ADR 0023, which
     * did not record it. The take that named the problem would have read 0.72
     * here: for nearly three quarters of the time the gate called the hand
     * pinched, the fingertips were apart. `pinched` alone could not show that.
     */
    loose: number;
    /** Frames spent laying ink. */
    painting: number;
    /**
     * The most strokes there were on the glass during the take. The painting
     * survives from one take to the next, so this counts lines from earlier
     * takes too; it is not how many this take drew. That is `strokesDrawn`.
     * A take that held one pinch for thirty seconds reported "7 stroke(s)"
     * here and had drawn two of them. See friction 0031.
     */
    strokes: number;
    /** Lines this take began: every rise in the stroke count while it ran. */
    strokesDrawn: number;
    pinch: { min: number; median: number; max: number };
    /**
     * The same spread for the metric gap, in metres, when the take carried
     * world landmarks; null before ADR 0021. Not a histogram yet: no take has
     * put a threshold on it. Grows one when one does.
     */
    metres: { min: number; median: number; max: number } | null;
    /** Non-empty buckets of PINCH_BUCKET, by their lower bound, in order. */
    histogram: Array<{ at: number; frames: number }>;
    /** The ratio on each frame a stroke began, in order. */
    strokeStarts: number[];
    /**
     * The gate that was in force while this take was made, so a digest read
     * weeks later says which thresholds produced it rather than inheriting
     * whatever the config says by then.
     */
    gate: { closeBelow: number; openAbove: number };
    /** Tools in the order they were current. A colour change shows up here. */
    tools: string[];
  } | null;
  /**
   * The loop rate the trace itself implies, from the gaps between samples.
   * Independent of the meter, and the one that matches the video.
   */
  fps: { min: number; median: number; max: number };
}

export function digestTrace(trace: readonly TraceSample[]): TraceDigest {
  const gestures = new Map<string, number>();
  const hovered = new Map<string, number>();
  const visited: string[] = [];
  const said: TraceDigest["said"] = [];
  const gaps: number[] = [];
  const ratios: number[] = [];
  const metres: number[] = [];
  const strokeStarts: number[] = [];
  const tools: string[] = [];
  let hands = 0;
  let faces = 0;
  let cursor = 0;
  let maxDwell = 0;
  let activations = 0;
  let paintFrames = 0;
  let pinched = 0;
  let loose = 0;
  let painting = 0;
  let strokes = 0;
  let strokesDrawn = 0;

  for (const [index, sample] of trace.entries()) {
    if (sample.hands.length > 0) hands++;
    if (sample.faces.length > 0) faces++;
    if (sample.cursor.position !== null) cursor++;
    maxDwell = Math.max(maxDwell, sample.cursor.dwell);
    if (sample.cursor.activated) activations++;

    // Once per frame per distinct label, so the counts stay fractions of the
    // take. Counting per hand made a two-handed Open_Palm read as 200%.
    for (const label of new Set(sample.hands.map((hand) => hand.gesture))) count(gestures, label);
    if (sample.hands.length === 0) count(gestures, "no hand");
    if (sample.scene.menu.hovered !== null) count(hovered, sample.scene.menu.hovered);

    const paint = sample.scene.paint ?? null;
    if (paint !== null) {
      paintFrames++;
      if (paint.hovered !== null) count(hovered, paint.hovered);
      if (paint.pinch !== null) ratios.push(paint.pinch);
      if (paint.pinchMetres !== null && paint.pinchMetres !== undefined) {
        metres.push(paint.pinchMetres);
      }
      if (paint.pinched) pinched++;
      // Older traces have no `touching`; they are read as never loose rather
      // than as always loose, which would misreport every take before it.
      if (paint.pinched && paint.touching === false) loose++;
      if (paint.painting) painting++;
      // A rise in the count is a line that has just been started, and the ratio
      // on this frame is what the gate let through to start it. A clear takes
      // the count back to zero, so the next line's rise is still a rise.
      const previousPaint = trace[index - 1]?.scene.paint ?? null;
      if (previousPaint !== null && paint.strokes > previousPaint.strokes) {
        strokesDrawn++;
        if (paint.pinch !== null) strokeStarts.push(round(paint.pinch, 2));
      }
      strokes = Math.max(strokes, paint.strokes);
      if (tools.at(-1) !== paint.tool) tools.push(paint.tool);
    }

    for (const utterance of sample.heard) {
      said.push({ ms: sample.ms, text: utterance.text, source: utterance.source });
    }

    const where = `${sample.scene.mode}/${sample.scene.phase}`;
    if (visited.at(-1) !== where) visited.push(where);

    const previous = trace[index - 1];
    if (previous !== undefined && sample.ms > previous.ms) gaps.push(sample.ms - previous.ms);
  }

  const frames = trace.length;
  const last = trace.at(-1);
  const rates = gaps.map((gap) => 1000 / gap).sort((a, b) => a - b);
  const sortedRatios = [...ratios].sort((a, b) => a - b);
  const sortedMetres = [...metres].sort((a, b) => a - b);

  return {
    frames,
    durationMs: round(last?.ms ?? 0, 1),
    handsSeen: fraction(hands, frames),
    facesSeen: fraction(faces, frames),
    cursorSeen: fraction(cursor, frames),
    gestures: rank(gestures).map(([gesture, count]) => ({ gesture, frames: count })),
    hovered: rank(hovered).map(([panel, count]) => ({ panel, frames: count })),
    maxDwell: round(maxDwell, 3),
    activations,
    visited,
    said,
    fps: {
      min: round(rates[0] ?? 0, 1),
      median: round(rates[Math.floor(rates.length / 2)] ?? 0, 1),
      max: round(rates.at(-1) ?? 0, 1),
    },
    paint:
      paintFrames === 0
        ? null
        : {
            pinched: fraction(pinched, ratios.length),
            loose: fraction(loose, pinched),
            painting,
            strokes,
            strokesDrawn,
            pinch: {
              min: round(sortedRatios[0] ?? 0, 2),
              median: round(sortedRatios[Math.floor(sortedRatios.length / 2)] ?? 0, 2),
              max: round(sortedRatios.at(-1) ?? 0, 2),
            },
            metres:
              sortedMetres.length === 0
                ? null
                : {
                    // Millimetre precision: a contact is 15-25 mm and the marks are in whole mm.
                    min: round(sortedMetres[0] ?? 0, 3),
                    median: round(sortedMetres[Math.floor(sortedMetres.length / 2)] ?? 0, 3),
                    max: round(sortedMetres.at(-1) ?? 0, 3),
                  },
            histogram: histogramOf(ratios),
            strokeStarts,
            gate: {
              closeBelow: CONFIG.paint.pinch.closeBelow,
              openAbove: CONFIG.paint.pinch.openAbove,
            },
            tools,
          },
  };
}

/**
 * Bucket width for the pinch histogram, in hundredths. 5 is fine enough to
 * place a threshold by eye and coarse enough that a few seconds of a take
 * fills a bar.
 */
const PINCH_BUCKET = 5;
/** Everything above this shares the last bucket. A wide-open hand runs past 1. */
const PINCH_MAX = 120;

/**
 * Only the buckets that have something in them; the reader fills the gaps.
 *
 * Counted in hundredths rather than by dividing the ratio, because 0.15/0.05
 * is 2.9999999999999996 and a hand held at exactly one of these boundaries
 * would be filed in the bucket below its own.
 */
function histogramOf(ratios: readonly number[]): Array<{ at: number; frames: number }> {
  const buckets = new Map<number, number>();
  for (const ratio of ratios) {
    const cents = Math.round(ratio * 100);
    const at = Math.min(PINCH_MAX, Math.floor(cents / PINCH_BUCKET) * PINCH_BUCKET);
    buckets.set(at, (buckets.get(at) ?? 0) + 1);
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([at, frames]) => ({ at: at / 100, frames }));
}

/** One line, for a command that has to fit a run on a terminal row. */
export function describeDigest(digest: TraceDigest): string {
  const gestures = digest.gestures
    .slice(0, 3)
    .map((entry) => `${entry.gesture} ${percent(entry.frames / Math.max(digest.frames, 1))}`)
    .join(", ");
  return (
    `${(digest.durationMs / 1000).toFixed(1)} s · ${digest.frames} frames at ` +
    `${digest.fps.median.toFixed(0)} fps · hands ${percent(digest.handsSeen)} · ` +
    `faces ${percent(digest.facesSeen)} · cursor ${percent(digest.cursorSeen)}` +
    (gestures === "" ? "" : ` · ${gestures}`) +
    (digest.activations > 0 ? ` · ${digest.activations} activation(s)` : "") +
    (digest.maxDwell > 0 ? ` · dwell peaked ${percent(digest.maxDwell)}` : "") +
    (digest.paint === null || digest.paint === undefined
      ? ""
      : ` · pinched ${percent(digest.paint.pinched)}` +
        ((digest.paint.loose ?? 0) > 0 ? ` (${percent(digest.paint.loose)} of it loose)` : "") +
        ` · ${describeStrokes(digest.paint)}` +
        ` · pinch ${digest.paint.pinch.min.toFixed(2)}-${digest.paint.pinch.max.toFixed(2)}` +
        (digest.paint.metres === null || digest.paint.metres === undefined
          ? ""
          : ` · ${(digest.paint.metres.min * 1000).toFixed(0)}-${(digest.paint.metres.max * 1000).toFixed(0)} mm`) +
        (digest.paint.tools.length > 1 ? ` · ${digest.paint.tools.length} tools` : "")) +
    (digest.said.length === 0
      ? ""
      : ` · said ${digest.said.map((s) => `"${s.text.trim()}"`).join(", ")}`)
  );
}

/**
 * "2 line(s) drawn, 7 on the glass": what this take did, then what was already
 * there. The bare count on the glass was read as six broken lines once, on a
 * take that had drawn two. Digests written before `strokesDrawn` existed have
 * only the count on the glass, and are printed as they were. See friction 0031.
 */
function describeStrokes(paint: NonNullable<TraceDigest["paint"]>): string {
  if (paint.strokesDrawn === undefined) return `${paint.strokes} stroke(s) on the glass`;
  return paint.strokesDrawn === paint.strokes
    ? `${paint.strokesDrawn} line(s) drawn`
    : `${paint.strokesDrawn} line(s) drawn, ${paint.strokes} on the glass`;
}

function count(into: Map<string, number>, key: string): void {
  into.set(key, (into.get(key) ?? 0) + 1);
}

function rank(counts: Map<string, number>): Array<[string, number]> {
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

function fraction(part: number, whole: number): number {
  return whole === 0 ? 0 : round(part / whole, 3);
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function round(value: number, decimals: number): number {
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
}
