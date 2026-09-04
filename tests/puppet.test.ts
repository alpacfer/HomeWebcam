import { describe, expect, it } from "vitest";
import { CONFIG } from "../src/config.js";
import { fixtureHand } from "../src/debug/hand-fixtures.js";
import { builtinScenarios, Puppet, PuppetController } from "../src/debug/puppet.js";
import { HAND, PALM_LANDMARKS } from "../src/perception/landmarks.js";

const ASPECT = 16 / 9;

describe("fixtureHand", () => {
  const hand = fixtureHand({
    indexTip: { x: 0.4, y: 0.3 },
    gesture: "Pointing_Up",
    side: "right",
    scale: 0.22,
    aspect: ASPECT,
    confidence: 0.9,
  });

  it("produces the 21 landmarks the rest of the app indexes into", () => {
    expect(hand.landmarks).toHaveLength(21);
    expect(hand.landmarks.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
  });

  it("puts the index fingertip exactly where it was asked to", () => {
    expect(hand.indexTip.x).toBeCloseTo(0.4, 6);
    expect(hand.indexTip.y).toBeCloseTo(0.3, 6);
    expect(hand.landmarks[HAND.INDEX_TIP]).toEqual(hand.indexTip);
  });

  it("derives the palm centre the way the real detector does", () => {
    const expected = PALM_LANDMARKS.map((index) => hand.landmarks[index]);
    const x = expected.reduce((sum, p) => sum + (p?.x ?? 0), 0) / expected.length;
    expect(hand.palmCenter.x).toBeCloseTo(x, 6);
  });

  it("curls the fingers a gesture does not use", () => {
    const open = fixtureHand({
      indexTip: { x: 0.5, y: 0.5 },
      gesture: "Open_Palm",
      side: "right",
      scale: 0.22,
      aspect: ASPECT,
      confidence: 1,
    });
    const fist = fixtureHand({
      indexTip: { x: 0.5, y: 0.5 },
      gesture: "Closed_Fist",
      side: "right",
      scale: 0.22,
      aspect: ASPECT,
      confidence: 1,
    });
    const spread = (h: typeof open) =>
      Math.hypot(
        (h.landmarks[HAND.PINKY_TIP]?.x ?? 0) - (h.landmarks[HAND.WRIST]?.x ?? 0),
        (h.landmarks[HAND.PINKY_TIP]?.y ?? 0) - (h.landmarks[HAND.WRIST]?.y ?? 0),
      );
    expect(spread(fist)).toBeLessThan(spread(open));
  });

  it("mirrors a left hand", () => {
    const right = fixtureHand({
      indexTip: { x: 0.5, y: 0.5 },
      gesture: "Open_Palm",
      side: "right",
      scale: 0.22,
      aspect: ASPECT,
      confidence: 1,
    });
    const left = fixtureHand({
      indexTip: { x: 0.5, y: 0.5 },
      gesture: "Open_Palm",
      side: "left",
      scale: 0.22,
      aspect: ASPECT,
      confidence: 1,
    });
    const thumbOf = (h: typeof right) => (h.landmarks[HAND.THUMB_TIP]?.x ?? 0) - 0.5;
    expect(Math.sign(thumbOf(left))).toBe(-Math.sign(thumbOf(right)));
  });
});

describe("Puppet", () => {
  const scenario = {
    name: "test",
    from: { hands: [{ at: { x: 0, y: 0.5 }, gesture: "Open_Palm" as const }] },
    steps: [{ to: { hands: [{ at: { x: 1, y: 0.5 }, gesture: "Open_Palm" as const }] }, ms: 1000 }],
  };

  it("interpolates between poses", () => {
    const puppet = new Puppet(scenario, 0);
    expect(puppet.poseAt(0).hands[0]?.at.x).toBeCloseTo(0, 6);
    expect(puppet.poseAt(500).hands[0]?.at.x).toBeCloseTo(0.5, 6);
    expect(puppet.poseAt(1000).hands[0]?.at.x).toBeCloseTo(1, 6);
  });

  it("holds the final pose and reports that it is finished", () => {
    const puppet = new Puppet(scenario, 0);
    expect(puppet.finished(999)).toBe(false);
    expect(puppet.finished(1200)).toBe(true);
    expect(puppet.poseAt(5000).hands[0]?.at.x).toBeCloseTo(1, 6);
  });

  it("wraps a looping scenario instead of ending", () => {
    const looping = { ...scenario, loop: true };
    const puppet = new Puppet(looping, 0);
    expect(puppet.finished(99_999)).toBe(false);
    expect(puppet.poseAt(1500).hands[0]?.at.x).toBeCloseTo(0.5, 6);
  });

  it("builds frames the perception contract accepts", () => {
    const puppet = new Puppet(scenario, 0);
    const frame = puppet.frame(500, 7, ASPECT);
    expect(frame.seq).toBe(7);
    expect(frame.t).toBe(500);
    expect(frame.faces).toEqual([]);
    expect(frame.hands).toHaveLength(1);
    expect(frame.hands[0]?.gesture).toBe("Open_Palm");
    expect(frame.hands[0]?.gestureConfidence).toBeGreaterThan(
      CONFIG.interaction.minGestureConfidence,
    );
  });
});

describe("PuppetController", () => {
  it("is inert until something arms it, and inert again after stop", () => {
    const controller = new PuppetController();
    expect(controller.active).toBe(false);
    expect(controller.frame(0, ASPECT)).toBeNull();

    controller.hold({ hands: [{ at: { x: 0.5, y: 0.5 } }] }, 0);
    expect(controller.active).toBe(true);
    expect(controller.frame(16, ASPECT)?.hands).toHaveLength(1);

    controller.stop();
    expect(controller.active).toBe(false);
    expect(controller.frame(32, ASPECT)).toBeNull();
  });

  it("advances the sequence number like the real engine does", () => {
    const controller = new PuppetController();
    controller.hold({ hands: [] }, 0);
    expect(controller.frame(16, ASPECT)?.seq).toBe(1);
    expect(controller.frame(32, ASPECT)?.seq).toBe(2);
  });
});

describe("builtinScenarios", () => {
  const scenarios = builtinScenarios({ x: 0.42, y: 0.1 });

  it("covers every interaction the station has", () => {
    expect(Object.keys(scenarios).sort()).toEqual([
      "both",
      "empty",
      "palm",
      "point",
      "victory",
      "wave",
    ]);
  });

  /**
   * The scenarios that exist to trip a threshold have to outlast it. Deriving
   * the durations from CONFIG is what keeps that true when a threshold moves,
   * and this is the test that says so out loud.
   */
  it("holds a gesture for longer than the gesture needs", () => {
    for (const name of ["victory", "palm"] as const) {
      const total = scenarios[name]?.steps.reduce((sum, step) => sum + step.ms, 0) ?? 0;
      expect(total).toBeGreaterThan(CONFIG.interaction.gestureHoldMs);
    }
  });

  it("points for longer than a dwell takes", () => {
    const total = scenarios.point?.steps.reduce((sum, step) => sum + step.ms, 0) ?? 0;
    expect(total).toBeGreaterThan(CONFIG.cursor.dwellMs);
  });

  it("aims the pointing scenario at the target it was given", () => {
    expect(scenarios.point?.steps.at(-1)?.to.hands[0]?.at).toEqual({ x: 0.42, y: 0.1 });
  });
});
