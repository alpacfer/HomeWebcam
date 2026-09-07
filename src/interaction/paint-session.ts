import { CONFIG } from "../config.js";
import { at } from "../lib/assert.js";
import type { PerceptionFrame, Vec2 } from "../perception/types.js";
import { Painting, type Stroke, type Tool } from "./painting.js";
import { type BrushPointer, PinchPointer } from "./pinch.js";

/**
 * Paint mode's state: what is being painted, with what, and what the pinch
 * currently means. No DOM in here; the renderer (src/ui/paint-mode.ts) reads
 * this and draws, which is how the rest of the interface is cut too.
 *
 * One hand does everything. Pinched over the mirror, it paints. Open over a
 * chip, it dwells and picks. Pinched over a chip, it picks at once: by then
 * the visitor knows what a pinch is. A stroke that began on the mirror keeps
 * painting wherever it goes; a pinch that began on a control never paints,
 * however far it wanders. See docs/adr/0017-pinch-to-paint.md.
 *
 * Ink flows only while the fingers are together. The gate takes its time to
 * call a line over, because a landmark glitch must not cut one, but nothing
 * it is unsure about reaches the glass: the points a hand travels through
 * while the fingers are apart are held back, laid down only if contact
 * returns before the gate gives up, and dropped otherwise. See ADR 0023.
 */

/** One control in the tray. Built from CONFIG.paint by `chipSpecs`. */
export type ChipSpec =
  | { readonly id: string; readonly kind: "color"; readonly index: number; readonly color: string }
  | { readonly id: string; readonly kind: "size"; readonly index: number; readonly width: number }
  | { readonly id: "erase"; readonly kind: "erase" }
  | { readonly id: "clear"; readonly kind: "clear" };

export function chipSpecs(): ChipSpec[] {
  const paint = CONFIG.paint;
  return [
    ...paint.sizes.map(
      (width, index): ChipSpec => ({ id: `size-${index}`, kind: "size", index, width }),
    ),
    { id: "erase", kind: "erase" },
    { id: "clear", kind: "clear" },
    ...paint.colors.map(
      (color, index): ChipSpec => ({ id: `color-${index}`, kind: "color", index, color }),
    ),
  ];
}

/** What the overlay draws in place of the cursor while painting. */
export interface BrushCursor {
  position: Vec2;
  /** Line width in screen heights: the ring is drawn at the size the ink will be. */
  width: number;
  color: string;
  erasing: boolean;
  /**
   * Ink is flowing this frame: the gate is closed and the fingers are together.
   * The ring fills solid. It drops back to `grip` the frame the fingers part,
   * which is the same frame the ink stops, so the cursor never says "painting"
   * while the glass says otherwise. See ADR 0023.
   */
  pressed: boolean;
  /**
   * How shut the fingers are, 0 to 1, measured rather than decided. The ring
   * fills to it, so closing the fingers is answered continuously instead of
   * only at the threshold, and a visitor whose pinch is not quite tight enough
   * can see that rather than guess. See ADR 0019.
   */
  grip: number;
  /** The two fingertips, so a visitor can watch them close on the ring. */
  thumb: Vec2 | null;
  index: Vec2 | null;
}

/** Paint mode in numbers, for the HUD, the snapshot and the trace. */
export interface PaintStatus {
  /** The 2D ratio, the number every take so far was tuned on. */
  pinch: number | null;
  /** The metric gap, when the hand came with world landmarks. See ADR 0021. */
  pinchMetres: number | null;
  pinched: boolean;
  /** The fingers are together this frame, by the reading a line is held on. */
  touching: boolean;
  /**
   * The hand's size as a fraction of the frame height, the gate's distance
   * ruler; null without a hand. Under CONFIG.paint.pinch.farBelow a line
   * starts on the nearest-pair reading. See ADR 0024.
   */
  handSize: number | null;
  painting: boolean;
  tool: Tool;
  strokes: number;
  points: number;
}

