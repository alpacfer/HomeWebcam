import { CONFIG } from "../config.js";
import { OneEuroVec2, predict } from "../lib/one-euro.js";
import { distance } from "../lib/smoothing.js";
import type { HandObservation, PerceptionFrame, Vec2 } from "../perception/types.js";

export interface CursorState {
  /** Null when no hand is raised. */
  position: Vec2 | null;
  /** 0..1 progress toward a dwell activation. */
  dwellProgress: number;
  /** True for exactly one frame, when a dwell completes. */
  activated: boolean;
  gesture: HandObservation["gesture"];
}

const IDLE: CursorState = { position: null, dwellProgress: 0, activated: false, gesture: "None" };

/**
 * Turns a raised hand into a pointer with dwell-to-click.
 *
 * Dwell rather than a pinch or a closed fist: it needs no explanation and no
 * calibration, which matters when the person in front of the station has never
 * used it before. Gestures stay available for shortcuts, not for clicking.
 *
 * Position comes from a 1€ filter rather than a fixed low-pass, so a still hand
 * is smoothed harder than the old filter managed and a moving one is barely
 * smoothed at all. Both properties matter here: the first keeps a dwell alive,
 * the second is why the cursor feels attached to the hand. See ADR 0013.
 */
export class HandCursor {
  private readonly smoothed = new OneEuroVec2(CONFIG.cursor.filter);
  private dwellAnchor: Vec2 | null = null;
  private dwellStart = 0;
  private alreadyFired = false;

  update(frame: PerceptionFrame): CursorState {
    const hand = pickPointingHand(frame.hands);
    if (hand === undefined) {
      this.reset();
      return IDLE;
    }

    const smoothed = this.smoothed.update(hand.indexTip, frame.t);
    // Prediction fades in with speed, so a hand held over a tile is reported
    // exactly where the filter put it and the dwell below is undisturbed.
    const position = predict(smoothed, this.smoothed.velocityPerSecond, CONFIG.cursor.prediction);

    if (
      this.dwellAnchor === null ||
      distance(position, this.dwellAnchor) > CONFIG.cursor.dwellToleranceNorm
    ) {
      this.dwellAnchor = position;
      this.dwellStart = frame.t;
      this.alreadyFired = false;
    }

    const held = frame.t - this.dwellStart;
    const progress = Math.min(1, held / CONFIG.cursor.dwellMs);
    const activated = progress >= 1 && !this.alreadyFired;
    if (activated) this.alreadyFired = true;

    return { position, dwellProgress: progress, activated, gesture: hand.gesture };
  }

  reset(): void {
    this.smoothed.reset();
    this.dwellAnchor = null;
    this.alreadyFired = false;
  }
}

/**
 * The higher hand wins, which matches what people do when they mean to point at
 * something: they raise the pointing hand.
 *
 * CONFIG.hands.maxHands is 1, so the detector reports at most one hand and this
 * is a formality today. It stays because the rule is about intent rather than
 * about the detector's limit, and raising maxHands should not silently change
 * which hand drives the cursor. See ADR 0013.
 */
function pickPointingHand(hands: readonly HandObservation[]): HandObservation | undefined {
  let best: HandObservation | undefined;
  for (const hand of hands) {
    if (best === undefined || hand.indexTip.y < best.indexTip.y) best = hand;
  }
  return best;
}
