import { CONFIG } from "../config.js";
import type { GestureName, PerceptionFrame, Vec2 } from "../perception/types.js";
import { fixtureHand } from "./hand-fixtures.js";

/**
 * A scripted perception source: hands that move where a scenario says, so an
 * interaction can be driven end to end without a person in front of the camera.
 *
 * It replaces the detectors rather than merging with them. Everything above the
 * perception layer consumes a PerceptionFrame and cannot tell the difference,
 * which is the point - and is also exactly why the app marks itself loudly
 * while this is driving. A puppet run proves interaction and rendering. It
 * proves nothing at all about the models. See ADR 0011.
 */

export interface PuppetHand {
  /** Where the index fingertip goes. Normalized mirrored screen space. */
  at: Vec2;
  gesture?: GestureName;
  side?: "left" | "right";
  /** Defaults comfortably above CONFIG.interaction.minGestureConfidence. */
  confidence?: number;
  scale?: number;
}

export interface PuppetPose {
  hands: PuppetHand[];
}

export interface PuppetStep {
  to: PuppetPose;
  /** Milliseconds to travel from the previous pose to this one. */
  ms: number;
}

export interface PuppetScenario {
  name: string;
  from: PuppetPose;
  steps: PuppetStep[];
  loop?: boolean;
}

const DEFAULT_CONFIDENCE = 0.95;
const DEFAULT_SCALE = 0.22;

/** Plays one scenario, producing a frame per call. */
export class Puppet {
  private readonly total: number;

  constructor(
    private readonly scenario: PuppetScenario,
    private readonly startedAt: number,
  ) {
    this.total = scenario.steps.reduce((sum, step) => sum + Math.max(0, step.ms), 0);
  }

  /** True once the last step has played out. A non-looping puppet then holds. */
  finished(now: number): boolean {
    return !this.scenario.loop && now - this.startedAt >= this.total;
  }

  frame(now: number, seq: number, aspect: number): PerceptionFrame {
    return {
      seq,
      t: now,
      faces: [],
      heard: [],
      hands: this.poseAt(now - this.startedAt).hands.map((hand) =>
        fixtureHand({
          indexTip: hand.at,
          gesture: hand.gesture ?? "None",
          side: hand.side ?? "right",
          scale: hand.scale ?? DEFAULT_SCALE,
          confidence: hand.confidence ?? DEFAULT_CONFIDENCE,
          aspect,
        }),
      ),
    };
  }

  /**
   * Positions are interpolated; gestures are not. A hand that is on its way to
   * a Victory is already making one, which is what a person does.
   */
  poseAt(elapsedMs: number): PuppetPose {
    if (this.total <= 0) return this.scenario.from;
    const elapsed = this.scenario.loop ? positiveMod(elapsedMs, this.total) : elapsedMs;

    let start = this.scenario.from;
    let consumed = 0;
    for (const step of this.scenario.steps) {
      const span = Math.max(0, step.ms);
      if (elapsed < consumed + span || span === 0) {
        const t = span === 0 ? 1 : (elapsed - consumed) / span;
        return blend(start, step.to, Math.min(1, Math.max(0, t)));
      }
      consumed += span;
      start = step.to;
    }
    return start;
  }
}

/** Owns whichever puppet is currently driving, if any. */
export class PuppetController {
  private puppet: Puppet | null = null;
  private seq = 0;

  play(scenario: PuppetScenario, now: number): void {
    this.puppet = new Puppet(scenario, now);
  }

  /** Holds a single pose indefinitely. The simplest possible scenario. */
  hold(pose: PuppetPose, now: number): void {
    this.play({ name: "hold", from: pose, steps: [{ to: pose, ms: 0 }] }, now);
  }

  stop(): void {
    this.puppet = null;
  }

  get active(): boolean {
    return this.puppet !== null;
  }

  finished(now: number): boolean {
    return this.puppet?.finished(now) ?? true;
  }

