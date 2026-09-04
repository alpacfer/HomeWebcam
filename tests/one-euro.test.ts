import { describe, expect, it } from "vitest";
import { OneEuroVec2, type PredictionOptions, predict } from "../src/lib/one-euro.js";
import { SmoothedVec2 } from "../src/lib/smoothing.js";
import type { Vec2 } from "../src/perception/types.js";

const FILTER = { minCutoffHz: 3, beta: 30, derivativeCutoffHz: 1, predictionCutoffHz: 6 };
const FRAME_MS = 1000 / 30;

/** A hand held still, jittering the way a MediaPipe fingertip does. */
function jitter(seed: number): number {
  return Math.sin(seed * 12.9898) * 0.004;
}

function runStill(filter: { update(p: Vec2, t: number): Vec2 }, frames: number): number {
  let worst = 0;
  for (let i = 0; i < frames; i++) {
    const out = filter.update({ x: 0.5 + jitter(i), y: 0.5 + jitter(i + 100) }, i * FRAME_MS);
    if (i > frames / 2) {
      worst = Math.max(worst, Math.hypot(out.x - 0.5, out.y - 0.5));
    }
  }
  return worst;
}

/** A hand crossing the screen at a steady speed, in screen-widths a second. */
function runSweep(
  filter: { update(p: Vec2, t: number): Vec2 },
  frames: number,
  unitsPerSecond: number,
): number {
  let lag = 0;
  for (let i = 0; i < frames; i++) {
    const t = i * FRAME_MS;
    const truth = 0.1 + unitsPerSecond * (t / 1000);
    const out = filter.update({ x: truth, y: 0.5 }, t);
    if (i > frames / 2) lag = truth - out.x;
  }
  return lag;
}

describe("OneEuroVec2", () => {
  it("passes the first sample straight through", () => {
    const f = new OneEuroVec2(FILTER);
    expect(f.update({ x: 0.25, y: 0.75 }, 0)).toEqual({ x: 0.25, y: 0.75 });
  });

  it("reports no speed until it has two samples", () => {
    const f = new OneEuroVec2(FILTER);
    f.update({ x: 0.5, y: 0.5 }, 0);
    expect(f.speed).toBe(0);
  });

  /**
   * The claim that justifies the tuning: minCutoffHz equals the cutoff of the
   * fixed filter this replaced, so the adaptive cutoff can only ever be higher
   * and the lag can only ever be lower. Never a regression at any speed, which
   * is a stronger and more useful guarantee than winning on average.
   *
   * An earlier tuning used the paper's 1 Hz starting point and broke exactly
   * this: it doubled the lag of a slow, careful aim. See ADR 0013.
   */
  it("never lags more than the fixed 3 Hz filter it replaced, at any speed", () => {
    for (const speed of [0.05, 0.1, 0.3, 0.6, 1, 2, 4]) {
      const oneEuro = runSweep(new OneEuroVec2(FILTER), 150, speed);
      const fixed = runSweep(new SmoothedVec2(3), 150, speed);
      expect(oneEuro, `at ${speed} units/second`).toBeLessThanOrEqual(fixed);
    }
  });

  it("lags a moving hand far less than the fixed 3 Hz filter", () => {
    const oneEuro = runSweep(new OneEuroVec2(FILTER), 150, 2);
    const fixed = runSweep(new SmoothedVec2(3), 150, 2);
    expect(oneEuro).toBeLessThan(fixed / 5);
  });

  /**
   * Jitter at rest is the thing a higher minCutoffHz costs, so it is bounded
   * rather than claimed as an improvement: at a true standstill the cutoff sits
   * on the 3 Hz floor and behaves like the old filter.
   */
  it("is no jitterier at rest than the fixed filter, within a small margin", () => {
    const oneEuro = runStill(new OneEuroVec2(FILTER), 150);
    const fixed = runStill(new SmoothedVec2(3), 150);
    expect(oneEuro).toBeLessThan(fixed * 1.5);
  });

  it("opens its cutoff as the hand speeds up", () => {
    const slow = new OneEuroVec2(FILTER);
    const fast = new OneEuroVec2(FILTER);
    for (let i = 0; i < 60; i++) {
      const t = i * FRAME_MS;
      slow.update({ x: 0.5 + 0.05 * (t / 1000), y: 0.5 }, t);
      fast.update({ x: 0.5 + 2 * (t / 1000), y: 0.5 }, t);
    }
    expect(fast.speed).toBeGreaterThan(slow.speed);
  });

  /**
   * One cutoff from the 2D speed, not one per axis. Filtering the axes
   * independently makes lag depend on heading, so a 45-degree flick comes out
   * bent toward whichever axis was moving less.
   */
  it("does not bend a diagonal sweep", () => {
    const f = new OneEuroVec2(FILTER);
    let last: Vec2 = { x: 0, y: 0 };
    for (let i = 0; i < 90; i++) {
      const t = i * FRAME_MS;
      const d = 0.1 + 1.4 * (t / 1000);
      last = f.update({ x: d, y: d }, t);
    }
    expect(last.x).toBeCloseTo(last.y, 6);
  });

  it("survives a repeated timestamp instead of dividing by zero", () => {
    const f = new OneEuroVec2(FILTER);
    f.update({ x: 0.5, y: 0.5 }, 100);
    const out = f.update({ x: 0.6, y: 0.5 }, 100);
    expect(Number.isFinite(out.x)).toBe(true);
    expect(Number.isFinite(f.speed)).toBe(true);
  });

  /**
   * Why prediction gets its own velocity estimate. The cutoff's 1 Hz derivative
   * has a 159 ms time constant, so on a reversal it still points the old way -
   * and prediction driven by it would shove the cursor further from the hand at
   * the exact moment the hand changed direction.
   */
  it("turns its prediction velocity around promptly after a reversal", () => {
    const f = new OneEuroVec2(FILTER);
    let t = 0;
    for (let i = 0; i < 45; i++, t += FRAME_MS) f.update({ x: 0.2 + 1.5 * (t / 1000), y: 0.5 }, t);
    const forward = f.velocityPerSecond.x;
    expect(forward).toBeGreaterThan(0);

    // Same speed, opposite direction, for four frames.
    const atReversal = 0.2 + 1.5 * (t / 1000);
    for (let i = 0; i < 4; i++, t += FRAME_MS) {
      f.update({ x: atReversal - (1.5 * ((i + 1) * FRAME_MS)) / 1000, y: 0.5 }, t);
    }
    expect(f.velocityPerSecond.x).toBeLessThan(0);
    // The paper's own 1 Hz estimate is still pointing the wrong way here, which
    // is exactly the failure the second estimate exists to avoid.
    expect(f.speed).toBeGreaterThan(0);
  });

  it("forgets everything on reset", () => {
    const f = new OneEuroVec2(FILTER);
    for (let i = 0; i < 30; i++) f.update({ x: 0.9, y: 0.9 }, i * FRAME_MS);
    f.reset();
    expect(f.update({ x: 0.1, y: 0.1 }, 0)).toEqual({ x: 0.1, y: 0.1 });
    expect(f.speed).toBe(0);
  });
});

