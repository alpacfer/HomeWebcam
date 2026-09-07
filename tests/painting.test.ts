import { describe, expect, it } from "vitest";
import { CONFIG } from "../src/config.js";
import { fixtureHand } from "../src/debug/hand-fixtures.js";
import {
  type ChipSpec,
  chipSpecs,
  describeTool,
  PaintSession,
} from "../src/interaction/paint-session.js";
import {
  Painting,
  type Stroke,
  segmentsOf,
  type Tool,
  tailOf,
} from "../src/interaction/painting.js";
import type { PerceptionFrame, Vec2 } from "../src/perception/types.js";

const BRUSH: Tool = { kind: "brush", color: "#fff", width: 0.02 };
const ASPECT = 16 / 9;

describe("Painting", () => {
  it("keeps a stroke's points and drops the ones that did not go anywhere", () => {
    const painting = new Painting(0.01);
    painting.begin(BRUSH, { x: 0.1, y: 0.1 });
    expect(painting.extend({ x: 0.105, y: 0.1 })).toBe(false);
    expect(painting.extend({ x: 0.2, y: 0.1 })).toBe(true);
    expect(painting.current?.points).toHaveLength(2);
    painting.end();
    expect(painting.current).toBeNull();
    expect(painting.count).toBe(1);
    expect(painting.points).toBe(2);
  });

  it("copies the tool, so a colour picked later does not recolour old ink", () => {
    const painting = new Painting(0.01);
    const tool: Tool = { ...BRUSH };
    painting.begin(tool, { x: 0, y: 0 });
    tool.color = "#f00";
    expect(painting.all[0]?.tool.color).toBe("#fff");
  });

  it("clears everything, the open stroke included", () => {
    const painting = new Painting(0.01);
    painting.begin(BRUSH, { x: 0, y: 0 });
    painting.clear();
    expect(painting.count).toBe(0);
    expect(painting.current).toBeNull();
    expect(painting.extend({ x: 0.5, y: 0.5 })).toBe(false);
  });
});

describe("the smooth path", () => {
  const points: Vec2[] = [
    { x: 0, y: 0 },
    { x: 0.2, y: 0.1 },
    { x: 0.4, y: 0 },
    { x: 0.6, y: 0.1 },
  ];

  it("is continuous: every curve starts where the last one stopped", () => {
    const segments = segmentsOf(points);
    expect(segments).toHaveLength(points.length - 1);
    for (let i = 1; i < segments.length; i++) {
      expect(segments[i]?.from).toEqual(segments[i - 1]?.to);
    }
  });

  it("begins at the first point and reaches the last through the tail", () => {
    const segments = segmentsOf(points);
    expect(segments[0]?.from).toEqual(points[0]);
    const tail = tailOf(points);
    expect(tail?.from).toEqual(segments.at(-1)?.to);
    expect(tail?.to).toEqual(points.at(-1));
  });

  it("passes through the midpoint of every pair and bends around the sample itself", () => {
    const [, second] = segmentsOf(points);
    expect(second?.control).toEqual(points[1]);
    expect(second?.to.x).toBeCloseTo(0.3, 9);
    expect(second?.to.y).toBeCloseTo(0.05, 9);
  });

  it("has nothing to say about a single point", () => {
    expect(segmentsOf([{ x: 0.5, y: 0.5 }])).toEqual([]);
    expect(tailOf([{ x: 0.5, y: 0.5 }])).toBeNull();
  });
});

/** A frame with one hand whose pinch point is at `at`, pinched or not. */
function frameAt(at: Vec2, pinch: number, t: number, gesture = "None" as const): PerceptionFrame {
  return {
    seq: Math.round(t / 16),
    t,
    faces: [],
    heard: [],
    hands: [
      fixtureHand({
        indexTip: at,
        anchor: "pinch",
        pinch,
        gesture,
        side: "right",
        scale: 0.22,
        aspect: ASPECT,
        confidence: 0.95,
      }),
    ],
  };
}

const chips = chipSpecs();
const chip = (kind: ChipSpec["kind"], index = 0): ChipSpec => {
  const found = chips.find((c) => c.kind === kind && ("index" in c ? c.index === index : true));
  if (found === undefined) throw new Error(`no ${kind} chip`);
  return found;
};

/**
 * Runs the session for a while with the hand at `at`, closing or opening, and
 * sums up what happened: a pick or an end happens on one frame, so the last
 * frame's step alone would miss it.
 */
