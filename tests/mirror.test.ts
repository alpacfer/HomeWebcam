import { describe, expect, it } from "vitest";
import {
  boxToMirroredScreen,
  toMirroredScreen,
  toMirroredWorld,
} from "../src/perception/mirror.js";

describe("toMirroredScreen", () => {
  it("maps the camera's left edge to the screen's right edge", () => {
    expect(toMirroredScreen({ x: 0, y: 0.5 })).toEqual({ x: 1, y: 0.5 });
  });

  it("leaves the centre alone", () => {
    expect(toMirroredScreen({ x: 0.5, y: 0.25 })).toEqual({ x: 0.5, y: 0.25 });
  });

  it("does not touch y", () => {
    expect(toMirroredScreen({ x: 0.3, y: 0.9 }).y).toBe(0.9);
  });

  it("is its own inverse", () => {
    const p = { x: 0.2, y: 0.7 };
    const round = toMirroredScreen(toMirroredScreen(p));
    expect(round.x).toBeCloseTo(p.x, 10);
    expect(round.y).toBe(p.y);
  });

  it("puts a hand on the camera's left at high screen x, so reaching right moves right", () => {
    // A visitor reaching to their own right appears on the camera's left.
    const onCameraLeft = toMirroredScreen({ x: 0.1, y: 0.5 });
    expect(onCameraLeft.x).toBeGreaterThan(0.5);
  });
});

describe("boxToMirroredScreen", () => {
  const video = { w: 1280, h: 720 };

  it("normalizes pixels to 0..1", () => {
    const r = boxToMirroredScreen(
      { originX: 320, originY: 180, width: 640, height: 360 },
      video.w,
      video.h,
    );
    expect(r.width).toBeCloseTo(0.5);
    expect(r.height).toBeCloseTo(0.5);
    expect(r.y).toBeCloseTo(0.25);
  });

  it("keeps a centred box centred", () => {
    const r = boxToMirroredScreen(
      { originX: 320, originY: 0, width: 640, height: 100 },
      video.w,
      video.h,
    );
    expect(r.x).toBeCloseTo(0.25);
  });

  it("accounts for width when flipping, so the box does not shift by its own width", () => {
    // Box hugging the camera's left edge must hug the screen's right edge.
    const r = boxToMirroredScreen(
      { originX: 0, originY: 0, width: 128, height: 128 },
      video.w,
      video.h,
    );
    expect(r.x).toBeCloseTo(0.9);
    expect(r.x + r.width).toBeCloseTo(1);
  });

  it("survives a zero-sized video without dividing by zero", () => {
    const r = boxToMirroredScreen({ originX: 0, originY: 0, width: 0, height: 0 }, 0, 0);
    expect(Number.isFinite(r.x)).toBe(true);
  });
});

describe("toMirroredWorld", () => {
  it("negates x and nothing else: the origin is the hand's own centre", () => {
    // 3 cm to the camera's left of the centre is 3 cm to the screen's right of it.
    expect(toMirroredWorld({ x: 0.03, y: -0.02, z: 0.01 })).toEqual({
      x: -0.03,
      y: -0.02,
      z: 0.01,
    });
  });

  it("keeps a distance between two points, which is all the pinch reads off it", () => {
    const a = toMirroredWorld({ x: 0.01, y: 0.0, z: 0.0 });
    const b = toMirroredWorld({ x: -0.01, y: 0.01, z: 0.02 });
    expect(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)).toBeCloseTo(
      Math.hypot(0.02, 0.01, 0.02),
      10,
    );
  });
});
