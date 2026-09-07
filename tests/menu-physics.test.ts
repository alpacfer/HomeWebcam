import { describe, expect, it } from "vitest";
import { CONFIG } from "../src/config.js";
import type { CursorState } from "../src/interaction/cursor.js";
import { MenuPhysics, type PanelLayout } from "../src/interaction/menu-physics.js";
import type { HandObservation, PerceptionFrame, Vec2 } from "../src/perception/types.js";

const ASPECT = 16 / 9;

/** Two 140 px tiles side by side at the top of a 1920x1080 screen. */
function layout(): PanelLayout[] {
  return [
    {
      center: { x: 0.79, y: 0.12 },
      rect: { x: 0.41, y: 0.03, width: 0.073, height: 0.13 },
      selectable: true,
    },
    {
      center: { x: 0.96, y: 0.12 },
      rect: { x: 0.506, y: 0.03, width: 0.073, height: 0.13 },
      selectable: false,
    },
  ];
}

function frame(t: number, hands: Vec2[] = []): PerceptionFrame {
  return {
    seq: Math.round(t),
    t,
    faces: [],
    heard: [],
    hands: hands.map(
      (palmCenter, i): HandObservation => ({
        side: i === 0 ? "right" : "left",
        landmarks: [],
        world: [],
        indexTip: palmCenter,
        palmCenter,
        gesture: "None",
        gestureConfidence: 0,
      }),
    ),
  };
}

function cursorAt(position: Vec2 | null): CursorState {
  return { position, dwellProgress: 0, activated: false, gesture: "None" };
}

function physics(): MenuPhysics {
  const menu = new MenuPhysics();
  menu.setLayout({ x: 0.875, y: 0.12 }, layout());
  return menu;
}

