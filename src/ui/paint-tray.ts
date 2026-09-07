import { CONFIG } from "../config.js";
import type { CursorState } from "../interaction/cursor.js";
import { type MenuMotion, MenuPhysics, type PanelLayout } from "../interaction/menu-physics.js";
import { type ChipSpec, chipSpecs } from "../interaction/paint-session.js";
import type { Tool } from "../interaction/painting.js";
import { requireElement } from "../lib/assert.js";
import type { PerceptionFrame, Rect, Vec2 } from "../perception/types.js";
import { ICON } from "./icons.js";

/**
 * The paint tools, as a column of glass chips down the side of the mirror.
 *
 * Six colours, three widths, the eraser and the bin. It is the mode menu again
 * at a third of the size: the same material, the same reveal light, the same
 * springs (shorter travel, because the chips sit closer together), and the same
 * dwell to pick one. The one difference a visitor meets is the bin, which asks
 * for a longer hold because it cannot be undone. See ADR 0017.
 *
 * Down the side rather than along the bottom: a hand hanging at rest is in the
 * bottom of the frame, and a dwell target where hands rest is a target that
 * fires by itself.
 */

interface Chip {
  readonly spec: ChipSpec;
  readonly element: HTMLButtonElement;
  readonly ring: HTMLElement;
}

export interface TrayMotion {
  motion: MenuMotion;
  hovered: ChipSpec | null;
  activated: ChipSpec | null;
}

/**
 * Half the gap between chips, in px, added to every hit rectangle so the column
 * is one continuous target: a pointer between two chips is over the nearer one
 * rather than over nothing, and a dwell does not restart at every seam.
 */
const HIT_PAD_PX = 6;

const NOWHERE: Rect = { x: 0, y: 0, width: 0, height: 0 };

export class PaintTray {
  private readonly anchor: HTMLElement;
  private readonly tray: HTMLElement;
  private readonly chips: Chip[];
  private readonly physics = new MenuPhysics(CONFIG.paint.tray);
  private lastMotion: MenuMotion | null = null;

  constructor(root: ParentNode) {
    this.anchor = requireElement(root, "#paint-tray-anchor", HTMLElement);
    this.tray = requireElement(root, "#paint-tray", HTMLElement);
    this.chips = this.build();
    new ResizeObserver(() => this.measure()).observe(this.tray);
    window.addEventListener("resize", () => this.measure());
  }

  /** One chip per tool, as the trace reports them. */
  get specs(): readonly ChipSpec[] {
    return this.chips.map((chip) => chip.spec);
  }

  setVisible(visible: boolean): void {
    this.anchor.hidden = !visible;
    this.anchor.setAttribute("aria-hidden", String(!visible));
    // A hidden element measures as nothing, so the layout is taken again the
    // moment there is something to measure.
    if (visible) this.measure();
  }

  /**
   * Something outside this file moved the tray without resizing it.
   *
   * The ResizeObserver and the resize listener are both blind to that: a
   * change of `right` moves every chip and changes no width, so nothing fires
   * and the cached rest rectangles stay where the chips used to be. That
   * shipped once - the debug view slid the tray 200 px inboard and every tool
   * kept its old target. See friction 0026.
   */
  remeasure(): void {
    this.measure();
  }

  update(
    frame: PerceptionFrame,
    cursor: CursorState,
    aspect: number,
    canSelect: boolean,
  ): TrayMotion {
    const motion = this.physics.update(frame, cursor, aspect, canSelect);
    this.lastMotion = motion;
    this.render(motion);
    return {
      motion,
      hovered: motion.hovered === null ? null : (this.chips[motion.hovered]?.spec ?? null),
      activated: motion.activated === null ? null : (this.chips[motion.activated]?.spec ?? null),
    };
  }

  /**
   * A pinch picked the hovered chip, so the dwell on it must not pick it again
   * a moment later: for the eraser that would be a toggle undoing itself.
   */
  consumeDwell(): void {
    this.physics.consume();
  }

  /** Shows which colour, width and mode are current. */
  present(tool: Tool, colorIndex: number, sizeIndex: number): void {
    for (const chip of this.chips) {
      const spec = chip.spec;
      const selected =
        (spec.kind === "color" && spec.index === colorIndex) ||
        (spec.kind === "size" && spec.index === sizeIndex) ||
        (spec.kind === "erase" && tool.kind === "erase");
      chip.element.classList.toggle("chip--selected", selected);
      chip.element.setAttribute("aria-pressed", String(selected));
    }
  }

  /** Where the chips are right now, for the trace. Same shape as the menu's. */
  scene(): { hovered: string | null; panels: Array<{ id: string; rect: Rect; glow: number }> } {
    const motion = this.lastMotion;
    return {
      hovered: motion?.hovered == null ? null : (this.chips[motion.hovered]?.spec.id ?? null),
      panels: this.chips.map((chip, index) => ({
        id: chip.spec.id,
        rect: motion?.panels[index]?.rect ?? NOWHERE,
        glow: motion?.panels[index]?.glow ?? 0,
      })),
    };
  }

