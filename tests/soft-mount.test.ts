import { describe, expect, it } from "vitest";
import {
  brushOffset,
  type HandImpulse,
  idleDrift,
  SoftMount,
  toScreenUnits,
} from "../src/interaction/soft-mount.js";
import { smoothstep } from "../src/lib/ease.js";

const FRAME = 1 / 60;

function run(mount: SoftMount, target: { x: number; y: number }, seconds: number): number[] {
  const trace: number[] = [];
  for (let t = 0; t < seconds; t += FRAME) trace.push(mount.step(target, FRAME).x);
  return trace;
}

describe("smoothstep", () => {
  it("clamps outside the edges and eases between them", () => {
    expect(smoothstep(0, 1, -1)).toBe(0);
    expect(smoothstep(0, 1, 2)).toBe(1);
    expect(smoothstep(0, 1, 0.5)).toBe(0.5);
    // Descending edges invert, which is how the brush falloff is written.
    expect(smoothstep(1, 0, 0)).toBe(1);
  });
});

describe("toScreenUnits", () => {
  it("stretches x by the aspect ratio so distances are isotropic", () => {
    expect(toScreenUnits({ x: 0.5, y: 0.5 }, 16 / 9)).toEqual({ x: (16 / 9) * 0.5, y: 0.5 });
  });
});

describe("SoftMount", () => {
  it("settles on the target and stays there", () => {
    const mount = new SoftMount({ damping: 0.8, stiffness: 380 }, 1);
    run(mount, { x: 0.1, y: 0 }, 2);
    expect(mount.offset.x).toBeCloseTo(0.1, 4);
    expect(mount.offset.y).toBeCloseTo(0, 6);
  });

  it("overshoots when under-damped and does not when critically damped", () => {
    const loose = new SoftMount({ damping: 0.5, stiffness: 200 }, 1);
    const tight = new SoftMount({ damping: 1, stiffness: 200 }, 1);

    expect(Math.max(...run(loose, { x: 0.1, y: 0 }, 1))).toBeGreaterThan(0.1);
    expect(Math.max(...run(tight, { x: 0.1, y: 0 }, 1))).toBeLessThanOrEqual(0.1);
  });

  it("never travels further than its limit, in any direction", () => {
    const mount = new SoftMount({ damping: 0.5, stiffness: 400 }, 0.05);
    for (let t = 0; t < 2; t += FRAME) {
      const offset = mount.step({ x: 3, y: -4 }, FRAME);
      expect(Math.hypot(offset.x, offset.y)).toBeLessThanOrEqual(0.05 + 1e-9);
    }
  });

  it("stays finite across a frame hitch", () => {
    const mount = new SoftMount({ damping: 0.6, stiffness: 800 }, 1);
    mount.step({ x: 0.2, y: 0.2 }, 5);
    expect(Number.isFinite(mount.offset.x)).toBe(true);
    expect(Number.isFinite(mount.offset.y)).toBe(true);
    run(mount, { x: 0, y: 0 }, 2);
    expect(mount.offset.x).toBeCloseTo(0, 4);
  });

  it("returns to rest after a reset", () => {
    const mount = new SoftMount({ damping: 0.8, stiffness: 200 }, 1);
    run(mount, { x: 0.1, y: 0.1 }, 1);
    mount.reset();
    expect(mount.offset).toEqual({ x: 0, y: 0 });
  });
});

describe("brushOffset", () => {
  const config = { radius: 0.3, drag: 0.02, press: 0.02 };
  const still = (position: { x: number; y: number }): HandImpulse => ({
    position,
    velocity: { x: 0, y: 0 },
  });

  it("ignores hands outside the radius", () => {
    expect(brushOffset({ x: 0.5, y: 0.1 }, [still({ x: 0.5, y: 0.9 })], config)).toEqual({
      x: 0,
      y: 0,
    });
  });

  it("carries a panel along with the direction of the wave", () => {
    const sweeping: HandImpulse = { position: { x: 0.5, y: 0.1 }, velocity: { x: 2, y: 0 } };
    const offset = brushOffset({ x: 0.5, y: 0.1 }, [sweeping], config);
    expect(offset.x).toBeCloseTo(2 * config.drag, 6);
  });

  it("pushes away from a hand that is holding still", () => {
    // Hand to the left of the panel, so the panel is nudged right.
    const offset = brushOffset({ x: 0.5, y: 0.1 }, [still({ x: 0.4, y: 0.1 })], config);
    expect(offset.x).toBeGreaterThan(0);
    expect(offset.x).toBeLessThanOrEqual(config.press);
  });

  it("fades to nothing at the edge of the radius", () => {
    const near = brushOffset({ x: 0.5, y: 0.1 }, [still({ x: 0.45, y: 0.1 })], config).x;
    const far = brushOffset({ x: 0.5, y: 0.1 }, [still({ x: 0.79, y: 0.1 })], config).x;
    expect(near).toBeGreaterThan(Math.abs(far));
    expect(far).toBeCloseTo(0, 3);
  });

  it("sums both hands", () => {
    const left: HandImpulse = { position: { x: 0.45, y: 0.1 }, velocity: { x: 0, y: 0 } };
    const right: HandImpulse = { position: { x: 0.55, y: 0.1 }, velocity: { x: 0, y: 0 } };
    const offset = brushOffset({ x: 0.5, y: 0.1 }, [left, right], config);
    // Symmetric hands cancel, which is the point of summing rather than picking one.
    expect(offset.x).toBeCloseTo(0, 6);
  });
});

describe("idleDrift", () => {
  it("stays inside its amplitude", () => {
    for (let t = 0; t < 20000; t += 97) {
      const drift = idleDrift(t, 1.7, 0.004, 7000);
      expect(Math.abs(drift.x)).toBeLessThanOrEqual(0.004);
      expect(Math.abs(drift.y)).toBeLessThanOrEqual(0.004);
    }
  });

  it("is switched off by a zero amplitude or a zero period", () => {
    expect(idleDrift(1234, 0, 0, 7000)).toEqual({ x: 0, y: 0 });
    expect(idleDrift(1234, 0, 0.004, 0)).toEqual({ x: 0, y: 0 });
  });

  it("gives neighbouring panels different phases", () => {
    const a = idleDrift(1234, 1.7, 0.004, 7000);
    const b = idleDrift(1234, 3.4, 0.004, 7000);
    expect(a.x).not.toBeCloseTo(b.x, 5);
  });
});