describe("predict", () => {
  const OPTIONS: PredictionOptions = { horizonMs: 35, fadeInFrom: 0.15, fadeInTo: 1.0 };
  const AT = { x: 0.5, y: 0.5 };

  /**
   * The property dwell-to-click depends on. A dwelling hand is a slow hand, and
   * extrapolating it would jiggle the cursor off its anchor and cancel the dwell.
   */
  it("leaves a slow hand exactly where it is", () => {
    expect(predict(AT, { x: 0.1, y: 0 }, OPTIONS)).toEqual(AT);
    expect(predict(AT, { x: 0, y: 0 }, OPTIONS)).toEqual(AT);
  });

  /** A dwell must survive prediction: the offset stays well inside the tolerance. */
  it("never nudges a dwelling hand past the dwell tolerance", () => {
    for (const speed of [0.15, 0.2, 0.3, 0.5]) {
      const out = predict(AT, { x: speed, y: 0 }, OPTIONS);
      expect(Math.hypot(out.x - AT.x, out.y - AT.y)).toBeLessThan(0.035);
    }
  });

  it("aims a fast hand ahead along its own velocity", () => {
    const out = predict(AT, { x: 2, y: 0 }, OPTIONS);
    expect(out.x).toBeGreaterThan(AT.x);
    expect(out.y).toBe(AT.y);
    // Full horizon at this speed: 2 units/s for 35 ms.
    expect(out.x - AT.x).toBeCloseTo(2 * 0.035, 6);
  });

  it("fades in rather than snapping on at the threshold", () => {
    const justOver = predict(AT, { x: 0.2, y: 0 }, OPTIONS).x - AT.x;
    const midway = predict(AT, { x: 0.6, y: 0 }, OPTIONS).x - AT.x;
    const full = predict(AT, { x: 1.0, y: 0 }, OPTIONS).x - AT.x;
    expect(justOver).toBeGreaterThan(0);
    expect(midway).toBeGreaterThan(justOver);
    expect(full).toBeGreaterThan(midway);
  });

  it("never aims further than the horizon allows", () => {
    const out = predict(AT, { x: 10, y: 0 }, OPTIONS);
    expect(out.x - AT.x).toBeCloseTo(10 * 0.035, 6);
  });
});
