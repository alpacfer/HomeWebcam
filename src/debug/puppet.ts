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
  /** Where the anchor goes. Normalized mirrored screen space. */
  at: Vec2;
  /** What `at` positions: the index fingertip (default) or the pinch point. */
  anchor?: "index" | "pinch";
  /** 0 open, 1 thumb and index touching. Interpolated between poses. */
  pinch?: number;
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
          anchor: hand.anchor ?? "index",
          pinch: hand.pinch ?? 0,
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
   * Positions and the pinch are interpolated; gestures are not. A hand that is
   * on its way to a Victory is already making one, which is what a person does;
   * two fingertips on their way to meeting are still apart.
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
    /**
     * Paint mode: pinch in the middle of the mirror, draw a line to the right,
     * let go. Clear of the mode dock at the top and the tray down the side.
     */
    stroke: {
      name: "stroke",
      from: { hands: [{ at: STROKE.from, anchor: "pinch", pinch: 0 }] },
      steps: [
        // Open, and holding it. Whatever ran before may have left a pinch
        // closed, and a scenario that starts by closing would never be seen to
        // let go of it. Every duration here outlasts the gate it has to trip,
        // which is why they are derived and not written down.
        { to: { hands: [{ at: STROKE.from, anchor: "pinch", pinch: 0 }] }, ms: OPEN_MS },
        { to: { hands: [{ at: STROKE.from, anchor: "pinch", pinch: 1 }] }, ms: CLOSE_MS },
        { to: { hands: [{ at: STROKE.to, anchor: "pinch", pinch: 1 }] }, ms: 900 },
        { to: { hands: [{ at: STROKE.to, anchor: "pinch", pinch: 0 }] }, ms: OPEN_MS },
        { to: { hands: [{ at: STROKE.to, anchor: "pinch", pinch: 0 }] }, ms: 400 },
      ],
    },
    /** The same path with the fingers apart. Must leave nothing behind. */
    sweep: {
      name: "sweep",
      from: { hands: [{ at: STROKE.from, anchor: "pinch", pinch: 0 }] },
      steps: [
        { to: { hands: [{ at: STROKE.to, anchor: "pinch", pinch: 0 }] }, ms: 900 },
        { to: { hands: [{ at: STROKE.to, anchor: "pinch", pinch: 0 }] }, ms: 400 },
      ],
    },
    /**
     * A fist dragged across the mirror. The thumb lands on the curled index, so
     * the two tips measure as pinched, and the label is what says it is not.
     */
    fist: {
      name: "fist",
      from: { hands: [{ at: STROKE.from, anchor: "pinch", pinch: 1, gesture: "Closed_Fist" }] },
      steps: [
        {
          to: { hands: [{ at: STROKE.to, anchor: "pinch", pinch: 1, gesture: "Closed_Fist" }] },
          ms: 900,
        },
        {
          to: { hands: [{ at: STROKE.to, anchor: "pinch", pinch: 1, gesture: "Closed_Fist" }] },
          ms: 400,
        },
      ],
    },
    /**
     * Draws a line, then keeps moving while the fingers come apart. The gate
     * waits openMs before it believes the release, so this paints past the end
     * of the line on purpose: the stretch from STROKE.to to OVERSHOOT is the
     * ink the trim has to take back. See ADR 0018.
     */
    overshoot: {
      name: "overshoot",
      from: { hands: [{ at: STROKE.from, anchor: "pinch", pinch: 0 }] },
      steps: [
        { to: { hands: [{ at: STROKE.from, anchor: "pinch", pinch: 0 }] }, ms: OPEN_MS },
        { to: { hands: [{ at: STROKE.from, anchor: "pinch", pinch: 1 }] }, ms: CLOSE_MS },
        { to: { hands: [{ at: STROKE.to, anchor: "pinch", pinch: 1 }] }, ms: 700 },
        // Half a pinch reads about 0.50, well past openAbove, so the release is
        // unambiguous - and the hand is still travelling while it happens.
        { to: { hands: [{ at: OVERSHOOT, anchor: "pinch", pinch: 0.5 }] }, ms: 600 },
        { to: { hands: [{ at: OVERSHOOT, anchor: "pinch", pinch: 0 }] }, ms: OPEN_MS },
      ],
    },
    /**
     * Draws a line, then parts the fingertips a little - not wide - and keeps
     * travelling, and never opens wide at all. Half a pinch reads 0.50 and is
     * an unambiguous release; this reads about 0.22, inside the hysteresis
     * band, above contact and below the open mark, which is exactly where a
     * person's fingers sit when they have let go by a centimetre. Nothing may
     * be inked past the parting, and the line has to end on its own, from the
     * loose limit alone. See ADR 0023.
     */
    part: {
      name: "part",
      from: { hands: [{ at: STROKE.from, anchor: "pinch", pinch: 0 }] },
      steps: [
        { to: { hands: [{ at: STROKE.from, anchor: "pinch", pinch: 0 }] }, ms: OPEN_MS },
        { to: { hands: [{ at: STROKE.from, anchor: "pinch", pinch: 1 }] }, ms: CLOSE_MS },
        { to: { hands: [{ at: STROKE.to, anchor: "pinch", pinch: 1 }] }, ms: 700 },
        { to: { hands: [{ at: PART, anchor: "pinch", pinch: PARTED }] }, ms: 200 },
        { to: { hands: [{ at: OVERSHOOT, anchor: "pinch", pinch: PARTED }] }, ms: LOOSE_MS },
      ],
    },
    /**
     * Closes the fingers and travels at the same time, which is what a person
     * drawing a fast line actually does and what no other scenario here does.
     *
     * The gate cannot confirm a pinch until it has held, so the hand covers the
     * stretch from DIVE.from to somewhere past DIVE.met before any line is
     * certain. That stretch is the head of the line, and it has to be in it:
     * before ADR 0020 it was thrown away, and at a screen height a second that
     * was a fifth of the line. Nothing about this scenario is stationary on
     * purpose.
     */
    dive: {
      name: "dive",
      from: { hands: [{ at: DIVE.from, anchor: "pinch", pinch: 0 }] },
      steps: [
        { to: { hands: [{ at: DIVE.from, anchor: "pinch", pinch: 0 }] }, ms: OPEN_MS },
        // Shut in one leg, moving throughout. The leg is shorter than the
        // ordinary confirmation on purpose: the deep mark is what lets this in.
        { to: { hands: [{ at: DIVE.met, anchor: "pinch", pinch: 1 }] }, ms: CLOSE_MS / 2 },
        { to: { hands: [{ at: DIVE.to, anchor: "pinch", pinch: 1 }] }, ms: 700 },
        { to: { hands: [{ at: DIVE.to, anchor: "pinch", pinch: 0 }] }, ms: OPEN_MS },
        { to: { hands: [{ at: DIVE.to, anchor: "pinch", pinch: 0 }] }, ms: 400 },
      ],
    },
    /** Nobody there. Useful for asserting that everything settles back. */
    empty: { name: "empty", from: offscreen, steps: [{ to: offscreen, ms: 0 }] },
  };
}

