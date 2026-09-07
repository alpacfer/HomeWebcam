import { describe, expect, it } from "vitest";
import { CONFIG } from "../src/config.js";
import { fixtureHand } from "../src/debug/hand-fixtures.js";
import {
  activeGateOptions,
  handSize,
  PinchGate,
  PinchPointer,
  pinchGapMetres,
  pinchHoldRatio,
  pinchPoint,
  pinchRatio,
} from "../src/interaction/pinch.js";
import { at } from "../src/lib/assert.js";
import { HAND } from "../src/perception/landmarks.js";
import type { GestureName, PerceptionFrame } from "../src/perception/types.js";

const ASPECT = 16 / 9;

function hand(pinch: number, scale = 0.22, gesture: GestureName = "None") {
  return fixtureHand({
    indexTip: { x: 0.5, y: 0.5 },
    anchor: "pinch",
    pinch,
    gesture,
    side: "right",
    scale,
    aspect: ASPECT,
    confidence: 0.95,
  });
}

function frameWith(hands: ReturnType<typeof hand>[], t: number): PerceptionFrame {
  return { seq: Math.round(t / 16), t, hands, faces: [], heard: [] };
}

describe("pinchRatio", () => {
  it("reads an open hand as well apart and touching tips as together", () => {
    expect(pinchRatio(hand(0), ASPECT)).toBeGreaterThan(CONFIG.paint.pinch.openAbove);
    expect(pinchRatio(hand(1), ASPECT)).toBeLessThan(CONFIG.paint.pinch.closeBelow);
  });

  it("does not change with how far away the hand is", () => {
    // The same shape at arm's length and at three metres is the same ratio,
    // which is what dividing by the hand's own size buys.
    expect(pinchRatio(hand(0.5, 0.3), ASPECT)).toBeCloseTo(pinchRatio(hand(0.5, 0.1), ASPECT), 6);
  });

  it("measures in isotropic units, so the screen's shape does not stretch a gap", () => {
    const narrow = fixtureHand({
      indexTip: { x: 0.5, y: 0.5 },
      gesture: "None",
      side: "right",
      scale: 0.22,
      aspect: 1,
      confidence: 1,
    });
    // The wide-screen hand has the same landmarks squeezed in x. Measured in
    // isotropic units they are the same hand.
    expect(pinchRatio(hand(0), ASPECT)).toBeCloseTo(pinchRatio(narrow, 1), 6);
  });

  it("puts the pinch point halfway between the two tips", () => {
    const open = hand(0);
    const point = pinchPoint(open);
    const thumb = open.landmarks[4];
    const index = open.landmarks[8];
    expect(point.x).toBeCloseTo(((thumb?.x ?? 0) + (index?.x ?? 0)) / 2, 6);
    expect(point.y).toBeCloseTo(((thumb?.y ?? 0) + (index?.y ?? 0)) / 2, 6);
    // The fixture was anchored on the pinch point, so that is where it landed.
    expect(point.x).toBeCloseTo(0.5, 6);
    expect(point.y).toBeCloseTo(0.5, 6);
  });
});

describe("pinchGapMetres", () => {
  it("reads touching tips as a couple of centimetres and an open hand as several", () => {
    const shut = pinchGapMetres(hand(1));
    const open = pinchGapMetres(hand(0));
    if (shut === null || open === null) throw new Error("fixture hands carry world landmarks");
    expect(shut).toBeLessThan(CONFIG.paint.pinch.metres.closeBelow);
    expect(open).toBeGreaterThan(CONFIG.paint.pinch.metres.openAbove);
  });

  it("does not change with how far away the hand is, without dividing by anything", () => {
    // The whole point of the metric gap: a fixture drawn at a third of the
    // height reads the same number, because metres are metres.
    const near = pinchGapMetres(hand(0.5, 0.3));
    const far = pinchGapMetres(hand(0.5, 0.1));
    expect(near).not.toBeNull();
    expect(far).toBeCloseTo(near ?? Number.NaN, 6);
  });

  it("is null for a hand that came without world landmarks", () => {
    expect(pinchGapMetres({ ...hand(1), world: [] })).toBeNull();
  });
});

describe("activeGateOptions", () => {
  it("runs the gate on the ratio's marks by default", () => {
    expect(CONFIG.paint.pinch.measure).toBe("ratio");
    expect(activeGateOptions().closeBelow).toBe(CONFIG.paint.pinch.closeBelow);
  });
});

