import { describe, expect, it } from "vitest";
import { FpsMeter, SkippedFrames } from "../src/lib/fps.js";

describe("SkippedFrames", () => {
  it("reports one frame per processed frame before it has two samples", () => {
    const s = new SkippedFrames();
    expect(s.framesPerProcessed).toBe(1);
    s.tick(10);
    expect(s.framesPerProcessed).toBe(1);
  });

  it("reports 1 when the loop sees every camera frame", () => {
    const s = new SkippedFrames();
    for (let i = 0; i < 20; i++) s.tick(i);
    expect(s.framesPerProcessed).toBeCloseTo(1, 5);
  });

  it("reports 2 when the loop processes every other camera frame", () => {
    const s = new SkippedFrames();
    for (let i = 0; i < 20; i++) s.tick(i * 2);
    expect(s.framesPerProcessed).toBeCloseTo(2, 5);
  });

  /**
   * The whole point of the class: 15 processed fps means something different
   * when the camera sent 15 than when it sent 30, and the two want opposite
   * fixes. See docs/frictions/0013.
   */
  it("separates an under-delivering camera from a loop that cannot keep up", () => {
    const slowCamera = new SkippedFrames();
    for (let i = 0; i < 20; i++) slowCamera.tick(i);
    const slowLoop = new SkippedFrames();
    for (let i = 0; i < 20; i++) slowLoop.tick(i * 2);

    const processedFps = 15;
    expect(processedFps * slowCamera.framesPerProcessed).toBeCloseTo(15, 5);
    expect(processedFps * slowLoop.framesPerProcessed).toBeCloseTo(30, 5);
  });

  it("ignores a count that does not advance rather than reporting a gap of zero", () => {
    const s = new SkippedFrames();
    s.tick(5);
    s.tick(5);
    expect(s.framesPerProcessed).toBe(1);
  });

  it("forgets samples older than its window", () => {
    const s = new SkippedFrames(4);
    for (let i = 0; i < 10; i++) s.tick(i * 3);
    for (let i = 0; i < 10; i++) s.tick(30 + i);
    expect(s.framesPerProcessed).toBeCloseTo(1, 5);
  });
});

describe("FpsMeter", () => {
  it("reports zero until it has an interval to measure", () => {
    const m = new FpsMeter();
    expect(m.fps).toBe(0);
    m.tick(0);
    expect(m.fps).toBe(0);
  });

  it("measures a steady cadence", () => {
    const m = new FpsMeter();
    for (let i = 0; i <= 30; i++) m.tick(i * (1000 / 30));
    expect(m.fps).toBeCloseTo(30, 5);
  });
});