/** Where the built-in paint scenarios draw: the middle of the mirror, left to right. */
export const STROKE = { from: { x: 0.3, y: 0.5 }, to: { x: 0.7, y: 0.56 } } as const;

/**
 * A vertical line drawn on the way down, the way the person at the station
 * draws them. `met` is where the fingers finish closing: everything from `from`
 * to `met` is drawn while the gate is still deciding, so a check can ask
 * whether the line reaches up there. Clear of the mode dock and the tray.
 */
export const DIVE = {
  from: { x: 0.42, y: 0.24 },
  met: { x: 0.42, y: 0.38 },
  to: { x: 0.45, y: 0.82 },
} as const;

/**
 * Where a hand carries on to after the fingers have parted. Clear of the tray,
 * so the ink that must not survive a release has somewhere of its own to be.
 * See docs/adr/0018-paint-releases-on-contact.md.
 */
export const OVERSHOOT = { x: 0.86, y: 0.62 } as const;

/**
 * Where the fingers finish parting in `part`: a short leg past the end of the
 * line, during which the pinch slides from shut to `PARTED`. Ink stops partway
 * along it, where the reading crosses the contact mark; from here to OVERSHOOT
 * nothing may be drawn.
 */
export const PART = { x: 0.78, y: 0.59 } as const;

/**
 * A fixture pinch that reads about 0.22: the fixture's ratio is 1.006 times
 * (1 - pinch), measured. Above `closeBelow`, well below `openAbove` - the band
 * a person's fingertips occupy when parted by a centimetre, and the band a gate
 * with no clock on it held a line in for seconds. See ADR 0023.
 */
export const PARTED = 0.78;

/**
 * How long a paint scenario spends letting the pinch gate see a change.
 *
 * Three times each confirmation, because a leg that *interpolates* the pinch
 * spends only part of itself on the far side of a threshold: a 200 ms leg
 * sliding from open to closed held the ratio above openAbove for 136 ms of it,
 * which stopped outlasting the gate the moment openMs went to 150 and left one
 * verify check painting nothing. See friction 0027.
 */
const OPEN_MS = CONFIG.paint.pinch.openMs * 3;
const CLOSE_MS = CONFIG.paint.pinch.closeMs * 3;
/**
 * The parted leg holds a constant reading, so all of it is on the far side of
 * the contact mark; twice the limit is margin for the loop's frame quantisation
 * and for the leg before it, which only crosses the mark partway along.
 */
const LOOSE_MS = CONFIG.paint.pinch.looseMs * 2;

function blend(from: PuppetPose, to: PuppetPose, t: number): PuppetPose {
  return {
    hands: to.hands.map((hand, index) => {
      const previous = from.hands[index];
      if (previous === undefined) return hand;
      const pinchFrom = previous.pinch ?? 0;
      return {
        ...hand,
        at: {
          x: previous.at.x + (hand.at.x - previous.at.x) * t,
          y: previous.at.y + (hand.at.y - previous.at.y) * t,
        },
        pinch: pinchFrom + ((hand.pinch ?? 0) - pinchFrom) * t,
      };
    }),
  };
}

function positiveMod(value: number, span: number): number {
  return ((value % span) + span) % span;
}