  frame(now: number, aspect: number): PerceptionFrame | null {
    if (this.puppet === null) return null;
    this.seq += 1;
    return this.puppet.frame(now, this.seq, aspect);
  }
}

/**
 * The interactions this station actually has, as scenarios.
 *
 * Durations are derived from CONFIG rather than written out, so a scenario
 * cannot quietly stop covering the thing it was written for when a threshold
 * changes. The extra margin is for the smoothing between the fingertip and the
 * cursor, which always lags.
 */
export function builtinScenarios(target: Vec2): Record<string, PuppetScenario> {
  const offscreen: PuppetPose = { hands: [] };
  const hold = CONFIG.interaction.gestureHoldMs;
  const dwell = CONFIG.cursor.dwellMs;

  return {
    /** A hand sweeping across the menu, left to right and back. */
    wave: {
      name: "wave",
      from: { hands: [{ at: { x: 0.1, y: 0.16 }, gesture: "Open_Palm" }] },
      steps: [
        { to: { hands: [{ at: { x: 0.9, y: 0.16 }, gesture: "Open_Palm" }] }, ms: 520 },
        { to: { hands: [{ at: { x: 0.1, y: 0.16 }, gesture: "Open_Palm" }] }, ms: 520 },
      ],
      loop: true,
    },
    /** Point at a target and hold still long enough to dwell-select it. */
    point: {
      name: "point",
      from: { hands: [{ at: { x: target.x, y: 0.55 }, gesture: "Pointing_Up" }] },
      steps: [
        { to: { hands: [{ at: target, gesture: "Pointing_Up" }] }, ms: 500 },
        { to: { hands: [{ at: target, gesture: "Pointing_Up" }] }, ms: dwell * 2 },
      ],
    },
    /** Hold a Victory sign: the Picture-mode shortcut. */
    victory: {
      name: "victory",
      from: offscreen,
      steps: [
        { to: { hands: [{ at: { x: 0.5, y: 0.45 }, gesture: "Victory" }] }, ms: 200 },
        { to: { hands: [{ at: { x: 0.5, y: 0.45 }, gesture: "Victory" }] }, ms: hold + 400 },
      ],
    },
    /** Hold an open palm: the shutter. */
    palm: {
      name: "palm",
      from: offscreen,
      steps: [
        { to: { hands: [{ at: { x: 0.5, y: 0.45 }, gesture: "Open_Palm" }] }, ms: 200 },
        { to: { hands: [{ at: { x: 0.5, y: 0.45 }, gesture: "Open_Palm" }] }, ms: hold + 400 },
      ],
    },
    /** Both hands, to check that two of them sum instead of fighting. */
    both: {
      name: "both",
      from: {
        hands: [
          { at: { x: 0.3, y: 0.3 }, gesture: "Open_Palm", side: "left" },
          { at: { x: 0.7, y: 0.3 }, gesture: "Open_Palm", side: "right" },
        ],
      },
      steps: [
        {
          to: {
            hands: [
              { at: { x: 0.45, y: 0.18 }, gesture: "Open_Palm", side: "left" },
              { at: { x: 0.55, y: 0.18 }, gesture: "Open_Palm", side: "right" },
            ],
          },
          ms: 700,
        },
      ],
    },
    /** Nobody there. Useful for asserting that everything settles back. */
    empty: { name: "empty", from: offscreen, steps: [{ to: offscreen, ms: 0 }] },
  };
}

function blend(from: PuppetPose, to: PuppetPose, t: number): PuppetPose {
  return {
    hands: to.hands.map((hand, index) => {
      const previous = from.hands[index];
      if (previous === undefined) return hand;
      return {
        ...hand,
        at: {
          x: previous.at.x + (hand.at.x - previous.at.x) * t,
          y: previous.at.y + (hand.at.y - previous.at.y) * t,
        },
      };
    }),
  };
}

function positiveMod(value: number, span: number): number {
  return ((value % span) + span) % span;
}
