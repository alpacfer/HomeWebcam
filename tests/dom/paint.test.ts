// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONFIG } from "../../src/config.js";
import { fixtureHand } from "../../src/debug/hand-fixtures.js";
import type { CursorState } from "../../src/interaction/cursor.js";
import type { GestureName, PerceptionFrame, Vec2 } from "../../src/perception/types.js";
import { ExperienceUi } from "../../src/ui/experience.js";

/**
 * Paint mode against the real markup, with a canvas that remembers what was
 * asked of it. happy-dom has no 2D context and no layout, so this lane can say
 * that a pinch drew curves and an open hand drew none, that the tray comes and
 * goes with the mode, and that the trace carries the pinch - and it cannot say
 * where a chip is. Anything about hitting a chip is `npm run verify`'s.
 */
const BODY = readFileSync(resolve(process.cwd(), "index.html"), "utf8")
  .replace(/[\s\S]*<body>/, "")
  .replace(/<\/body>[\s\S]*/, "")
  .replace(/<script[\s\S]*?<\/script>/g, "");

/** Enough of CanvasRenderingContext2D to count what the layer drew. */
class FakeContext {
  calls: string[] = [];
  globalCompositeOperation = "source-over";
  strokeStyle = "";
  fillStyle = "";
  lineWidth = 0;
  lineCap = "";
  lineJoin = "";
  clearRect() {
    this.calls.push("clearRect");
  }
  beginPath() {}
  moveTo() {}
  lineTo() {
    this.calls.push("lineTo");
  }
  quadraticCurveTo() {
    this.calls.push(`quadraticCurveTo:${this.globalCompositeOperation}:${this.strokeStyle}`);
  }
  arc() {
    this.calls.push("arc");
  }
  stroke() {}
  fill() {}
}

const contexts = new Map<HTMLCanvasElement, FakeContext>();

function contextOf(id: string): FakeContext {
  const canvas = document.getElementById(id);
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error(`no canvas #${id}`);
  const ctx = contexts.get(canvas);
  if (ctx === undefined) throw new Error(`#${id} never asked for a context`);
  return ctx;
}

const NO_CURSOR: CursorState = {
  position: null,
  dwellProgress: 0,
  activated: false,
  gesture: "None",
};

function frameWith(
  hands: Array<{ at: Vec2; pinch?: number; gesture?: GestureName }>,
  t: number,
): PerceptionFrame {
  return {
    seq: Math.round(t / 16),
    t,
    faces: [],
    heard: [],
    hands: hands.map((hand) =>
      fixtureHand({
        indexTip: hand.at,
        anchor: "pinch",
        pinch: hand.pinch ?? 0,
        gesture: hand.gesture ?? "None",
        side: "right",
        scale: 0.22,
        aspect: 16 / 9,
        confidence: 0.95,
      }),
    ),
  };
}

function advance(
  ui: ExperienceUi,
  from: number,
  ms: number,
  hands: Array<{ at: Vec2; pinch?: number; gesture?: GestureName }>,
): CursorState {
  let cursor = NO_CURSOR;
  for (let t = from; t <= from + ms; t += 16) cursor = ui.update(frameWith(hands, t), NO_CURSOR);
  return cursor;
}

function build() {
  document.body.innerHTML = BODY;
  return new ExperienceUi(document, async () => "picture-test.png");
}

