import type { Vec2 } from "../perception/types.js";

/**
 * The 1€ filter: a low-pass whose cutoff rises with speed.
 *
 * Casiez, Roussel and Vogel, CHI 2012, "1€ filter: a simple speed-based
 * low-pass filter for noisy input in interactive systems".
 * https://gery.casiez.net/1euro/
 *
 * A fixed low-pass forces one choice for two opposite problems. A hand held
 * still jitters, which wants a low cutoff; a hand moving across the screen
 * wants a high one, because a first-order low-pass at cutoff f delays the
 * signal by about 1/(2*pi*f) seconds. The station's previous filter was fixed
 * at 3 Hz, so it delayed *every* movement by 53 ms - measured against a
 * pipeline that only spends 32 ms getting a photon to the screen.
 *
 * Raising the cutoff with speed resolves it: still hands are smoothed hard,
 * moving hands are barely smoothed at all. It also happens to be exactly what
 * dwell-to-click needs, because a dwelling hand is by definition a slow one.
 */
export interface OneEuroOptions {
  /** Cutoff at a standstill, in Hz. Lower = less jitter, more lag. */
  minCutoffHz: number;
  /** How fast the cutoff opens up with speed, in Hz per unit/second. */
  beta: number;
  /**
   * Cutoff for the speed estimate itself, in Hz. The raw derivative of a noisy
   * signal is noisier than the signal, and feeding that to `beta` makes the
   * cutoff flutter. The paper uses 1 Hz and says it rarely needs touching.
   */
  derivativeCutoffHz: number;
  /**
   * Cutoff for a SECOND velocity estimate, used only for extrapolation.
   *
   * The paper's 1 Hz derivative is deliberately sluggish, which is right for
   * driving a cutoff - only its magnitude matters and a flickering cutoff is
   * worse than a late one. It is wrong for prediction: at 1 Hz the estimate has
   * a 159 ms time constant, so when a hand reverses direction the velocity
   * still points the old way and the cursor is thrown further from the hand at
   * exactly the moment it changed its mind. Prediction needs a velocity that
   * turns around promptly, so it gets its own.
   */
  predictionCutoffHz: number;
}

/** Smoothing factor for a first-order low-pass. Paper's eq. 1. */
function alphaFor(cutoffHz: number, dtSeconds: number): number {
  const tau = 1 / (2 * Math.PI * cutoffHz);
  return 1 / (1 + tau / dtSeconds);
}

function lerp(from: number, to: number, alpha: number): number {
  return from + alpha * (to - from);
}

/**
 * A 1€ filter over a 2D point, plus optional extrapolation.
 *
 * Both axes share ONE cutoff, driven by the magnitude of the 2D velocity rather
 * than by each axis's own. Filtering the axes independently makes the amount of
 * lag depend on the direction of travel, so a diagonal flick arrives bent.
 */
export class OneEuroVec2 {
  private position: Vec2 | null = null;
  /** Low-passed hard, per the paper. Drives the adaptive cutoff. */
  private velocity: Vec2 = { x: 0, y: 0 };
  /** Low-passed lightly. Drives extrapolation, which must survive a reversal. */
  private predictionVelocity: Vec2 = { x: 0, y: 0 };
  private lastRaw: Vec2 | null = null;
  private lastT = 0;

  constructor(private readonly options: OneEuroOptions) {}

  /** Filtered speed in units per second. 0 before the second sample. */
  get speed(): number {
    return Math.hypot(this.velocity.x, this.velocity.y);
  }

  /** Velocity for extrapolation, filtered lightly so a reversal registers. */
  get velocityPerSecond(): Vec2 {
    return { ...this.predictionVelocity };
  }

  update(raw: Vec2, t: number): Vec2 {
    if (this.position === null || this.lastRaw === null) {
      this.position = raw;
      this.lastRaw = raw;
      this.lastT = t;
      this.velocity = { x: 0, y: 0 };
      this.predictionVelocity = { x: 0, y: 0 };
      return raw;
    }

    // A duplicated or out-of-order timestamp would divide by zero on the way to
    // the derivative. One millisecond is below anything this loop produces.
    const dt = Math.max(1, t - this.lastT) / 1000;

    const rate: Vec2 = {
      x: (raw.x - this.lastRaw.x) / dt,
      y: (raw.y - this.lastRaw.y) / dt,
    };

    const dAlpha = alphaFor(this.options.derivativeCutoffHz, dt);
    this.velocity = {
      x: lerp(this.velocity.x, rate.x, dAlpha),
      y: lerp(this.velocity.y, rate.y, dAlpha),
    };

    const pAlpha = alphaFor(this.options.predictionCutoffHz, dt);
    this.predictionVelocity = {
      x: lerp(this.predictionVelocity.x, rate.x, pAlpha),
      y: lerp(this.predictionVelocity.y, rate.y, pAlpha),
    };

    const cutoff = this.options.minCutoffHz + this.options.beta * this.speed;
    const alpha = alphaFor(cutoff, dt);
    this.position = {
      x: lerp(this.position.x, raw.x, alpha),
      y: lerp(this.position.y, raw.y, alpha),
    };

    this.lastRaw = raw;
    this.lastT = t;
    return this.position;
  }

  reset(): void {
    this.position = null;
    this.lastRaw = null;
    this.velocity = { x: 0, y: 0 };
    this.predictionVelocity = { x: 0, y: 0 };
  }
}

/**
 * Pushes a point along its own velocity to hide pipeline latency.
 *
 * Nothing can remove the ~50 ms between a hand moving and the screen showing
 * it, but a moving hand is briefly predictable, so the cursor can be drawn
 * where the hand is *arriving* instead of where it was.
 *
 * The catch is that extrapolation overshoots, and overshoot near a standstill
 * is indistinguishable from jitter - which would wreck dwell-to-click, since
 * dwell is cancelled by movement. So prediction fades in with speed and is
 * exactly zero while the hand is slow enough to be dwelling. Latency
 * compensation is worth nothing on a hand that is not going anywhere.
 */
export interface PredictionOptions {
  /** How far ahead to aim, in ms. Should not exceed measured pipeline latency. */
  horizonMs: number;
  /** Speed, in units/second, below which no prediction is applied at all. */
  fadeInFrom: number;
  /** Speed at which prediction reaches its full horizon. */
  fadeInTo: number;
}

export function predict(position: Vec2, velocityPerSecond: Vec2, options: PredictionOptions): Vec2 {
  const speed = Math.hypot(velocityPerSecond.x, velocityPerSecond.y);
  const span = options.fadeInTo - options.fadeInFrom;
  const ramp = span <= 0 ? 1 : (speed - options.fadeInFrom) / span;
  const strength = Math.min(1, Math.max(0, ramp));
  if (strength === 0) return position;

  const seconds = (options.horizonMs / 1000) * strength;
  return {
    x: position.x + velocityPerSecond.x * seconds,
    y: position.y + velocityPerSecond.y * seconds,
  };
}