function run(
  session: PaintSession,
  at: Vec2,
  pinch: number,
  from: number,
  to: number,
  over: { chip?: ChipSpec | null; menu?: boolean } = {},
) {
  const summary: { picked: ChipSpec | null; grew: boolean; ended: Stroke | null } = {
    picked: null,
    grew: false,
    ended: null,
  };
  for (let t = from; t <= to; t += 16) {
    const pointer = session.point(frameAt(at, pinch, t), ASPECT);
    const step = session.update(pointer, over.chip ?? null, over.menu ?? false);
    summary.picked ??= step.picked;
    summary.grew ||= step.grew !== null;
    summary.ended ??= step.ended;
  }
  return summary;
}

/**
 * Runs the session through a sequence of legs, each a constant fixture pinch and
 * a straight move, starting the clock at `startAt` so consecutive calls on one
 * session keep time running forward. The fixture's ratio is 1.006 * (1 - pinch),
 * measured, so a leg at pinch 1 is a tight pinch and one at 0.8 reads 0.20 -
 * inside the hysteresis band: above contact, below the open mark, the line
 * still open and the ink held back.
 */
function drive(
  session: PaintSession,
  legs: Array<{ pinch: number; from: Vec2; to: Vec2; ms: number }>,
  startAt = 0,
): { grew: number; ended: number; t: number } {
  let t = startAt;
  let grew = 0;
  let ended = 0;
  for (const leg of legs) {
    const end = t + leg.ms;
    for (; t <= end; t += 30) {
      const k = leg.ms === 0 ? 1 : (t - (end - leg.ms)) / leg.ms;
      const at = {
        x: leg.from.x + (leg.to.x - leg.from.x) * k,
        y: leg.from.y + (leg.to.y - leg.from.y) * k,
      };
      const step = session.update(session.point(frameAt(at, leg.pinch, t), ASPECT), null, false);
      if (step.grew !== null) grew++;
      if (step.ended !== null) ended++;
    }
  }
  return { grew, ended, t };
}

const lastX = (session: PaintSession) => session.strokes[0]?.points.at(-1)?.x ?? Number.NaN;

