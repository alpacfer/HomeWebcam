import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CONFIG } from "../src/config.js";
import { PinchGate, type PinchGateOptions } from "../src/interaction/pinch.js";
import type { GestureName } from "../src/perception/types.js";

/**
 * The pinch gate, replayed against real hands.
 *
 * Each take in tests/fixtures/pinch-takes is one person in front of the station
 * camera doing something specific, distilled down to the one number the gate
 * reads. The takes carry what they *meant* - three lines, one line, none - so
 * this is the only test in the suite that can say whether a threshold is right
 * rather than only whether the code does what it says. Retune nothing here
 * without re-running it, and add a take whenever a new way to hold a hand turns
 * out to matter. See docs/adr/0019-a-pinch-measured-against-real-hands.md.
 */

interface TakeFrame {
  t: number;
  ratio: number | null;
  /** The nearest-pair reading a line is held on. Older takes have none; the gate then holds on the ratio. */
  hold?: number;
  /** The hand's size as a fraction of the frame height. Without it a take is replayed as a near hand. */
  size?: number;
  gesture?: GestureName;
  confidence?: number;
}
interface Take {
  name: string;
  means: string;
  lines: number;
  frames: TakeFrame[];
}

function take(name: string): Take {
  return JSON.parse(readFileSync(`tests/fixtures/pinch-takes/${name}.json`, "utf8")) as Take;
}

interface Line {
  startedAt: number;
  endedAt: number | null;
  /** How long the fingers had plainly been in contact before the line began. */
  lateBy: number;
  /** How long the gate took to be sure. All of it is drawn back into the line. */
  waitMs: number;
  /** The head of the line that back-dating cannot recover, in ms of drawing. */
  lostMs: number;
  /** The last frame the fingers were together before the line ended. */
  lastTouchAt: number | null;
}

/**
 * Contact, judged independently of anything under test, so a threshold cannot
 * mark its own homework. 0.22 is above every reading these hands produced while
 * touching and below the relaxed open hand's 0.43.
 */
const CONTACT = 0.22;

function paint(t: Take, options: PinchGateOptions = CONFIG.paint.pinch): Line[] {
  const gate = new PinchGate(options);
  const lines: Line[] = [];
  let inContactSince: number | null = null;
  let lastTouchAt: number | null = null;

  for (const frame of t.frames) {
    const fist =
      frame.gesture === "Closed_Fist" &&
      (frame.confidence ?? 0) >= CONFIG.interaction.minGestureConfidence;
    const state = gate.update(
      frame.ratio,
      fist,
      frame.t,
      frame.hold ?? frame.ratio,
      frame.size ?? Number.POSITIVE_INFINITY,
    );

    if (frame.ratio !== null && frame.ratio < CONTACT) inContactSince ??= frame.t;
    else if (frame.ratio !== null) inContactSince = null;

    if (state.justClosed) {
      // The gate's own clock starts when the fingers cross closeBelow, and
      // everything after that is drawn back into the line. What is genuinely
      // lost is only the stretch before that, between plain contact and the
      // mark. See ADR 0020.
      const met = state.contactSince ?? frame.t;
      lines.push({
        startedAt: frame.t,
        endedAt: null,
        lateBy: inContactSince === null ? 0 : frame.t - inContactSince,
        waitMs: frame.t - met,
        lostMs: inContactSince === null ? 0 : Math.max(0, met - inContactSince),
        lastTouchAt: null,
      });
    }
    if (state.closed && state.touching) lastTouchAt = frame.t;
    const open = lines.at(-1);
    if (state.justOpened && open !== undefined) {
      open.endedAt = frame.t;
      open.lastTouchAt = lastTouchAt;
    }
  }
  return lines;
}

/** How long a line ran on after the fingers were last together. */
function ranOnFor(line: Line): number {
  return line.endedAt === null || line.lastTouchAt === null ? 0 : line.endedAt - line.lastTouchAt;
}