  private build(): Chip[] {
    const widest = Math.max(...CONFIG.paint.sizes);

    const sizes = group("tray__group tray__group--sizes");
    const tools = group("tray__group tray__group--tools");
    const colors = group("tray__group tray__group--colors");
    const column = document.createElement("div");
    column.className = "tray__column";
    column.append(sizes, tools);
    this.tray.replaceChildren(column, colors);

    return chipSpecs().map((spec) => this.buildChip(spec, { sizes, tools, colors }, widest));
  }

  private buildChip(
    spec: ChipSpec,
    groups: { sizes: HTMLElement; tools: HTMLElement; colors: HTMLElement },
    widest: number,
  ): Chip {
    const paint = CONFIG.paint;
    switch (spec.kind) {
      case "size": {
        const chip = this.chip(spec, `Brush width ${spec.index + 1} of ${paint.sizes.length}`);
        const dot = document.createElement("span");
        dot.className = "chip__dot";
        // The dots show the widths relative to each other, not at true size:
        // the widest line is nearly the width of the chip.
        dot.style.setProperty("--dot", `${Math.round(6 + 26 * (spec.width / widest))}px`);
        chip.element.append(dot);
        groups.sizes.append(chip.element);
        return chip;
      }
      case "erase": {
        const chip = this.chip(spec, "Eraser");
        chip.element.append(icon("eraser"));
        groups.tools.append(chip.element);
        return chip;
      }
      case "clear": {
        const chip = this.chip(spec, "Clear the painting");
        chip.element.append(icon("trash"));
        chip.element.classList.add("chip--clear");
        groups.tools.append(chip.element);
        return chip;
      }
      case "color": {
        const chip = this.chip(spec, `Colour ${spec.index + 1} of ${paint.colors.length}`);
        const swatch = document.createElement("span");
        swatch.className = "chip__swatch";
        swatch.style.setProperty("--swatch", spec.color);
        chip.element.append(swatch);
        groups.colors.append(chip.element);
        return chip;
      }
    }
  }

  private chip(spec: ChipSpec, label: string): Chip {
    const element = document.createElement("button");
    element.type = "button";
    element.className = "chip glass";
    element.dataset.chip = spec.id;
    element.setAttribute("aria-label", label);
    element.setAttribute("aria-pressed", "false");
    const ring = document.createElement("span");
    ring.className = "ring chip__ring";
    ring.setAttribute("aria-hidden", "true");
    element.append(ring);
    return { spec, element, ring };
  }

  private render(motion: MenuMotion): void {
    const height = window.innerHeight;
    this.tray.style.transform = translate(motion.dock, height);
    for (const [index, chip] of this.chips.entries()) {
      const panel = motion.panels[index];
      if (panel === undefined) continue;
      const lean = CONFIG.ui.menu.tiltDeg;
      chip.element.style.transform =
        `${translate(panel.offset, height)} ` +
        `rotateX(${(-panel.lean.y * lean).toFixed(2)}deg) ` +
        `rotateY(${(panel.lean.x * lean).toFixed(2)}deg)`;
      chip.element.style.setProperty("--sheen-x", `${(panel.reveal.x * 100).toFixed(1)}%`);
      chip.element.style.setProperty("--sheen-y", `${(panel.reveal.y * 100).toFixed(1)}%`);
      chip.element.style.setProperty("--glow", panel.glow.toFixed(3));
      chip.ring.style.setProperty(
        "--progress",
        motion.hovered === index ? motion.dwell.toFixed(3) : "0",
      );
      chip.element.classList.toggle("chip--hovered", motion.hovered === index);
    }
  }

  private measure(): void {
    if (this.anchor.hidden) return;
    this.tray.style.transform = "";
    for (const chip of this.chips) chip.element.style.transform = "";

    const width = window.innerWidth;
    const height = window.innerHeight;
    const trayBox = this.tray.getBoundingClientRect();
    const panels: PanelLayout[] = this.chips.map((chip) => {
      const box = chip.element.getBoundingClientRect();
      const layout: PanelLayout = {
        center: centerOf(box),
        rect: {
          x: (box.left - HIT_PAD_PX) / width,
          y: (box.top - HIT_PAD_PX) / height,
          width: (box.width + 2 * HIT_PAD_PX) / width,
          height: (box.height + 2 * HIT_PAD_PX) / height,
        },
        selectable: true,
      };
      // exactOptionalPropertyTypes: the field is either a number or absent.
      return chip.spec.kind === "clear"
        ? { ...layout, dwellMs: CONFIG.paint.clearDwellMs }
        : layout;
    });
    this.physics.setLayout(centerOf(trayBox), panels);
  }
}

function group(className: string): HTMLElement {
  const element = document.createElement("div");
  element.className = className;
  return element;
}

function icon(name: keyof typeof ICON): HTMLElement {
  const element = document.createElement("span");
  element.className = "chip__icon";
  element.setAttribute("aria-hidden", "true");
  element.innerHTML = ICON[name];
  return element;
}

function centerOf(box: DOMRect): Vec2 {
  return {
    x: (box.left + box.width / 2) / window.innerHeight,
    y: (box.top + box.height / 2) / window.innerHeight,
  };
}

function translate(offset: Vec2, height: number): string {
  return `translate3d(${(offset.x * height).toFixed(2)}px, ${(offset.y * height).toFixed(2)}px, 0)`;
}
