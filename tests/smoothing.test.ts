import { describe, expect, it } from "vitest";
import { distance, SmoothedVec2 } from "../src/lib/smoothing.js";

describe("SmoothedVec2", () => {
  it("passes the first sample straight through", () => {
    const s = new SmoothedVec2(3);
    expect(s.update({ x: 0.5, y: 0.5 }, 0)).toEqual({ x: 0.5, y: 0.5 });
  });

  it("lags a step change instead of following it", () => {
    const s = new SmoothedVec2(3);
    s.update({ x: 0, y: 0 }, 0);
    const next = s.update({ x: 1, y: 0 }, 16);
    expect(next.x).toBeGreaterThan(0);
    expect(next.x).toBeLessThan(0.5);
  });

  it("converges on a held target", () => {
    const s = new SmoothedVec2(3);
    s.update({ x: 0, y: 0 }, 0);
    let last = { x: 0, y: 0 };
    for (let i = 1; i <= 120; i++) last = s.update({ x: 1, y: 0 }, i * 16);
    expect(last.x).toBeCloseTo(1, 2);
  });

  it("smooths by the same amount per unit time regardless of frame rate", () => {
    const fast = new SmoothedVec2(3);
    fast.update({ x: 0, y: 0 }, 0);
    for (let i = 1; i <= 20; i++) fast.update({ x: 1, y: 0 }, i * 10);

    const slow = new SmoothedVec2(3);
    slow.update({ x: 0, y: 0 }, 0);
    for (let i = 1; i <= 4; i++) slow.update({ x: 1, y: 0 }, i * 50);

    // Both advanced 200ms of wall clock, at 100 fps and 20 fps respectively.
    expect(fast.update({ x: 1, y: 0 }, 200).x).toBeCloseTo(slow.update({ x: 1, y: 0 }, 200).x, 3);
  });

  it("forgets its state on reset", () => {
    const s = new SmoothedVec2(3);
    s.update({ x: 0, y: 0 }, 0);
    s.reset();
    expect(s.update({ x: 0.9, y: 0.9 }, 16)).toEqual({ x: 0.9, y: 0.9 });
  });
});

describe("distance", () => {
  it("measures normalized euclidean distance", () => {
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });
});
