import { SmoothedVec2 } from "../lib/smoothing.js";
import type { PerceptionFrame, Vec2 } from "../perception/types.js";
import { type HandImpulse, toScreenUnits } from "./soft-mount.js";

/**
 * Turns successive frames into hand velocity, the input the soft-mounted menu
 * is brushed with.
 *
 * The palm centre rather than a fingertip: it is the mean of five landmarks, so
 * it is the steadiest point on a hand, and a wave is a whole-hand movement
 * anyway. Raw per-frame differences of it are still far too noisy to push a
 * spring with - one jittery landmark at 60 fps reads as a violent flick - so
 * the velocity is low-passed before anyone sees it.
 */
export class HandMotion {
  private readonly tracks = new Map<string, Track>();

  constructor(private readonly smoothingHz: number) {}

  /** @param aspect Viewport width over height, to make the units isotropic. */
  sample(frame: PerceptionFrame, aspect: number): HandImpulse[] {
    const impulses: HandImpulse[] = [];
    const seen = new Set<string>();

    for (const hand of frame.hands) {
      const key = hand.side;
      seen.add(key);
      const position = toScreenUnits(hand.palmCenter, aspect);
      const existing = this.tracks.get(key);

      if (existing === undefined) {
        // A hand that has just appeared has no history, and inventing one from
        // a single sample is how a panel gets launched the instant you walk up.
        this.tracks.set(key, {
          position,
          t: frame.t,
          velocity: new SmoothedVec2(this.smoothingHz),
        });
        impulses.push({ position, velocity: { x: 0, y: 0 } });
        continue;
      }

      const dt = Math.max(1, frame.t - existing.t) / 1000;
      const raw: Vec2 = {
        x: (position.x - existing.position.x) / dt,
        y: (position.y - existing.position.y) / dt,
      };
      const velocity = existing.velocity.update(raw, frame.t);
      existing.position = position;
      existing.t = frame.t;
      impulses.push({ position, velocity });
    }

    for (const key of this.tracks.keys()) {
      if (!seen.has(key)) this.tracks.delete(key);
    }
    return impulses;
  }
}

interface Track {
  position: Vec2;
  t: number;
  velocity: SmoothedVec2;
}