/** What one frame did to the painting, for the renderer to follow. */
export interface PaintStep {
  /** The stroke that gained points this frame, whether it began or continued. */
  grew: Stroke | null;
  /** The stroke that ended this frame. Its points are final: nothing is ever drawn past them. */
  ended: Stroke | null;
  /** The chip a pinch picked this frame, so the dwell on it can be consumed. */
  picked: ChipSpec | null;
  /** Something about the tool or the painting changed and the tray should say so. */
  changed: boolean;
}

/** What a pinch that just closed is for. Decided once, when it closes. */
type Role = "paint" | "select";

export class PaintSession {
  private readonly pointer = new PinchPointer();
  private readonly painting = new Painting(CONFIG.paint.minSegment);

  private color: number = CONFIG.paint.defaultColor;
  private size: number = CONFIG.paint.defaultSize;
  private erasing = false;
  private role: Role | null = null;
  private last: BrushPointer | null = null;
  /**
   * Where the hand went while the fingers were apart and the line still open.
   *
   * The gate holds a line through a landmark glitch on purpose, and it cannot
   * tell a glitch from a release until one has lasted. The ink must not wait
   * with it: a person who has parted their fingers is watching the line, and
   * every point drawn past the parting is a point they did not mean. So these
   * are kept here instead of in the stroke. Contact again inside the gate's
   * patience and they are laid down in order, so the line follows the hand's
   * path through the glitch rather than jumping across it; the gate giving up
   * and they are dropped. See ADR 0023.
   */
  private readonly heldBack: Vec2[] = [];
  /**
   * The last `startBackdateMs` of readings, so a line can be drawn back to
   * where the fingers met. The gate cannot know a pinch has begun until it has
   * held, and by then the hand has been drawing for a confirmation; this is how
   * that stretch gets into the line instead of being lost off its front.
   * See `backdate` and ADR 0020.
   */
  private readonly recent: Array<{ position: Vec2; t: number }> = [];

  get tool(): Tool {
    const color = at(CONFIG.paint.colors, this.color, "paint colors");
    const width = at(CONFIG.paint.sizes, this.size, "paint sizes");
    return this.erasing
      ? { kind: "erase", color, width: width * CONFIG.paint.eraserScale }
      : { kind: "brush", color, width };
  }

  get colorIndex(): number {
    return this.color;
  }

  get sizeIndex(): number {
    return this.size;
  }

  get strokes(): readonly Stroke[] {
    return this.painting.all;
  }

  /** True while a stroke is open, so nothing else may be picked. */
  get busy(): boolean {
    return this.role === "paint" && (this.last?.closed ?? false);
  }

  /** Step one of a frame: where the hand is, before the menus are driven with it. */
  point(frame: PerceptionFrame, aspect: number): BrushPointer {
    const pointer = this.pointer.update(frame, aspect);
    this.last = pointer;
    if (pointer.position !== null && pointer.reading !== null) {
      this.recent.push({ position: pointer.position, t: pointer.t });
    }
    const oldest = pointer.t - CONFIG.paint.startBackdateMs;
    while ((this.recent[0]?.t ?? Number.POSITIVE_INFINITY) < oldest) this.recent.shift();
    return pointer;
  }

  /**
   * Step two, once the menus have said what the pointer is over.
   *
   * @param hovered The chip under an open hand, or null.
   * @param overMenu Whether the pointer is on a mode tile.
   */
  update(pointer: BrushPointer, hovered: ChipSpec | null, overMenu: boolean): PaintStep {
    const step: PaintStep = { grew: null, ended: null, picked: null, changed: false };

    if (pointer.justClosed && pointer.position !== null) {
      if (hovered !== null) {
        // The bin is the exception: a pinch on it is nothing. Clearing wants
        // the long dwell, pinched or not.
        if (hovered.kind !== "clear") {
          step.changed = this.apply(hovered);
          step.picked = hovered;
        }
        this.role = "select";
      } else if (overMenu) {
        this.role = "select";
      } else {
        this.role = "paint";
        this.heldBack.length = 0;
        step.grew = this.backdate(pointer);
      }
    } else if (pointer.closed && this.role === "paint" && pointer.position !== null) {
      const stroke = this.painting.current;
      if (stroke !== null) {
        if (pointer.touching) {
          // Together again, or still. Whatever was held back is laid first, in
          // order, so a glitch the gate rode out leaves the line whole.
          let grew = false;
          for (const point of this.heldBack) grew = this.painting.extend(point) || grew;
          this.heldBack.length = 0;
          if (this.painting.extend(pointer.position) || grew) step.grew = stroke;
        } else {
          this.heldBack.push(pointer.position);
        }
      }
    }

    if (pointer.justOpened) {
      step.ended = this.endStroke();
      this.role = null;
    }
    return step;
  }

