import { CONFIG } from "../config.js";
import { smoothstep } from "../lib/ease.js";
import type { PerceptionFrame, Rect, Vec2 } from "../perception/types.js";
import type { CursorState } from "./cursor.js";
import { HandMotion } from "./hand-motion.js";
import { brushOffset, idleDrift, SoftMount, toScreenUnits } from "./soft-mount.js";

/**
 * Where the menu is, once hands have had their way with it.
 *
 * The UI layer measures the panels at rest and draws whatever comes back out of
 * here; every number a panel needs per frame - how far it has been shoved, how
 * far it is leaning, where the light on its face is, whether the cursor has
 * dwelled long enough to pick it - is produced in this file. That keeps the
 * renderer stateless, which is the rule, and it makes the feel of the thing
 * testable without a camera. See src/interaction/soft-mount.ts for the springs.
 */

/** Measured by the UI with transforms suppressed: where a panel sits at rest. */
export interface PanelLayout {
  /** Centre in isotropic screen units. */
  center: Vec2;
  /** Rest rectangle in normalized mirrored screen space. */
  rect: Rect;
  /** A locked panel is still brushed by hands; it just cannot be chosen. */
  selectable: boolean;
}

export interface PanelMotion {
  /** Travel from rest, in isotropic screen units. Multiply by viewport height. */
  offset: Vec2;
  /** Travel as a fraction of the panel's limit, -1..1. Drives the lean. */
  lean: Vec2;
  /** Where the hand's light falls on the panel, 0..1 of its own box. */
  reveal: Vec2;
  /** How lit the panel is, 0..1. */
  glow: number;
  /** The panel's live rectangle, shifted by everything above. */
  rect: Rect;
}

export interface MenuMotion {
  dock: Vec2;
  panels: PanelMotion[];
  hovered: number | null;
  /** 0..1 toward selecting the hovered panel. */
  dwell: number;
  /** Set for exactly one frame, on the panel a dwell just completed over. */
  activated: number | null;
}

const AT_REST: PanelMotion = {
  offset: { x: 0, y: 0 },
  lean: { x: 0, y: 0 },
  reveal: { x: 0.5, y: 0.5 },
  glow: 0,
  rect: { x: 0, y: 0, width: 0, height: 0 },
};

export class MenuPhysics {
  private readonly motion = new HandMotion(CONFIG.ui.menu.velocitySmoothingHz);
  private readonly dock = new SoftMount(CONFIG.ui.menu.dock.spring, CONFIG.ui.menu.dock.maxOffset);
  private mounts: SoftMount[] = [];
  private layout: PanelLayout[] = [];
  private dockLayout: Vec2 = { x: 0, y: 0 };

  private lastT: number | null = null;
  private hovered: number | null = null;
  private hoveredSince = 0;
  private fired = false;

  /** Called by the UI whenever the panels have been re-measured at rest. */
  setLayout(dockCenter: Vec2, panels: readonly PanelLayout[]): void {
    this.dockLayout = dockCenter;
    this.layout = [...panels];
    if (this.mounts.length !== panels.length) {
      this.mounts = panels.map(
        () => new SoftMount(CONFIG.ui.menu.tile.spring, CONFIG.ui.menu.tile.maxOffset),
      );
    }
  }

  update(frame: PerceptionFrame, cursor: CursorState, aspect: number): MenuMotion {
    const dt = this.lastT === null ? 0 : (frame.t - this.lastT) / 1000;
    this.lastT = frame.t;

    const impulses = this.motion.sample(frame, aspect);
    const brush = CONFIG.ui.menu.brush;
    const idle = CONFIG.ui.menu.idle;
    const dockOffset = this.dock.step(
      add(
        brushOffset(this.dockLayout, impulses, brush),
        idleDrift(frame.t, 0, idle.amplitude, idle.periodMs),
      ),
      dt,
    );
    const light = cursor.position === null ? null : toScreenUnits(cursor.position, aspect);

    const panels = this.layout.map((panel, index) => {
      const mount = this.mounts[index];
      if (mount === undefined) return AT_REST;

      // The tile hangs inside the dock, so what a hand actually reaches for is
      // the tile's rest position plus wherever the dock has swung to.
      const center = {
        x: panel.center.x + dockOffset.x + mount.offset.x,
        y: panel.center.y + dockOffset.y + mount.offset.y,
      };
      const offset = mount.step(
        add(
          brushOffset(center, impulses, brush),
          // Each tile gets its own phase, so the row breathes instead of
          // sliding around as one rigid block.
          idleDrift(frame.t, (index + 1) * 1.7, idle.amplitude, idle.periodMs),
        ),
        dt,
      );
      const rect: Rect = {
        x: panel.rect.x + (dockOffset.x + offset.x) / aspect,
        y: panel.rect.y + dockOffset.y + offset.y,
        width: panel.rect.width,
        height: panel.rect.height,
      };

      return {
        offset,
        lean: {
          x: clamp(offset.x / CONFIG.ui.menu.tile.maxOffset, -1, 1),
          y: clamp(offset.y / CONFIG.ui.menu.tile.maxOffset, -1, 1),
        },
        ...revealOf(light, center, rect, aspect),
        rect,
      };
    });

    return { dock: dockOffset, panels, ...this.selection(cursor, panels, frame.t) };
  }

  /**
   * Dwell over whichever panel the cursor is inside. Moving to another panel
   * restarts the clock: a hand that drifts across two tiles has chosen neither.
   */
  private selection(
    cursor: CursorState,
    panels: readonly PanelMotion[],
    now: number,
  ): Pick<MenuMotion, "hovered" | "dwell" | "activated"> {
    let target: number | null = null;
    if (cursor.position !== null) {
      for (const [index, panel] of panels.entries()) {
        if (this.layout[index]?.selectable !== true) continue;
        if (contains(panel.rect, cursor.position)) target = index;
      }
    }

    if (target !== this.hovered) {
      this.hovered = target;
      this.hoveredSince = now;
      this.fired = false;
    }
    if (target === null) return { hovered: null, dwell: 0, activated: null };

    const dwell = Math.min(1, (now - this.hoveredSince) / CONFIG.cursor.dwellMs);
    const activated = dwell >= 1 && !this.fired;
    if (activated) this.fired = true;
    return { hovered: target, dwell, activated: activated ? target : null };
  }
}

/**
 * The light a hand carries over the glass: Fluent's reveal highlight, with the
 * pointer replaced by a fingertip. Position is in the panel's own box so the
 * renderer can drop a radial gradient straight onto it.
 */
function revealOf(
  light: Vec2 | null,
  center: Vec2,
  rect: Rect,
  aspect: number,
): Pick<PanelMotion, "reveal" | "glow"> {
  if (light === null) return { reveal: { x: 0.5, y: 0.5 }, glow: 0 };
  const distance = Math.hypot(light.x - center.x, light.y - center.y);
  return {
    reveal: {
      x: (light.x / aspect - rect.x) / rect.width,
      y: (light.y - rect.y) / rect.height,
    },
    glow: smoothstep(CONFIG.ui.menu.revealRadius, 0, distance),
  };
}

function contains(rect: Rect, point: Vec2): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