describe("the pinch gate, against real hands", () => {
  const takes = [
    "three-shapes",
    "vertical-lines",
    "one-held-pinch",
    "never-meant-it",
    "nothing-meant-near",
    "parted-slightly",
  ].map(take);

  for (const t of takes) {
    it(`draws ${t.lines} line(s) for: ${t.means}`, () => {
      expect(paint(t).length).toBe(t.lines);
    });
  }

  it("never takes longer than a confirmation to be sure", () => {
    const floor = CONFIG.paint.pinch.closeMs;
    for (const t of takes.filter((t) => t.lines > 0)) {
      for (const line of paint(t)) expect(line.waitMs).toBeLessThanOrEqual(floor + 40);
    }
  });

  it("loses almost none of the head of a line, however long it waited", () => {
    // This is the whole point of back-dating. The gate still takes its time;
    // what it no longer does is throw away the stretch of line drawn while it
    // was deciding. At 1.32 screen heights a second that stretch was 220 px.
    //
    // What is left is the frames between plain contact and closeBelow, which
    // the gate's clock has not started for yet. Seven of the ten vertical lines
    // lose nothing at all and the worst in the corpus is 89 ms; before this,
    // every line lost its whole wait, a median of 206 ms and 438 at worst.
    // Recovering the rest would mean lowering the mark again, which is what
    // ADR 0019 was about.
    //
    // Scoped to the takes CONTACT was set on. In the parted-slightly take the
    // video shows this person's fingertips visibly apart at 0.21, so a ruler at
    // 0.22 calls 292 ms of their hovering at 0.19-0.21 "contact" and reports a
    // lost head that was correctly not drawn. A per-person contact level is
    // what a bigger corpus would need here. See ADR 0023.
    for (const t of takes.filter((t) => t.lines > 0 && t.name !== "parted-slightly")) {
      for (const line of paint(t)) expect(line.lostMs).toBeLessThan(100);
    }
  });

  it("lets a decisive pinch in well inside the ordinary confirmation", () => {
    // "A lot of delay. The start should be instant." Every line in this take
    // was pinched hard enough to take the fast way in, so none of them pays
    // the full closeMs.
    const waits = paint(take("vertical-lines"))
      .map((line) => line.waitMs)
      .sort((a, b) => a - b);
    const median = waits[waits.length >> 1] ?? 0;
    expect(median).toBeLessThan(CONFIG.paint.pinch.closeMs);
    // Was 206 ms median and 438 ms at worst, with one line missing entirely.
    expect(median).toBeLessThan(150);
  });

  it("does not lose the line a spike used to cost", () => {
    // The ninth pinch of that take drew the full height of the screen and
    // painted nothing: the ratio popped over closeBelow for one frame every
    // hundred milliseconds or so and restarted the confirmation each time. The
    // fingers never left 0.12, so the fast way in never restarted. ADR 0020.
    const vertical = take("vertical-lines");
    const shallowOnly = { ...CONFIG.paint.pinch, deepBelow: 0, deepMs: 0 };
    expect(paint(vertical, shallowOnly)).toHaveLength(9);
    expect(paint(vertical)).toHaveLength(10);
  });

  it("was the complaint: a mark below a real contact makes lines wait", () => {
    // "It does not start when it should" in numbers. These hands held contact
    // at 0.13-0.16, which the old 0.12 called open, so a line waited for a
    // squeeze rather than for the confirmation: the held pinch's line was
    // 826 ms late and the worst of the three shapes 369 ms, against 234 ms and
    // 212 ms now. Only closeBelow and closeMs differ between the two.
    const old = { ...CONFIG.paint.pinch, closeBelow: 0.12, closeMs: 80 };
    const worst = (t: Take, options?: PinchGateOptions) =>
      Math.max(0, ...paint(t, options).map((line) => line.lateBy));
    expect(worst(take("one-held-pinch"), old)).toBeGreaterThan(800);
    expect(worst(take("one-held-pinch"))).toBeLessThan(300);
    expect(worst(take("three-shapes"), old)).toBeGreaterThan(worst(take("three-shapes")));
  });

  it("ends a line soon after the fingers part, without waiting for them to open wide", () => {
    // "When I separate the fingers slightly that should stop the drawing, but
    // the pinching seems sticky." In this take the fingertips parted to a
    // reading of 0.22-0.29 - above contact, below the open mark - and stayed
    // there for seconds while the hand kept moving, and the gate held every
    // line until the hand opened wide. Now a line ends within the loose limit
    // of the last frame the fingers were together. See ADR 0023.
    const lines = paint(take("parted-slightly"));
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(ranOnFor(line)).toBeLessThanOrEqual(CONFIG.paint.pinch.looseMs + 60);
    }
  });

  it("was the complaint: without the limit, a parted pinch held its line for seconds", () => {
    const unlimited = { ...CONFIG.paint.pinch, looseMs: Number.POSITIVE_INFINITY };
    const worst = Math.max(...paint(take("parted-slightly"), unlimited).map(ranOnFor));
    expect(worst).toBeGreaterThan(2000);
    // And the limit is not what holds the corpus's counts: every take draws
    // the same number of lines with it and without it, so it can only be
    // cutting lines a person had already let go of.
    for (const t of takes.filter((t) => t.name !== "parted-slightly")) {
      expect(paint(t, unlimited).length).toBe(paint(t).length);
    }
  });

  it("starts a far hand's lines on the joints: seven of eight at two metres, from four", () => {
    // "I tried 8 sets of lines. Only drew 4 and with bad quality." The hand is
    // 40-70 px tall in the 720p frame there, and the tip landmarks pop over
    // the mark every few frames of a real pinch, so no confirmation on them
    // ever completes; in the missed pinches the nearest-pair reading sat at
    // 0.00-0.09 while the tips read 0.2. Starting on it when the hand is small
    // recovers three of the four. The eighth, at 13.1 s, pops on every pair.
    // See ADR 0024.
    const far = take("eight-lines-at-two-metres");
    expect(far.lines).toBe(8);
    expect(paint(far)).toHaveLength(7);
    // The tips alone, which is what the station drew with.
    expect(paint(far, { ...CONFIG.paint.pinch, farBelow: 0 })).toHaveLength(4);
  });

  it("applies the far rule to no near take, and would invent lines if it did", () => {
    // Every take in `takes` was made at arm's length. On the nearest-pair
    // reading a thumb resting on the side of a pointing index is contact
    // (ADR 0022), so starting on it at every size draws lines nobody meant:
    // two, in the idle take that has that pose in it.
    const never = { ...CONFIG.paint.pinch, farBelow: 0 };
    const always = { ...CONFIG.paint.pinch, farBelow: Number.POSITIVE_INFINITY };
    for (const t of takes) expect(paint(t, never).length).toBe(paint(t).length);
    expect(paint(take("nothing-meant-near"), always).length).toBeGreaterThan(0);
  });

  it("never breaks the pinch that was held for twenty seconds", () => {
    const held = paint(take("one-held-pinch"));
    expect(held).toHaveLength(1);
    // It ran to the end of the take: nothing cut it, and nothing had to.
    expect(held[0]?.endedAt).toBeNull();
  });

  it("would start a line by itself if the close were not confirmed for long enough", () => {
    // Why closeMs is 180 and not less: the take where nothing was meant to be
    // drawn does dip under closeBelow, repeatedly. Only the confirmation time
    // separates those dips from a line.
    const idle = take("never-meant-it");
    expect(paint(idle, { ...CONFIG.paint.pinch, closeMs: 40 }).length).toBeGreaterThan(0);
    expect(paint(idle).length).toBe(0);
  });

  it("would cut a held line if a fist label could end one", () => {
    // Why a Closed_Fist may block a start but never an end. The recognizer
    // called this unbroken pinch a fist at full confidence for 238 ms.
    const held = take("one-held-pinch");
    const gate = new PinchGate(CONFIG.paint.pinch);
    let breaks = 0;
    for (const frame of held.frames) {
      const fist =
        frame.gesture === "Closed_Fist" &&
        (frame.confidence ?? 0) >= CONFIG.interaction.minGestureConfidence;
      // The old rule: a fist ends a line as readily as it refuses to start one.
      if (gate.update(fist ? Number.POSITIVE_INFINITY : frame.ratio, false, frame.t).justOpened) {
        breaks++;
      }
    }
    expect(breaks).toBeGreaterThan(0);
    expect(paint(held)).toHaveLength(1);
  });
});
