import { CONFIG } from "../config.js";
import { distance, SmoothedVec2 } from "../lib/smoothing.js";
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
 */
export class HandCursor {
  private readonly smoothed = new SmoothedVec2(CONFIG.cursor.smoothingHz);
  private dwellAnchor: Vec2 | null = null;
  private dwellStart = 0;
  private alreadyFired = false;

  update(frame: PerceptionFrame): CursorState {
    const hand = pickPointingHand(frame.hands);
    if (hand === undefined) {
      this.reset();
      return IDLE;
    }

    const position = this.smoothed.update(hand.indexTip, frame.t);

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
 * With two hands up, the higher one wins. That matches what people do when
 * they mean to point at something: they raise the pointing hand.
 */
function pickPointingHand(hands: readonly HandObservation[]): HandObservation | undefined {
  let best: HandObservation | undefined;
  for (const hand of hands) {
    if (best === undefined || hand.indexTip.y < best.indexTip.y) best = hand;
  }
  return best;
}
