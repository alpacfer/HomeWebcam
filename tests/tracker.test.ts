import { describe, expect, it } from "vitest";
import { CentroidTracker } from "../src/perception/tracker.js";
import type { Rect } from "../src/perception/types.js";

const box = (x: number, y: number): Rect => ({ x, y, width: 0.1, height: 0.1 });

describe("CentroidTracker", () => {
  it("keeps the same id for a face that drifts slowly", () => {
    const tracker = new CentroidTracker();
    const [first] = tracker.assign([box(0.4, 0.4)], 1);
    const [second] = tracker.assign([box(0.42, 0.41)], 2);
    expect(second).toBe(first);
  });

  it("issues a new id when a face jumps further than maxJump", () => {
    const tracker = new CentroidTracker(0.1);
    const [first] = tracker.assign([box(0.1, 0.1)], 1);
    const [second] = tracker.assign([box(0.8, 0.8)], 2);
    expect(second).not.toBe(first);
  });

  it("does not give two simultaneous faces the same id", () => {
    const tracker = new CentroidTracker();
    const ids = tracker.assign([box(0.2, 0.5), box(0.7, 0.5)], 1);
    expect(new Set(ids).size).toBe(2);
  });

  it("holds an id across a short dropout, then retires it", () => {
    const tracker = new CentroidTracker(0.15, 3);
    const [first] = tracker.assign([box(0.5, 0.5)], 1);
    for (let seq = 2; seq <= 4; seq++) tracker.assign([], seq);
    expect(tracker.assign([box(0.5, 0.5)], 5)[0]).toBe(first);

    for (let seq = 6; seq <= 12; seq++) tracker.assign([], seq);
    expect(tracker.assign([box(0.5, 0.5)], 13)[0]).not.toBe(first);
  });
});
