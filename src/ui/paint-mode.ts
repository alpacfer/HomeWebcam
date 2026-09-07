import type { CursorState } from "../interaction/cursor.js";
import {
  type BrushCursor,
  describeTool,
  PaintSession,
  type PaintStatus,
} from "../interaction/paint-session.js";
import type { Stroke } from "../interaction/painting.js";
import type { BrushPointer } from "../interaction/pinch.js";
import type { PerceptionFrame, Rect } from "../perception/types.js";
import { PaintLayer } from "./paint-layer.js";
import { PaintTray } from "./paint-tray.js";

/**
 * Paint mode on the glass: the tray of tools, the canvas the ink lands on, and
 * the wiring between the pinch and both. The decisions are made in
 * src/interaction/paint-session.ts; this reads them and draws.
 */

/** Where paint mode's controls were, for the trace. Same shape as the menu's. */
export interface PaintScene {
  pinch: number | null;
  /** The metric gap, so a take can be replayed against either ruler. ADR 0021. */
  pinchMetres: number | null;
  pinched: boolean;
  /**
   * Whether the fingers were together this frame, by the reading a line is
   * held on. Pinched and not touching is ink being held back, which is the
   * state the digest counts as `loose`. Absent on takes from before ADR 0023.
   */
  touching: boolean;
  /** The hand's size as a fraction of the frame height, so a take can be replayed with the far rule. ADR 0024. */
  handSize: number | null;
  painting: boolean;
  tool: string;
  strokes: number;
  hovered: string | null;
  panels: Array<{ id: string; rect: Rect; glow: number }>;
}

export class PaintMode {
  private readonly session = new PaintSession();
  private readonly layer: PaintLayer;
  private readonly tray: PaintTray;
  private active = false;

  constructor(root: ParentNode, canvas: HTMLCanvasElement) {
    this.layer = new PaintLayer(canvas);
    this.tray = new PaintTray(root);
    this.present();
    window.addEventListener("resize", () => this.layer.fit(this.session.strokes));
  }

  /** Entering or leaving the mode. The painting stays in memory either way. */
  setActive(active: boolean): void {
    if (this.active === active) return;
    this.active = active;
    this.settle(this.session.reset());
    this.layer.setVisible(active);
    this.tray.setVisible(active);
    if (active) this.layer.redraw(this.session.strokes);
  }

  /** Something moved the tray without resizing it. See PaintTray.remeasure. */
  relayout(): void {
    this.tray.remeasure();
  }

  /** Step one of a frame: where the hand is. The mode menu is driven with this too. */
  point(frame: PerceptionFrame, aspect: number): BrushPointer {
    return this.session.point(frame, aspect);
  }

  /** True while a stroke is being painted, so the menu may pick nothing. */
  get busy(): boolean {
    return this.session.busy;
  }

  /**
   * Step two: the menu has had the pointer. `overMenu` says whether it was on a
   * mode tile. Returns how far a dwell on a chip has got, for the cursor.
   */
  update(frame: PerceptionFrame, pointer: BrushPointer, aspect: number, overMenu: boolean): number {
    const cursor: CursorState = {
      position: pointer.position,
      dwellProgress: 0,
      activated: false,
      gesture: "None",
    };
    const tray = this.tray.update(frame, cursor, aspect, !this.session.busy);
    if (tray.activated !== null) {
      const cleared = tray.activated.kind === "clear";
      if (this.session.apply(tray.activated)) this.present();
      if (cleared) this.layer.clear();
    }

    const step = this.session.update(pointer, tray.hovered, overMenu);
    if (step.picked !== null) this.tray.consumeDwell();
    if (step.changed) this.present();
    if (step.grew !== null) this.layer.follow(step.grew);
    this.settle(step.ended);
    return tray.motion.dwell;
  }

  /**
   * Puts a finished line on the glass. Nothing is ever drawn past where the
   * fingers were last together, so a line ends where it stands: no ink to take
   * back, no redraw. See ADR 0023.
   */
  private settle(ended: Stroke | null): void {
    if (ended !== null) this.layer.finish(ended);
  }

  brush(): BrushCursor | null {
    return this.active ? this.session.brush() : null;
  }

  status(): PaintStatus {
    return this.session.status();
  }

  scene(): PaintScene {
    const status = this.session.status();
    return {
      pinch: status.pinch,
      pinchMetres: status.pinchMetres,
      pinched: status.pinched,
      touching: status.touching,
      handSize: status.handSize,
      painting: status.painting,
      tool: describeTool(status.tool),
      strokes: status.strokes,
      ...this.tray.scene(),
    };
  }

  /** Operator path, from the keyboard. */
  clear(): void {
    this.session.clear();
    this.layer.clear();
    this.present();
  }

  private present(): void {
    this.tray.present(this.session.tool, this.session.colorIndex, this.session.sizeIndex);
  }
}
