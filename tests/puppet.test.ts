import { describe, expect, it } from "vitest";
import { CONFIG } from "../src/config.js";
import { fixtureHand } from "../src/debug/hand-fixtures.js";
import { builtinScenarios, PARTED, Puppet, PuppetController } from "../src/debug/puppet.js";
import { pinchRatio } from "../src/interaction/pinch.js";
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

  it("carries world landmarks in metres, centred on the hand, the shape MediaPipe gives", () => {
    expect(hand.world).toHaveLength(21);
    const centre = hand.world.reduce((sum, p) => sum + p.x + p.y, 0);
    expect(centre).toBeCloseTo(0, 6);
    // Wrist to middle knuckle is a palm's length whatever the fingers are
    // doing: an adult's is 9-11 cm. A hand, not a doll or a giant.
    const wrist = hand.world[HAND.WRIST];
    const knuckle = hand.world[HAND.MIDDLE_MCP];
    const palm = Math.hypot(
      (knuckle?.x ?? 0) - (wrist?.x ?? 0),
      (knuckle?.y ?? 0) - (wrist?.y ?? 0),
    );
    expect(palm).toBeGreaterThan(0.07);
    expect(palm).toBeLessThan(0.13);
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

  it("closes the thumb and index on each other for a pinch, and lands the pinch point on target", () => {
    const pinched = fixtureHand({
      indexTip: { x: 0.4, y: 0.3 },
      anchor: "pinch",
      pinch: 1,
      gesture: "None",
      side: "right",
      scale: 0.22,
      aspect: ASPECT,
      confidence: 1,
    });
    const thumb = pinched.landmarks[HAND.THUMB_TIP];
    const index = pinched.landmarks[HAND.INDEX_TIP];
    expect(thumb?.x).toBeCloseTo(index?.x ?? 0, 6);
    expect(thumb?.y).toBeCloseTo(index?.y ?? 0, 6);
    expect(index?.x).toBeCloseTo(0.4, 6);
    expect(index?.y).toBeCloseTo(0.3, 6);
    // The rest of the hand is untouched.
    expect(pinched.landmarks[HAND.PINKY_TIP]).not.toEqual(index);
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

  it("closes the pinch gradually between poses", () => {
    const closing = {
      name: "closing",
      from: { hands: [{ at: { x: 0.5, y: 0.5 }, pinch: 0 }] },
      steps: [{ to: { hands: [{ at: { x: 0.5, y: 0.5 }, pinch: 1 }] }, ms: 1000 }],
    };
    const puppet = new Puppet(closing, 0);
    expect(puppet.poseAt(0).hands[0]?.pinch).toBeCloseTo(0, 6);
    expect(puppet.poseAt(500).hands[0]?.pinch).toBeCloseTo(0.5, 6);
    expect(puppet.poseAt(1000).hands[0]?.pinch).toBeCloseTo(1, 6);
  });

  it("ships a stroke, an open sweep and a fist for Paint mode", () => {
    const scenarios = builtinScenarios({ x: 0.5, y: 0.1 });
    expect(Object.keys(scenarios)).toEqual(
      expect.arrayContaining(["stroke", "sweep", "fist", "overshoot"]),
    );
    const scenario = scenarios.stroke ?? { name: "", from: { hands: [] }, steps: [] };
    const stroke = new Puppet(scenario, 0);
    const total = scenario.steps.reduce((sum, step) => sum + step.ms, 0);

    // Walked rather than probed at fixed times: the legs are derived from the
    // gate's confirmations now, so any timing written here would be a copy of a
    // number that moves. What matters is the shape - it closes, it travels while
    // closed, and it opens again. See friction 0027.
    const walk = [];
    for (let t = 0; t <= total; t += 20) {
      const hand = stroke.poseAt(t).hands[0];
      walk.push({ pinch: hand?.pinch ?? 0, x: hand?.at.x ?? 0, anchor: hand?.anchor });
    }
    const closed = walk.findIndex((s) => s.pinch > 0.99);
    const openedAgain = walk.findIndex((s, i) => i > closed && s.pinch < 0.01);
    expect(closed).toBeGreaterThan(0);
    expect(openedAgain).toBeGreaterThan(closed);
    // The ink is the distance covered between those two moments.
    expect((walk[openedAgain]?.x ?? 0) - (walk[closed]?.x ?? 0)).toBeGreaterThan(0.2);
    expect(walk[closed]?.anchor).toBe("pinch");
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
      "dive",
      "empty",
      "fist",
      "overshoot",
      "palm",
      "part",
      "point",
      "stroke",
      "sweep",
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

  /**
   * `dive` is the one paint scenario that must NOT hold still while the gate
   * decides: its whole purpose is a hand that is travelling when the line
   * becomes certain, which is the case the head of a line is drawn back into.
   * See ADR 0020.
   */
  it("keeps the diving hand moving through every leg that matters", () => {
    const steps = scenarios.dive?.steps ?? [];
    const closing = steps.findIndex((step) => step.to.hands[0]?.pinch === 1);
    expect(closing).toBeGreaterThan(0);
    // The leg that shuts the fingers travels, and so does the one after it.
    const from = steps[closing - 1]?.to.hands[0]?.at;
    const met = steps[closing]?.to.hands[0]?.at;
    const to = steps[closing + 1]?.to.hands[0]?.at;
    expect(met).not.toEqual(from);
    expect(to).not.toEqual(met);
    // Shut in less than the ordinary confirmation takes, so the scenario is
    // never accidentally satisfied by standing still long enough.
    expect(steps[closing]?.ms ?? 0).toBeLessThan(CONFIG.paint.pinch.closeMs * 3);
  });

  /**
   * `part` exists to trip the loose limit and nothing else: the fingers leave
   * contact, stop short of the open mark, and stay there for longer than the
   * gate's patience without ever opening wide. If they opened, the ordinary
   * release would end the line and the check would prove nothing. ADR 0023.
   */
  it("keeps the parted hand between the marks past the loose limit, and never opens it", () => {
    const steps = scenarios.part?.steps ?? [];
    const closing = steps.findIndex((step) => step.to.hands[0]?.pinch === 1);
    expect(closing).toBeGreaterThan(0);
    const after = steps.slice(closing + 1);
    const parted = after.filter((step) => step.to.hands[0]?.pinch === PARTED);
    expect(parted.length).toBeGreaterThan(0);
    expect(parted.reduce((sum, step) => sum + step.ms, 0)).toBeGreaterThan(
      CONFIG.paint.pinch.looseMs,
    );
    expect(after.every((step) => (step.to.hands[0]?.pinch ?? 0) >= PARTED)).toBe(true);
    // And the parted fixture reads where the corpus puts parted fingertips:
    // above contact, below the open mark.
    const hand = fixtureHand({
      indexTip: { x: 0.5, y: 0.5 },
      anchor: "pinch",
      pinch: PARTED,
      gesture: "None",
      side: "right",
      scale: 0.22,
      aspect: ASPECT,
      confidence: 1,
    });
    expect(pinchRatio(hand, ASPECT)).toBeGreaterThan(CONFIG.paint.pinch.closeBelow);
    expect(pinchRatio(hand, ASPECT)).toBeLessThan(CONFIG.paint.pinch.openAbove);
  });

  /**
   * A leg that slides the pinch from open to closed spends only part of itself
   * on either side of a threshold, so "longer than the confirmation" is not
   * enough - it has to be long enough that the part which counts still is.
   * A 200 ms leg stopped being long enough the moment openMs reached 150, and
   * a verify check quietly painted nothing. See friction 0027.
   */
  it("gives the pinch gate room to see every change it is asked to see", () => {
    const pinch = CONFIG.paint.pinch;
    for (const name of ["stroke", "overshoot", "part"] as const) {
      const steps = scenarios[name]?.steps ?? [];
      // Sliding the pinch across the whole range puts roughly a third of the
      // leg on the far side of either threshold, so a leg has to be at least
      // three times the confirmation it is there to satisfy.
      const isOpen = (step: (typeof steps)[number]) => step.to.hands[0]?.pinch === 0;
      const isClosed = (step: (typeof steps)[number]) => step.to.hands[0]?.pinch === 1;
      const opening = steps.filter(isOpen);
      const closing = steps.filter(isClosed);
      expect(opening.length).toBeGreaterThan(0);
      expect(closing.length).toBeGreaterThan(0);
      expect(Math.max(...opening.map((s) => s.ms))).toBeGreaterThanOrEqual(pinch.openMs * 3);
      expect(Math.max(...closing.map((s) => s.ms))).toBeGreaterThanOrEqual(pinch.closeMs * 3);
      // And it opens before it closes, so a pinch left closed by whatever ran
      // before is always seen to let go.
      expect(steps.findIndex(isOpen)).toBeLessThan(steps.findIndex(isClosed));
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