describe("MenuPhysics", () => {
  it("leaves the menu near its rest position when nobody is there", () => {
    const menu = physics();
    let motion = menu.update(frame(0), cursorAt(null), ASPECT);
    for (let t = 16; t < 1000; t += 16) motion = menu.update(frame(t), cursorAt(null), ASPECT);

    const panel = motion.panels[0];
    if (panel === undefined) throw new Error("no panel");
    // Only the idle drift, which is bounded by its own amplitude.
    expect(Math.hypot(panel.offset.x, panel.offset.y)).toBeLessThanOrEqual(
      CONFIG.ui.menu.idle.amplitude * 2,
    );
    expect(panel.glow).toBe(0);
  });

  it("is pushed much further by a hand sweeping across it than by drifting", () => {
    const menu = physics();
    let peak = 0;
    // A hand crossing the menu left to right in half a second.
    for (let t = 0; t <= 500; t += 16) {
      const x = 0.4 + (t / 500) * 1.2;
      const motion = menu.update(frame(t, [{ x: x / ASPECT, y: 0.12 }]), cursorAt(null), ASPECT);
      const panel = motion.panels[0];
      if (panel !== undefined) peak = Math.max(peak, Math.hypot(panel.offset.x, panel.offset.y));
    }
    expect(peak).toBeGreaterThan(CONFIG.ui.menu.idle.amplitude * 3);
    expect(peak).toBeLessThanOrEqual(CONFIG.ui.menu.tile.maxOffset + 1e-6);
  });

  it("carries the hit rectangle along with the tile it belongs to", () => {
    const menu = physics();
    let motion = menu.update(frame(0), cursorAt(null), ASPECT);
    for (let t = 16; t <= 400; t += 16) {
      motion = menu.update(frame(t, [{ x: 0.3, y: 0.12 }]), cursorAt(null), ASPECT);
    }
    const panel = motion.panels[0];
    if (panel === undefined) throw new Error("no panel");
    expect(panel.rect.x).not.toBeCloseTo(0.41, 4);
    expect(panel.rect.x - 0.41).toBeCloseTo((motion.dock.x + panel.offset.x) / ASPECT, 6);
  });

  it("dwells on a selectable panel and fires exactly once", () => {
    const menu = physics();
    const inside = { x: 0.44, y: 0.09 };
    menu.update(frame(0), cursorAt(inside), ASPECT);

    const half = menu.update(frame(CONFIG.cursor.dwellMs / 2, []), cursorAt(inside), ASPECT);
    expect(half.hovered).toBe(0);
    expect(half.dwell).toBeCloseTo(0.5, 1);
    expect(half.activated).toBeNull();

    const done = menu.update(frame(CONFIG.cursor.dwellMs + 20), cursorAt(inside), ASPECT);
    expect(done.activated).toBe(0);
    const after = menu.update(frame(CONFIG.cursor.dwellMs + 40), cursorAt(inside), ASPECT);
    expect(after.activated).toBeNull();
  });

  it("waits longer on a panel that asks for it", () => {
    const menu = new MenuPhysics();
    const [first, second] = layout();
    if (first === undefined || second === undefined) throw new Error("no layout");
    menu.setLayout({ x: 0.875, y: 0.12 }, [first, { ...second, selectable: true, dwellMs: 2000 }]);
    const inside = { x: 0.54, y: 0.09 };
    menu.update(frame(0), cursorAt(inside), ASPECT);
    const ordinary = menu.update(frame(CONFIG.cursor.dwellMs + 20), cursorAt(inside), ASPECT);
    expect(ordinary.activated).toBeNull();
    expect(ordinary.dwell).toBeCloseTo((CONFIG.cursor.dwellMs + 20) / 2000, 2);
    expect(menu.update(frame(2020), cursorAt(inside), ASPECT).activated).toBe(1);
  });

  it("hovers nothing while selection is off, and starts fresh when it returns", () => {
    const menu = physics();
    const inside = { x: 0.44, y: 0.09 };
    menu.update(frame(0), cursorAt(inside), ASPECT, false);
    const busy = menu.update(frame(CONFIG.cursor.dwellMs * 2), cursorAt(inside), ASPECT, false);
    expect(busy.hovered).toBeNull();
    expect(busy.activated).toBeNull();
    // The light still follows the hand; only the choosing is suspended.
    expect(busy.panels[0]?.glow ?? 0).toBeGreaterThan(0);
    const back = menu.update(frame(CONFIG.cursor.dwellMs * 2 + 16), cursorAt(inside), ASPECT);
    expect(back.hovered).toBe(0);
    expect(back.dwell).toBeCloseTo(0, 2);
  });

  it("does not fire a dwell that something else has already consumed", () => {
    const menu = physics();
    const inside = { x: 0.44, y: 0.09 };
    menu.update(frame(0), cursorAt(inside), ASPECT);
    menu.consume();
    const later = menu.update(frame(CONFIG.cursor.dwellMs * 2), cursorAt(inside), ASPECT);
    expect(later.hovered).toBe(0);
    expect(later.activated).toBeNull();
    // Leaving and coming back arms it again.
    menu.update(frame(CONFIG.cursor.dwellMs * 2 + 16), cursorAt({ x: 0.9, y: 0.9 }), ASPECT);
    menu.update(frame(CONFIG.cursor.dwellMs * 2 + 32), cursorAt(inside), ASPECT);
    const again = menu.update(frame(CONFIG.cursor.dwellMs * 3 + 64), cursorAt(inside), ASPECT);
    expect(again.activated).toBe(0);
  });

  it("never selects a locked panel", () => {
    const menu = physics();
    const overGame = { x: 0.54, y: 0.09 };
    menu.update(frame(0), cursorAt(overGame), ASPECT);
    const later = menu.update(frame(CONFIG.cursor.dwellMs * 2), cursorAt(overGame), ASPECT);
    expect(later.hovered).toBeNull();
    expect(later.activated).toBeNull();
  });

  it("restarts the clock when the cursor moves to another panel", () => {
    const menu = physics();
    menu.update(frame(0), cursorAt({ x: 0.44, y: 0.09 }), ASPECT);
    menu.update(frame(CONFIG.cursor.dwellMs - 50), cursorAt({ x: 0.44, y: 0.09 }), ASPECT);
    const moved = menu.update(frame(CONFIG.cursor.dwellMs), cursorAt({ x: 0.9, y: 0.9 }), ASPECT);
    expect(moved.dwell).toBe(0);
    const back = menu.update(
      frame(CONFIG.cursor.dwellMs + 50),
      cursorAt({ x: 0.44, y: 0.09 }),
      ASPECT,
    );
    expect(back.dwell).toBeCloseTo(0, 2);
  });

  it("lights the panel nearest the cursor and leaves the far one dark", () => {
    const menu = physics();
    const motion = menu.update(frame(0), cursorAt({ x: 0.44, y: 0.09 }), ASPECT);
    const [near, far] = motion.panels;
    if (near === undefined || far === undefined) throw new Error("no panels");
    expect(near.glow).toBeGreaterThan(far.glow);
    expect(near.glow).toBeGreaterThan(0);
  });
});
