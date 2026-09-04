import type { Vec2 } from "../perception/types.js";

/**
 * Exponential smoothing with a cutoff expressed in Hz rather than a raw alpha,
 * so the amount of smoothing does not change when the frame rate does.
 *
 * A raw fingertip jitters by a few percent of the screen every frame. Feeding
 * that straight into a cursor makes small targets unhittable.
 */
export class SmoothedVec2 {
  private value: Vec2 | null = null;
  private lastT = 0;

  /** @param cutoffHz Lower = smoother and laggier. 2-4 Hz suits a hand cursor. */
  constructor(private readonly cutoffHz = 3) {}

  update(next: Vec2, t: number): Vec2 {
    if (this.value === null) {
      this.value = next;
      this.lastT = t;
      return next;
    }
    const dt = Math.max(1, t - this.lastT) / 1000;
    const tau = 1 / (2 * Math.PI * this.cutoffHz);
    const alpha = 1 - Math.exp(-dt / tau);
    this.value = {
      x: this.value.x + alpha * (next.x - this.value.x),
      y: this.value.y + alpha * (next.y - this.value.y),
    };
    this.lastT = t;
    return this.value;
  }

  reset(): void {
    this.value = null;
  }
}

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