describe("PinchGate", () => {
  const options = {
    closeBelow: 0.35,
    openAbove: 0.55,
    // Below every ratio the cases here use, so they exercise the ordinary way
    // in. The fast way has its own case.
    deepBelow: 0.05,
    deepMs: 30,
    closeMs: 50,
    openMs: 150,
    lostGraceMs: 120,
    looseMs: 400,
    farBelow: 0.09,
  };

  it("starts a far hand's line on the hold reading and a near hand's on the tips", () => {
    // At two metres the tip landmarks pop over the mark every few frames of a
    // real pinch while the joints behind them stay put; at arm's length the
    // joints call a thumb resting on a pointing index a pinch. So which reading
    // may start a line depends on how big the hand is. See ADR 0024.
    const tipsApart = 0.5;
    const jointsTogether = 0.2;
    const far = new PinchGate(options);
    far.update(tipsApart, false, 0, jointsTogether, 0.06);
    expect(far.update(tipsApart, false, 60, jointsTogether, 0.06).closed).toBe(true);
    const near = new PinchGate(options);
    near.update(tipsApart, false, 0, jointsTogether, 0.15);
    expect(near.update(tipsApart, false, 60, jointsTogether, 0.15).closed).toBe(false);
    expect(near.update(tipsApart, false, 400, jointsTogether, 0.15).closed).toBe(false);
    // A caller that passes no size gets the near rule.
    const unsized = new PinchGate(options);
    unsized.update(tipsApart, false, 0, jointsTogether);
    expect(unsized.update(tipsApart, false, 400, jointsTogether).closed).toBe(false);
  });

  it("ends a pinch that settles between the marks, and says the fingers have parted", () => {
    // Hysteresis is for a reading that wobbles across a line, not for a hand
    // that has settled between them. Fingertips parted a centimetre read above
    // contact and below the open mark for seconds at a time, and a gate with no
    // clock on that band held the line the whole time. See ADR 0023.
    const gate = new PinchGate(options);
    gate.update(0.2, false, 0);
    expect(gate.update(0.2, false, 60).closed).toBe(true);
    expect(gate.update(0.2, false, 80).touching).toBe(true);
    // Between the marks: still a line, no longer touching.
    const parted = gate.update(0.45, false, 100);
    expect(parted.closed).toBe(true);
    expect(parted.touching).toBe(false);
    expect(gate.update(0.45, false, 100 + options.looseMs - 20).closed).toBe(true);
    const over = gate.update(0.45, false, 100 + options.looseMs);
    expect(over.closed).toBe(false);
    expect(over.justOpened).toBe(true);
  });

  it("restarts the loose clock every time the fingers come back together", () => {
    const gate = new PinchGate(options);
    gate.update(0.2, false, 0);
    gate.update(0.2, false, 60);
    for (let t = 80; t < 2000; t += 20) {
      // Loose for most of the limit, together for one frame, over and over: a
      // pinch that keeps touching keeps its line.
      const reading = t % 300 < 280 ? 0.45 : 0.2;
      expect(gate.update(reading, false, t).closed).toBe(true);
    }
  });

  it("reads contact off the hold reading, the one a line is held on", () => {
    // The tips glitch apart while the joints behind them do not (ADR 0022), so
    // a tip glitch is neither a parting nor a tick of the loose clock.
    const gate = new PinchGate(options);
    gate.update(0.2, false, 0);
    gate.update(0.2, false, 60);
    expect(gate.update(0.9, false, 80, 0.2).touching).toBe(true);
    expect(gate.update(0.9, false, 80 + options.looseMs + 20, 0.2).closed).toBe(true);
    expect(gate.update(null, false, 1000).touching).toBe(false);
  });

  it("lets an unmistakable pinch in early, and says when the fingers met", () => {
    // A pinch that plunges well past the mark is not something a hand does by
    // accident, so it does not wait for closeMs. See ADR 0020.
    const gate = new PinchGate({ ...options, deepBelow: 0.1, deepMs: 30 });
    gate.update(0.9, false, 0);
    expect(gate.update(0.02, false, 16).closed).toBe(false);
    const closed = gate.update(0.02, false, 50);
    expect(closed.closed).toBe(true);
    // Well before the ordinary confirmation would have allowed it.
    expect(50).toBeLessThan(options.closeMs + 16);
    // And it reports the moment the fingers met, not the moment it decided.
    expect(closed.contactSince).toBe(16);
    expect(gate.update(0.02, false, 66).contactSince).toBeNull();
  });

  it("makes a pinch that only grazes the mark wait for the whole confirmation", () => {
    const gate = new PinchGate({ ...options, deepBelow: 0.1, deepMs: 30 });
    gate.update(0.9, false, 0);
    gate.update(0.3, false, 16);
    expect(gate.update(0.3, false, 50).closed).toBe(false);
    expect(gate.update(0.3, false, 66).closed).toBe(true);
  });

  it("closes below one threshold and opens above the other", () => {
    const gate = new PinchGate(options);
    gate.update(0.2, false, 0);
    const closed = gate.update(0.2, false, 60);
    expect(closed.closed).toBe(true);
    expect(closed.justClosed).toBe(true);
    // Between the thresholds nothing changes, whichever way it got there.
    expect(gate.update(0.45, false, 120).closed).toBe(true);
    expect(gate.update(0.45, false, 300).closed).toBe(true);
    gate.update(0.7, false, 320);
    // Not yet: an opening has to hold for openMs, which is much longer.
    expect(gate.update(0.7, false, 380).closed).toBe(true);
    const opened = gate.update(0.7, false, 480);
    expect(opened.closed).toBe(false);
    expect(opened.justOpened).toBe(true);
  });

  it("ignores a change that does not last", () => {
    const gate = new PinchGate(options);
    gate.update(0.9, false, 0);
    // One frame of scrambled landmarks reading as a pinch.
    expect(gate.update(0.1, false, 16).closed).toBe(false);
    expect(gate.update(0.9, false, 32).closed).toBe(false);
    expect(gate.update(0.9, false, 200).closed).toBe(false);
  });

  it("reports the flip exactly once", () => {
    const gate = new PinchGate(options);
    gate.update(0.1, false, 0);
    expect(gate.update(0.1, false, 60).justClosed).toBe(true);
    expect(gate.update(0.1, false, 80).justClosed).toBe(false);
  });

  it("is never opened by a fist, and never started by one either", () => {
    const gate = new PinchGate(options);
    // A fist with the thumb resting on the curled index measures like a pinch,
    // so the label is what keeps a dragged fist from painting.
    gate.update(0.1, true, 0);
    expect(gate.update(0.1, true, 100).closed).toBe(false);
    // The same measurement without the label is a pinch.
    gate.update(0.1, false, 200);
    expect(gate.update(0.1, false, 300).closed).toBe(true);
    // Once a line is being drawn the label is ignored, however long it holds.
    // The recognizer calls a real pinch a fist for hundreds of milliseconds at
    // a time; letting that end a line cuts the line. See ADR 0019.
    gate.update(0.1, true, 320);
    expect(gate.update(0.1, true, 400).closed).toBe(true);
    expect(gate.update(0.1, true, 1000).closed).toBe(true);
    // Parting the fingers still ends it on the ordinary clock.
    gate.update(0.9, true, 1020);
    expect(gate.update(0.9, true, 1020 + options.openMs).closed).toBe(false);
  });

  it("reports how shut the fingers are, before deciding anything", () => {
    const gate = new PinchGate(options);
    expect(gate.update(options.openAbove + 0.1, false, 0).grip).toBe(0);
    expect(gate.update(options.closeBelow - 0.01, false, 16).grip).toBe(1);
    // Halfway between the two marks, and still not closed: the ring is telling
    // a visitor how much further to squeeze.
    const half = gate.update((options.closeBelow + options.openAbove) / 2, false, 32);
    expect(half.grip).toBeCloseTo(0.5, 2);
    expect(half.closed).toBe(false);
    expect(gate.update(null, false, 48).grip).toBe(0);
  });

  it("holds a line through a glitch that would end it, and yields to a real release", () => {
    // The thumb and index tips are the noisiest landmarks the model has, and
    // they glitch while the fingers are still shut: one held pinch jumped from
    // 0.09 to 0.80 for two frames at full confidence. Two frames must not cut a
    // line. See ADR 0018.
    const gate = new PinchGate(options);
    gate.update(0.05, false, 0);
    expect(gate.update(0.05, false, 60).closed).toBe(true);
    // Two frames of nonsense at 33 fps, then back to a tight pinch.
    expect(gate.update(0.8, false, 90).closed).toBe(true);
    expect(gate.update(0.69, false, 120).closed).toBe(true);
    expect(gate.update(0.05, false, 150).closed).toBe(true);
    // A release that means it holds past openMs.
    for (let t = 180; t <= 180 + options.openMs; t += 30) gate.update(0.7, false, t);
    expect(gate.update(0.7, false, 400).closed).toBe(false);
  });

  it("keeps a pinch through a short dropout and ends it after a long one", () => {
    const gate = new PinchGate(options);
    gate.update(0.1, false, 0);
    gate.update(0.1, false, 60);
    expect(gate.update(null, false, 100).closed).toBe(true);
    expect(gate.update(null, false, 180).closed).toBe(true);
    expect(gate.update(0.1, false, 200).closed).toBe(true);
    // Gone for good.
    gate.update(null, false, 220);
    expect(gate.update(null, false, 220 + options.lostGraceMs).closed).toBe(false);
  });
});