describe("PaintSession", () => {
  // The two directions have their own clocks, and the opening one is long on
  // purpose: a glitch must not cut a line. See ADR 0018.
  const confirm = CONFIG.paint.pinch.closeMs + 40;
  const release = CONFIG.paint.pinch.openMs + 40;

  it("paints when the fingers close over the mirror, and stops when they part", () => {
    const session = new PaintSession();
    run(session, { x: 0.3, y: 0.5 }, 0, 0, 100);
    run(session, { x: 0.3, y: 0.5 }, 1, 116, 116 + confirm);
    expect(session.busy).toBe(true);
    const step = run(session, { x: 0.6, y: 0.5 }, 1, 300, 400);
    expect(step.grew).toBe(true);
    expect(session.strokes).toHaveLength(1);
    expect(session.strokes[0]?.points.length).toBeGreaterThan(2);

    const ended = run(session, { x: 0.6, y: 0.5 }, 0, 416, 416 + release);
    expect(ended.ended).toBe(session.strokes[0]);
    expect(session.busy).toBe(false);
  });

  it("begins the line where the fingers met, not where the gate caught up", () => {
    // A gate cannot know a pinch has begun until it has held, and a hand paints
    // at over a screen height a second, so the head of every line used to be
    // missing. The stroke is begun from where the fingers met and the points in
    // between are replayed. See ADR 0020.
    const session = new PaintSession();
    const y = (t: number) => 0.2 + (t / 1000) * 1.2;

    let began: Stroke | null = null;
    let beganAt = 0;
    for (let t = 0; t <= 400; t += 16) {
      // Fingers shut from the first frame; the hand is already moving.
      const pointer = session.point(frameAt({ x: 0.5, y: y(t) }, 1, t), ASPECT);
      const step = session.update(pointer, null, false);
      if (step.grew !== null && began === null) {
        began = step.grew;
        beganAt = t;
      }
    }

    expect(began).not.toBeNull();
    expect(beganAt).toBeGreaterThan(0);
    const head = began?.points[0];
    // The line starts up where the pinch did, not down where the gate agreed.
    expect(head?.y ?? 1).toBeLessThan(y(beganAt) - 0.02);
    expect(head?.y ?? 1).toBeCloseTo(0.2, 1);
    // And it arrives with the stretch in between already in it.
    expect(began?.points.length ?? 0).toBeGreaterThan(1);
  });

  it("never reaches back further than the guard allows", () => {
    // The reach is bounded, so no scenario can drag a long stretch of travel
    // into the front of a line.
    const session = new PaintSession();
    const speed = 1.2; // screen heights per second
    const y = (t: number) => 0.2 + (t / 1000) * speed;

    let began: Stroke | null = null;
    let beganAt = 0;
    for (let t = 0; t <= 400; t += 16) {
      const pointer = session.point(frameAt({ x: 0.5, y: y(t) }, 1, t), ASPECT);
      const step = session.update(pointer, null, false);
      if (step.grew !== null && began === null) {
        began = step.grew;
        beganAt = t;
      }
    }
    const head = began?.points[0];
    expect(head).toBeDefined();
    const reached = y(beganAt) - (head?.y ?? 0);
    expect(reached).toBeLessThanOrEqual((CONFIG.paint.startBackdateMs / 1000) * speed);
  });

  it("does nothing with an open hand, however far it travels", () => {
    const session = new PaintSession();
    for (let t = 0; t <= 600; t += 16) {
      const x = 0.2 + (t / 600) * 0.6;
      session.update(session.point(frameAt({ x, y: 0.5 }, 0, t), ASPECT), null, false);
    }
    expect(session.strokes).toHaveLength(0);
  });

  it("picks the chip a pinch closes on, and paints nothing", () => {
    const session = new PaintSession();
    const red = chip("color", 2);
    run(session, { x: 0.9, y: 0.5 }, 0, 0, 100, { chip: red });
    const step = run(session, { x: 0.9, y: 0.5 }, 1, 116, 116 + confirm, { chip: red });
    expect(step.picked).toEqual(red);
    expect(session.tool.color).toBe(CONFIG.paint.colors[2]);
    expect(session.strokes).toHaveLength(0);
    // Still pinched, now over the mirror: a pinch that began on a control never paints.
    run(session, { x: 0.5, y: 0.5 }, 1, 300, 500);
    expect(session.strokes).toHaveLength(0);
  });

  it("does not paint from a pinch that closed on the mode menu", () => {
    const session = new PaintSession();
    run(session, { x: 0.5, y: 0.1 }, 0, 0, 100, { menu: true });
    run(session, { x: 0.5, y: 0.1 }, 1, 116, 116 + confirm, { menu: true });
    run(session, { x: 0.5, y: 0.5 }, 1, 300, 500);
    expect(session.strokes).toHaveLength(0);
  });

  it("keeps painting through the tray without picking anything", () => {
    const session = new PaintSession();
    const before = session.tool;
    run(session, { x: 0.5, y: 0.5 }, 1, 0, confirm);
    // While a stroke is in progress the tray reports no hover, so what the
    // session sees is what the physics would give it: nothing.
    run(session, { x: 0.9, y: 0.5 }, 1, 200, 400, { chip: null });
    expect(session.busy).toBe(true);
    expect(session.tool).toEqual(before);
    expect(session.strokes[0]?.points.length).toBeGreaterThan(2);
  });

  it("never clears from a pinch; the bin wants the long dwell", () => {
    const session = new PaintSession();
    run(session, { x: 0.5, y: 0.5 }, 1, 0, confirm);
    run(session, { x: 0.5, y: 0.5 }, 0, 200, 200 + release);
    expect(session.strokes).toHaveLength(1);
    const step = run(session, { x: 0.9, y: 0.7 }, 1, 400, 400 + confirm, { chip: chip("clear") });
    expect(step.picked).toBeNull();
    expect(session.strokes).toHaveLength(1);
    // The dwell path does clear.
    expect(session.apply(chip("clear"))).toBe(true);
    expect(session.strokes).toHaveLength(0);
  });

  it("lays no ink once the fingers have parted, and ends the line where they were last together", () => {
    // The gate holds a line through a landmark glitch on purpose, so it cannot
    // call a parting a release until one has lasted. The ink does not wait with
    // it: nothing past the parting reaches the glass. "When I separate the
    // fingers slightly that should stop the drawing." See ADR 0023.
    const session = new PaintSession();
    const drawn = drive(session, [
      { pinch: 1, from: { x: 0.3, y: 0.5 }, to: { x: 0.3, y: 0.5 }, ms: 150 },
      { pinch: 1, from: { x: 0.3, y: 0.5 }, to: { x: 0.6, y: 0.5 }, ms: 240 },
    ]);
    expect(lastX(session)).toBeCloseTo(0.6, 1);

    // Parted, still inside the band: the line is open and no ink flows.
    const parted = drive(
      session,
      [{ pinch: 0.8, from: { x: 0.6, y: 0.5 }, to: { x: 0.85, y: 0.5 }, ms: 180 }],
      drawn.t,
    );
    expect(parted.grew).toBe(0);
    expect(parted.ended).toBe(0);
    expect(session.busy).toBe(true);
    expect(session.brush()?.pressed).toBe(false);
    expect(lastX(session)).toBeCloseTo(0.6, 1);

    // Kept apart past the loose limit, never opened wide: the line ends by
    // itself, where the fingers were last together, not where the hand is.
    const over = drive(
      session,
      [
        {
          pinch: 0.8,
          from: { x: 0.85, y: 0.5 },
          to: { x: 0.95, y: 0.5 },
          ms: CONFIG.paint.pinch.looseMs,
        },
      ],
      parted.t,
    );
    expect(over.grew).toBe(0);
    expect(over.ended).toBe(1);
    expect(session.busy).toBe(false);
    expect(lastX(session)).toBeCloseTo(0.6, 1);
    expect(session.strokes).toHaveLength(1);
  });

  it("fills a loose stretch shorter than the limit back in when the fingers meet again", () => {
    // A glitch the gate rides out must not leave a gap: the points held back
    // while the reading was loose are laid down, in order, the frame contact
    // returns, so the line follows the hand through it. See ADR 0023.
    const session = new PaintSession();
    const first = drive(session, [
      { pinch: 1, from: { x: 0.2, y: 0.5 }, to: { x: 0.4, y: 0.5 }, ms: 240 },
    ]);
    // Loose in the middle, for less than the limit: nothing is drawn yet.
    const loose = drive(
      session,
      [{ pinch: 0.8, from: { x: 0.4, y: 0.5 }, to: { x: 0.6, y: 0.5 }, ms: 180 }],
      first.t,
    );
    expect(loose.grew).toBe(0);
    expect(lastX(session)).toBeCloseTo(0.4, 1);
    drive(
      session,
      [{ pinch: 1, from: { x: 0.6, y: 0.5 }, to: { x: 0.8, y: 0.5 }, ms: 240 }],
      loose.t,
    );
    const xs = session.strokes[0]?.points.map((p) => p.x) ?? [];
    // The middle was filled in, and the tight run after it is there too.
    expect(xs.some((x) => x > 0.42 && x < 0.58)).toBe(true);
    expect(Math.max(...xs)).toBeGreaterThan(0.75);
    expect(session.strokes).toHaveLength(1);
  });

  it("composes the tool from the chips picked so far", () => {
    const session = new PaintSession();
    expect(session.tool).toEqual({
      kind: "brush",
      color: CONFIG.paint.colors[CONFIG.paint.defaultColor],
      width: CONFIG.paint.sizes[CONFIG.paint.defaultSize],
    });
    session.apply(chip("size", 2));
    session.apply(chip("erase"));
    expect(session.tool.kind).toBe("erase");
    expect(session.tool.width).toBeCloseTo(
      (CONFIG.paint.sizes[2] ?? 0) * CONFIG.paint.eraserScale,
      9,
    );
    expect(describeTool(session.tool)).toMatch(/^erase /);
    // The eraser toggles; a colour turns it off.
    session.apply(chip("erase"));
    expect(session.tool.kind).toBe("brush");
    session.apply(chip("erase"));
    session.apply(chip("color", 0));
    expect(session.tool.kind).toBe("brush");
    expect(session.tool.color).toBe(CONFIG.paint.colors[0]);
  });

  it("says whether picking a chip changed anything", () => {
    const session = new PaintSession();
    expect(session.apply(chip("size", CONFIG.paint.defaultSize))).toBe(false);
    expect(session.apply(chip("size", 0))).toBe(true);
    expect(session.apply(chip("color", CONFIG.paint.defaultColor))).toBe(false);
  });

  it("offers the brush at the pinch point, in the current colour, pressed while pinched", () => {
    const session = new PaintSession();
    expect(session.brush()).toBeNull();
    run(session, { x: 0.4, y: 0.4 }, 0, 0, 32);
    const open = session.brush();
    expect(open?.pressed).toBe(false);
    expect(open?.color).toBe(session.tool.color);
    expect(open?.position.x).toBeCloseTo(0.4, 2);
    run(session, { x: 0.4, y: 0.4 }, 1, 48, 48 + confirm);
    expect(session.brush()?.pressed).toBe(true);
    // Parted inside the band: the line is still open, but the ring says what
    // the glass says - no ink is flowing. See ADR 0023.
    run(session, { x: 0.4, y: 0.4 }, 0.8, 48 + confirm + 16, 48 + confirm + 100);
    expect(session.busy).toBe(true);
    expect(session.brush()?.pressed).toBe(false);
  });

  it("ends the open stroke when the mode is left", () => {
    const session = new PaintSession();
    run(session, { x: 0.5, y: 0.5 }, 1, 0, confirm);
    const ended = session.reset();
    expect(ended).toBe(session.strokes[0]);
    expect(session.busy).toBe(false);
    expect(session.brush()).toBeNull();
  });
});