  /** A chip was chosen, by dwell or by pinch. Returns whether anything changed. */
  apply(chip: ChipSpec): boolean {
    switch (chip.kind) {
      case "color": {
        const changed = this.color !== chip.index || this.erasing;
        this.color = chip.index;
        // Picking a colour is picking to paint again.
        this.erasing = false;
        return changed;
      }
      case "size": {
        const changed = this.size !== chip.index;
        this.size = chip.index;
        return changed;
      }
      case "erase":
        this.erasing = !this.erasing;
        return true;
      case "clear":
        this.clear();
        return true;
    }
  }

  clear(): void {
    this.painting.clear();
    this.heldBack.length = 0;
    this.erasing = false;
    this.role = null;
  }

  /** Leaving the mode: whatever the hand was doing, it is not doing it here. */
  reset(): Stroke | null {
    const ended = this.endStroke();
    this.pointer.reset();
    this.role = null;
    this.last = null;
    this.recent.length = 0;
    return ended;
  }

  brush(): BrushCursor | null {
    const pointer = this.last;
    if (pointer === null || pointer.position === null) return null;
    const tool = this.tool;
    return {
      position: pointer.position,
      width: tool.width,
      color: tool.color,
      erasing: tool.kind === "erase",
      pressed: pointer.closed && pointer.touching,
      grip: pointer.grip,
      thumb: pointer.thumb,
      index: pointer.index,
    };
  }

  status(): PaintStatus {
    return {
      pinch: this.last?.ratio ?? null,
      pinchMetres: this.last?.metres ?? null,
      pinched: this.last?.closed ?? false,
      touching: this.last?.touching ?? false,
      handSize: this.last?.handSize ?? null,
      painting: this.busy,
      tool: this.tool,
      strokes: this.painting.count,
      points: this.painting.points,
    };
  }

  /**
   * Ends the open line where it stands. The points held back while the
   * fingers were apart were never in it, so there is nothing to take back.
   */
  private endStroke(): Stroke | null {
    const stroke = this.painting.current;
    this.heldBack.length = 0;
    if (stroke === null) return null;
    this.painting.end();
    return stroke;
  }

  /**
   * Begins the line where the fingers met rather than where the hand had got to
   * while the gate made up its mind, replaying every point in between.
   *
   * A level-crossing gate cannot help being late, so rather than guess earlier
   * the line is corrected afterwards. The window is capped at
   * `startBackdateMs` so a hand that hovers near the mark for a long time
   * before squeezing cannot drag all of that travel into its line. ADR 0020.
   */
  private backdate(pointer: BrushPointer): Stroke {
    const from = Math.max(
      pointer.contactSince ?? pointer.t,
      pointer.t - CONFIG.paint.startBackdateMs,
    );
    const history = this.recent.filter((sample) => sample.t >= from && sample.t < pointer.t);
    const head = history[0];
    if (head === undefined) {
      return this.painting.begin(this.tool, pointer.position ?? { x: 0, y: 0 });
    }

    const stroke = this.painting.begin(this.tool, head.position);
    for (const sample of history.slice(1)) this.painting.extend(sample.position);
    if (pointer.position !== null) this.painting.extend(pointer.position);
    return stroke;
  }
}

/** "brush #97eeda 0.018" or "erase 0.036": the whole tool in one word a digest can list. */
export function describeTool(tool: Tool): string {
  return tool.kind === "erase"
    ? `erase ${tool.width.toFixed(3)}`
    : `brush ${tool.color} ${tool.width.toFixed(3)}`;
}