describe("PinchPointer", () => {
  it("follows the pinch point and says whether it is pressed", () => {
    const pointer = new PinchPointer();
    let state = pointer.update(frameWith([hand(0)], 0), ASPECT);
    expect(state.position).not.toBeNull();
    expect(state.closed).toBe(false);
    const held = CONFIG.paint.pinch.closeMs + 60;
    for (let t = 16; t <= held; t += 16) state = pointer.update(frameWith([hand(1)], t), ASPECT);
    expect(state.closed).toBe(true);
    expect(state.position?.x).toBeCloseTo(0.5, 2);
    expect(state.thumb).not.toBeNull();
    expect(state.index).not.toBeNull();
  });

  it("reports both rulers and says which one the gate read", () => {
    const pointer = new PinchPointer();
    const state = pointer.update(frameWith([hand(1)], 0), ASPECT);
    expect(state.ratio).not.toBeNull();
    expect(state.metres).not.toBeNull();
    // The default measure is the ratio, so that is the reading, exactly.
    expect(state.reading).toBe(state.ratio);
  });

  it("starts on the joints for a hand two metres back, and not for one at arm's length", () => {
    // The same pose at two sizes: fingertips reading apart, the thumb tip
    // resting against the index's middle joint. Near, that is a relaxed point
    // and must not paint (ADR 0022). Far, the tips are the noise and the
    // joints are the signal (ADR 0024).
    const posed = (scale: number) => {
      const shape = hand(1, scale);
      const size = handSize(shape, ASPECT);
      const index = at(shape.landmarks, HAND.INDEX_TIP);
      // Slide the index tip away from the thumb by 0.3 of the hand's size, in
      // isotropic units, so only the tip-to-tip pair reads apart.
      shape.landmarks[HAND.INDEX_TIP] = { x: index.x, y: index.y + 0.3 * size };
      shape.indexTip = at(shape.landmarks, HAND.INDEX_TIP);
      expect(pinchRatio(shape, ASPECT)).toBeGreaterThan(CONFIG.paint.pinch.closeBelow);
      expect(pinchHoldRatio(shape, ASPECT)).toBeLessThan(CONFIG.paint.pinch.closeBelow);
      return shape;
    };
    const paintsAt = (scale: number): boolean => {
      const pointer = new PinchPointer();
      let state = pointer.update(frameWith([posed(scale)], 0), ASPECT);
      for (let t = 16; t <= CONFIG.paint.pinch.closeMs * 3; t += 16) {
        state = pointer.update(frameWith([posed(scale)], t), ASPECT);
      }
      return state.closed;
    };
    expect(handSize(hand(1, 0.22), ASPECT)).toBeGreaterThan(CONFIG.paint.pinch.farBelow);
    expect(handSize(hand(1, 0.12), ASPECT)).toBeLessThan(CONFIG.paint.pinch.farBelow);
    expect(paintsAt(0.22)).toBe(false);
    expect(paintsAt(0.12)).toBe(true);
  });

  it("does not paint with a fist, however tight the tips", () => {
    const pointer = new PinchPointer();
    let state = pointer.update(frameWith([hand(1, 0.22, "Closed_Fist")], 0), ASPECT);
    for (let t = 16; t <= CONFIG.paint.pinch.closeMs * 2; t += 16) {
      state = pointer.update(frameWith([hand(1, 0.22, "Closed_Fist")], t), ASPECT);
    }
    expect(state.closed).toBe(false);
  });

  it("reports no position when there is no hand", () => {
    const pointer = new PinchPointer();
    const state = pointer.update(frameWith([], 0), ASPECT);
    expect(state.position).toBeNull();
    expect(state.ratio).toBeNull();
    expect(state.metres).toBeNull();
    expect(state.reading).toBeNull();
  });
});
