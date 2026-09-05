import type { GestureName, Rect, Vec2 } from "../perception/types.js";
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
  let hands = 0;
  let faces = 0;
  let cursor = 0;
  let maxDwell = 0;
  let activations = 0;

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
  };
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
    (digest.said.length === 0
      ? ""
      : ` · said ${digest.said.map((s) => `"${s.text.trim()}"`).join(", ")}`)
  );
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