describe("Paint mode", () => {
  beforeEach(() => {
    contexts.clear();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (
      this: HTMLCanvasElement,
    ) {
      let ctx = contexts.get(this);
      if (ctx === undefined) {
        ctx = new FakeContext();
        contexts.set(this, ctx);
      }
      return ctx as unknown as CanvasRenderingContext2D;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.removeAttribute("data-experience-mode");
  });

  it("offers Paint as a mode a visitor can choose", () => {
    build();
    const tile = document.querySelector('[data-mode="paint"]');
    expect(tile).not.toBeNull();
    expect(tile?.classList.contains("tile--locked")).toBe(false);
    expect((tile as HTMLButtonElement).disabled).toBe(false);
    expect(tile?.querySelector(".tile__icon svg")).not.toBeNull();
  });

  it("keeps the tray and the painting off the mirror until the mode is entered", () => {
    const ui = build();
    const tray = document.getElementById("paint-tray-anchor");
    const paint = document.getElementById("paint");
    expect(tray?.hidden).toBe(true);
    expect(paint?.hidden).toBe(true);

    ui.enterPaint();
    expect(document.body.dataset.experienceMode).toBe("paint");
    expect(tray?.hidden).toBe(false);
    expect(paint?.hidden).toBe(false);
    expect(
      document.querySelector('[data-mode="paint"]')?.classList.contains("tile--selected"),
    ).toBe(true);

    ui.enterPicture();
    expect(tray?.hidden).toBe(true);
    expect(paint?.hidden).toBe(true);
  });

  it("builds one chip per colour and width, plus the eraser and the bin, all wordless", () => {
    build();
    const chips = [...document.querySelectorAll(".chip")].map(
      (chip) => (chip as HTMLElement).dataset.chip,
    );
    expect(chips).toHaveLength(CONFIG.paint.colors.length + CONFIG.paint.sizes.length + 2);
    expect(chips).toContain("erase");
    expect(chips).toContain("clear");
    for (const chip of document.querySelectorAll(".chip")) {
      expect(chip.getAttribute("aria-label")).toBeTruthy();
      expect(chip.querySelector(".ring")).not.toBeNull();
      expect(chip.textContent?.trim()).toBe("");
    }
    // The defaults are shown as such.
    const selected = [...document.querySelectorAll(".chip--selected")].map(
      (chip) => (chip as HTMLElement).dataset.chip,
    );
    expect(selected).toEqual([
      `size-${CONFIG.paint.defaultSize}`,
      `color-${CONFIG.paint.defaultColor}`,
    ]);
  });

  it("draws curves in the current colour while the fingers are pinched", () => {
    const ui = build();
    ui.enterPaint();
    const ctx = contextOf("paint");
    ctx.calls.length = 0;

    advance(ui, 0, 100, [{ at: { x: 0.3, y: 0.5 }, pinch: 0 }]);
    expect(ctx.calls.filter((c) => c.startsWith("quadraticCurveTo"))).toHaveLength(0);

    advance(ui, 116, CONFIG.paint.pinch.closeMs + 40, [{ at: { x: 0.3, y: 0.5 }, pinch: 1 }]);
    for (let t = 300; t <= 700; t += 16) {
      const x = 0.3 + ((t - 300) / 400) * 0.4;
      ui.update(frameWith([{ at: { x, y: 0.5 }, pinch: 1 }], t), NO_CURSOR);
    }
    const curves = ctx.calls.filter((c) => c.startsWith("quadraticCurveTo"));
    expect(curves.length).toBeGreaterThan(5);
    const color = CONFIG.paint.colors[CONFIG.paint.defaultColor];
    expect(curves.every((c) => c === `quadraticCurveTo:source-over:${color}`)).toBe(true);

    // The brush cursor is where the ink is, and it is pressed.
    const brush = ui.brush();
    expect(brush?.pressed).toBe(true);
    expect(brush?.color).toBe(color);
    expect(ui.paintStatus()?.strokes).toBe(1);
  });

  it("holds the ink back the frame the fingers part, and ends the line without them opening", () => {
    // The complaint behind ADR 0023: fingertips parted a centimetre read
    // between the gate's two marks, and the line ran on until the hand opened
    // wide. Nothing past the parting may reach the canvas, the ring must stop
    // saying "painting", and the line has to end from the loose limit alone.
    const ui = build();
    ui.enterPaint();
    const ctx = contextOf("paint");
    const curves = () => ctx.calls.filter((c) => c.startsWith("quadraticCurveTo")).length;
    advance(ui, 0, CONFIG.paint.pinch.closeMs + 40, [{ at: { x: 0.3, y: 0.5 }, pinch: 1 }]);
    for (let t = 300; t <= 500; t += 16) {
      const x = 0.3 + ((t - 300) / 200) * 0.2;
      ui.update(frameWith([{ at: { x, y: 0.5 }, pinch: 1 }], t), NO_CURSOR);
    }
    const drawn = curves();
    expect(drawn).toBeGreaterThan(2);

    // Parted to a reading of about 0.20, inside the band, still travelling.
    for (let t = 516; t <= 716; t += 16) {
      const x = 0.5 + ((t - 516) / 200) * 0.2;
      ui.update(frameWith([{ at: { x, y: 0.5 }, pinch: 0.8 }], t), NO_CURSOR);
    }
    expect(curves()).toBe(drawn);
    expect(ui.paintStatus()?.pinched).toBe(true);
    expect(ui.paintStatus()?.touching).toBe(false);
    expect(ui.brush()?.pressed).toBe(false);

    // Kept apart past the loose limit: the line ends, and no curve was added.
    advance(ui, 732, CONFIG.paint.pinch.looseMs + 40, [{ at: { x: 0.7, y: 0.5 }, pinch: 0.8 }]);
    expect(ui.paintStatus()?.pinched).toBe(false);
    expect(ui.paintStatus()?.strokes).toBe(1);
    expect(curves()).toBe(drawn);
  });

  it("draws nothing for an open hand sweeping across", () => {
    const ui = build();
    ui.enterPaint();
    const ctx = contextOf("paint");
    ctx.calls.length = 0;
    for (let t = 0; t <= 700; t += 16) {
      const x = 0.2 + (t / 700) * 0.6;
      ui.update(frameWith([{ at: { x, y: 0.5 }, pinch: 0 }], t), NO_CURSOR);
    }
    expect(ctx.calls.filter((c) => c.startsWith("quadraticCurveTo"))).toHaveLength(0);
    expect(ui.paintStatus()?.strokes).toBe(0);
    expect(ui.brush()?.pressed).toBe(false);
  });

  it("draws nothing for a fist, whose tips are as close as a pinch's", () => {
    const ui = build();
    ui.enterPaint();
    const ctx = contextOf("paint");
    ctx.calls.length = 0;
    for (let t = 0; t <= 700; t += 16) {
      const x = 0.2 + (t / 700) * 0.6;
      ui.update(frameWith([{ at: { x, y: 0.5 }, pinch: 1, gesture: "Closed_Fist" }], t), NO_CURSOR);
    }
    expect(ctx.calls.filter((c) => c.startsWith("quadraticCurveTo"))).toHaveLength(0);
    expect(ui.paintStatus()?.strokes).toBe(0);
  });

  it("clears the canvas from the keyboard", () => {
    const ui = build();
    ui.enterPaint();
    advance(ui, 0, CONFIG.paint.pinch.closeMs + 40, [{ at: { x: 0.3, y: 0.5 }, pinch: 1 }]);
    advance(ui, 200, 200, [{ at: { x: 0.6, y: 0.5 }, pinch: 1 }]);
    advance(ui, 416, CONFIG.paint.pinch.openMs + 40, [{ at: { x: 0.6, y: 0.5 }, pinch: 0 }]);
    expect(ui.paintStatus()?.strokes).toBe(1);
    const ctx = contextOf("paint");
    ctx.calls.length = 0;
    ui.clearPainting();
    expect(ctx.calls).toContain("clearRect");
    expect(ui.paintStatus()?.strokes).toBe(0);
  });

  it("keeps the painting while another mode is showing, and brings it back", () => {
    const ui = build();
    ui.enterPaint();
    advance(ui, 0, CONFIG.paint.pinch.closeMs + 40, [{ at: { x: 0.3, y: 0.5 }, pinch: 1 }]);
    advance(ui, 200, 200, [{ at: { x: 0.6, y: 0.5 }, pinch: 1 }]);
    ui.enterPicture();
    expect(ui.paintStatus()).toBeNull();
    expect(ui.brush()).toBeNull();
    const ctx = contextOf("paint");
    ctx.calls.length = 0;
    ui.enterPaint();
    // Redrawn from the model: the ink is still there.
    expect(ui.paintStatus()?.strokes).toBe(1);
    expect(ctx.calls.some((c) => c.startsWith("quadraticCurveTo"))).toBe(true);
  });

  it("tells the trace about the pinch, the tool and the chips", () => {
    const ui = build();
    expect(ui.scene().paint).toBeNull();
    ui.enterPaint();
    advance(ui, 0, CONFIG.paint.pinch.closeMs + 40, [{ at: { x: 0.3, y: 0.5 }, pinch: 1 }]);
    const scene = ui.scene().paint;
    expect(scene).not.toBeNull();
    expect(scene?.pinched).toBe(true);
    expect(scene?.pinch).toBeLessThan(CONFIG.paint.pinch.closeBelow);
    expect(scene?.tool).toMatch(/^brush #/);
    expect(scene?.panels.map((p) => p.id)).toContain("clear");
  });

  it("puts no words on the screen in Paint mode either", () => {
    const ui = build();
    ui.enterPaint();
    const stage = document.getElementById("stage");
    const visible = [...(stage?.querySelectorAll("*") ?? [])]
      .filter((el) => el.closest(".sr-only, #hud") === null)
      .filter((el) => el.closest("[aria-hidden='true']") === null)
      .flatMap((el) => [...el.childNodes])
      .filter((node) => node.nodeType === 3)
      .map((node) => node.textContent?.trim() ?? "")
      .filter((text) => text !== "");
    expect(visible).toEqual([]);
  });
});
