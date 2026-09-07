import { CONFIG } from "../config.js";
import type { CursorState } from "../interaction/cursor.js";
import { GestureHold } from "../interaction/gesture-hold.js";
import { type MenuMotion, MenuPhysics, type PanelLayout } from "../interaction/menu-physics.js";
import type { BrushCursor, PaintStatus } from "../interaction/paint-session.js";
import { requireElement } from "../lib/assert.js";
import type { GestureName, PerceptionFrame, Rect } from "../perception/types.js";
import { ensureLens } from "./glass.js";
import { ICON } from "./icons.js";
import { PaintMode, type PaintScene } from "./paint-mode.js";

type ExperienceMode = "home" | "picture" | "paint";
type PicturePhase = "idle" | "countdown" | "saving" | "saved" | "error";

/**
 * Where the interface is on one frame, for whoever is recording it.
 *
 * It lives here rather than in src/debug/ because it is this file's state being
 * described, and nothing outside src/debug/ may depend on src/debug/. The
 * rectangles are the live ones the hit test uses, travel included: a trace that
 * said where the finger was and not where the tile had been shoved cannot
 * answer "I pointed at it and nothing happened". See src/debug/trace.ts.
 */
export interface SceneSample {
  mode: string;
  phase: string;
  menu: {
    hovered: string | null;
    panels: Array<{ id: string; rect: Rect; glow: number }>;
  };
  /** Null outside Paint mode. */
  paint: PaintScene | null;
}

const NOWHERE: Rect = { x: 0, y: 0, width: 0, height: 0 };

interface ModeSpec {
  readonly id: string;
  /** Never rendered. The interface has no words in it; this is for a11y only. */
  readonly label: string;
  readonly icon: keyof typeof ICON;
  /** The gesture shortcut this mode teaches, drawn as a badge on the tile. */
  readonly gesture: keyof typeof ICON | null;
  readonly selectable: boolean;
}

/**
 * The whole menu. Adding a mode is adding a line here.
 *
 * There is deliberately no text: a visitor in a hallway reads an icon from
 * three metres and a caption from one. The gesture badge does the teaching that
 * a caption used to - "hold this shape at me" - which is a thing an icon can
 * actually say. See docs/adr/0010-reactive-glass-menu.md.
 */
const MODES: readonly ModeSpec[] = [
  { id: "picture", label: "Picture", icon: "camera", gesture: "handPeace", selectable: true },
  // No gesture badge: the recognizer has no pinch, and the brush cursor teaches
  // it better than a badge could, by showing the fingertips close on the ring.
  { id: "paint", label: "Paint", icon: "paintBrush", gesture: null, selectable: true },
];

interface Tile {
  readonly spec: ModeSpec;
  readonly element: HTMLButtonElement;
  readonly ring: HTMLElement;
  /** The gesture badge, and the ring around it that fills as the hold does. */
  readonly hint: { readonly element: HTMLElement; readonly ring: HTMLElement } | null;
}

/** Owns the visitor-facing menu and the gesture-driven picture flow. */
export class ExperienceUi {
  private readonly dock: HTMLElement;
  private readonly tiles: Tile[];
  private readonly pictureTile: Tile;
  private readonly paintTile: Tile;
  private readonly paint: PaintMode;
  private readonly countdown: HTMLElement;
  private readonly countdownDial: HTMLElement;
  private readonly countdownRing: HTMLElement;
  private readonly countdownNumber: HTMLElement;
  private readonly status: HTMLElement;
  private readonly statusIcon: HTMLElement;
  private readonly statusText: HTMLElement;
  private readonly flash: HTMLElement;

  private readonly physics = new MenuPhysics();
  private readonly victoryHold = new GestureHold(CONFIG.interaction.gestureHoldMs);
  private readonly palmHold = new GestureHold(CONFIG.interaction.gestureHoldMs);

  private mode: ExperienceMode = "home";
  private phase: PicturePhase = "idle";
  /** The last frame of physics, kept only so the recorder can read it back. */
  private lastMotion: MenuMotion | null = null;
  private countdownEndsAt: number | null = null;
  private resetMessageAt: number | null = null;

  constructor(
    root: ParentNode,
    private readonly capture: () => Promise<string>,
  ) {
    this.dock = requireElement(root, "#dock", HTMLElement);
    this.countdown = requireElement(root, "#countdown", HTMLElement);
    this.countdownDial = requireElement(root, "#countdown-dial", HTMLElement);
    this.countdownRing = requireElement(root, "#countdown-ring", HTMLElement);
    this.countdownNumber = requireElement(root, "#countdown-number", HTMLElement);
    this.status = requireElement(root, "#capture-status", HTMLElement);
    this.statusIcon = requireElement(root, "#capture-status-icon", HTMLElement);
    this.statusText = requireElement(root, "#capture-status-text", HTMLElement);
    this.flash = requireElement(root, "#capture-flash", HTMLElement);

    this.tiles = MODES.map((spec) => this.buildTile(spec));
    const picture = this.tiles.find((tile) => tile.spec.id === "picture");
    if (picture === undefined) throw new Error("MODES must contain the picture mode");
    this.pictureTile = picture;
    const paint = this.tiles.find((tile) => tile.spec.id === "paint");
    if (paint === undefined) throw new Error("MODES must contain the paint mode");
    this.paintTile = paint;
    this.paint = new PaintMode(root, requireElement(root, "#paint", HTMLCanvasElement));

    this.setPhase("idle");
    window.addEventListener("resize", () => this.measure());
    // Fonts and inlined SVG can settle a frame after construction, and a dock
    // measured mid-layout puts every hit target a few pixels off for good.
    new ResizeObserver(() => this.measure()).observe(this.dock);
    this.measure();
    this.presentMode();
  }

  /** Updates the menu physics and gesture holds, returning the cursor's dwell. */
  update(frame: PerceptionFrame, cursor: CursorState): CursorState {
    const victory = this.victoryHold.update(
      this.mode === "home" && hasGesture(frame, "Victory"),
      frame.t,
    );
    if (victory.activated) this.enterPicture();

    const palm = this.palmHold.update(
      this.mode === "picture" && hasGesture(frame, "Open_Palm"),
      frame.t,
    );
    if (palm.activated && this.phase === "idle") this.startCountdown(frame.t);

    const aspect = window.innerWidth / window.innerHeight;
    // In Paint mode the pointer is the pinch point, for the menu as well: one
    // hand, one place it points. A stroke in progress may pick nothing.
    const pointer = this.mode === "paint" ? this.paint.point(frame, aspect) : null;
    const menuCursor = pointer === null ? cursor : { ...cursor, position: pointer.position };
    const motion = this.physics.update(frame, menuCursor, aspect, !this.paint.busy);
    this.lastMotion = motion;
    this.render(motion, this.mode === "home" ? victory.progress : palm.progress);
    if (motion.activated !== null) this.select(motion.activated);

    let dwell = motion.dwell;
    // The mode may have just been left through the menu; then the hand is done here.
    if (pointer !== null && this.mode === "paint") {
      dwell = Math.max(dwell, this.paint.update(frame, pointer, aspect, motion.hovered !== null));
    }

    this.advancePicture(frame.t);
    return { ...menuCursor, dwellProgress: dwell, activated: motion.activated !== null };
  }

  /**
   * The page was laid out differently without being resized - a camera-mode
   * change moves the debug instruments, and a rule keyed on the mode can move
   * anything. Hit rectangles are cached from a measurement, so they have to be
   * taken again or every target sits where its control used to be.
   * See friction 0026.
   */
  relayout(): void {
    this.measure();
    this.paint.relayout();
  }

  /** What the overlay should draw instead of the cursor. Null outside Paint mode. */
  brush(): BrushCursor | null {
    return this.mode === "paint" ? this.paint.brush() : null;
  }

  /** True while the glass is a canvas. The frame loop drops the face pass then. */
  get painting(): boolean {
    return this.mode === "paint";
  }

  /** Paint mode in numbers, for the HUD and the snapshot. Null outside it. */
  paintStatus(): PaintStatus | null {
    return this.mode === "paint" ? this.paint.status() : null;
  }

  /** Where the interface is right now. Read by the debug recorder's trace. */
  scene(): SceneSample {
    const motion = this.lastMotion;
    const hovered = motion?.hovered ?? null;
    return {
      mode: this.mode,
      phase: this.phase,
      menu: {
        hovered: hovered === null ? null : (this.tiles[hovered]?.spec.id ?? null),
        panels: this.tiles.map((tile, index) => ({
          id: tile.spec.id,
          rect: motion?.panels[index]?.rect ?? NOWHERE,
          glow: motion?.panels[index]?.glow ?? 0,
        })),
      },
      paint: this.mode === "paint" ? this.paint.scene() : null,
    };
  }

  enterPicture(): void {
    if (this.mode === "picture") return;
    this.mode = "picture";
    this.presentMode();
  }

  enterPaint(): void {
    if (this.mode === "paint") return;
    this.mode = "paint";
    this.presentMode();
  }

  /** Operator-only keyboard path: wipe the painting without a hand. */
  clearPainting(): void {
    this.paint.clear();
  }

  /** Operator-only keyboard path used to exercise the complete UI without a gesture. */
  requestCapture(now: number): void {
    if (this.mode === "picture" && this.phase === "idle") this.startCountdown(now);
  }

  private buildTile(spec: ModeSpec): Tile {
    const element = document.createElement("button");
    element.type = "button";
    element.className = "tile glass";
    element.dataset.mode = spec.id;
    element.setAttribute("aria-label", spec.label);
    if (spec.selectable) {
      element.setAttribute("aria-pressed", "false");
      element.addEventListener("click", () => this.selectMode(spec.id));
    } else {
      element.classList.add("tile--locked");
      element.disabled = true;
    }

    const ring = document.createElement("span");
    ring.className = "ring tile__ring";
    ring.setAttribute("aria-hidden", "true");

    const icon = document.createElement("span");
    icon.className = "tile__icon";
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML = ICON[spec.icon];

    element.append(ring, icon);

    let hint: HTMLElement | null = null;
    if (spec.gesture !== null) {
      hint = document.createElement("span");
      hint.className = "tile__hint";
      hint.setAttribute("aria-hidden", "true");
      hint.innerHTML = ICON[spec.gesture];
      const hintRing = document.createElement("span");
      hintRing.className = "ring";
      hint.prepend(hintRing);
      element.append(hint);
    }

    this.dock.append(element);
    return {
      spec,
      element,
      ring,
      hint: hint === null ? null : { element: hint, ring: hintRingOf(hint) },
    };
  }

  private select(index: number): void {
    const id = this.tiles[index]?.spec.id;
    if (id !== undefined) this.selectMode(id);
  }

  private selectMode(id: string): void {
    if (id === "picture") this.enterPicture();
    else if (id === "paint") this.enterPaint();
  }

  /**
   * Writes one frame of physics onto the DOM.
   *
   * The transform is set directly rather than assembled from custom properties,
   * because setting one on a tile invalidates the style of everything inside it
   * and this runs once per camera frame. The sheen and progress values have to
   * be custom properties - they are read from inside a gradient - so they are
   * set on the smallest element that needs them.
   */
  private render(motion: ReturnType<MenuPhysics["update"]>, hold: number): void {
    const height = window.innerHeight;
    this.dock.style.transform = translate(motion.dock, height);

    for (const [index, tile] of this.tiles.entries()) {
      const panel = motion.panels[index];
      if (panel === undefined) continue;
      const lean = CONFIG.ui.menu.tiltDeg;
      tile.element.style.transform =
        `${translate(panel.offset, height)} ` +
        `rotateX(${(-panel.lean.y * lean).toFixed(2)}deg) ` +
        `rotateY(${(panel.lean.x * lean).toFixed(2)}deg)`;
      tile.element.style.setProperty("--sheen-x", `${(panel.reveal.x * 100).toFixed(1)}%`);
      tile.element.style.setProperty("--sheen-y", `${(panel.reveal.y * 100).toFixed(1)}%`);
      tile.element.style.setProperty("--glow", panel.glow.toFixed(3));
      tile.ring.style.setProperty(
        "--progress",
        motion.hovered === index ? motion.dwell.toFixed(3) : "0",
      );
      tile.element.classList.toggle("tile--hovered", motion.hovered === index);
      tile.hint?.ring.style.setProperty("--progress", hold.toFixed(3));
    }
  }

  private startCountdown(now: number): void {
    this.setPhase("countdown");
    this.countdownEndsAt = now + CONFIG.picture.countdownMs;
    this.resetMessageAt = null;
    this.status.classList.remove("status--visible", "status--error");
    this.countdown.classList.add("countdown--visible");
    this.countdown.setAttribute("aria-hidden", "false");
    this.countdownRing.style.setProperty("--progress", "0");
    this.countdownNumber.textContent = String(Math.ceil(CONFIG.picture.countdownMs / 1000));
  }

  private advancePicture(now: number): void {
    if (this.phase === "countdown" && this.countdownEndsAt !== null) {
      const remaining = this.countdownEndsAt - now;
      if (remaining > 0) {
        this.countdownNumber.textContent = String(Math.ceil(remaining / 1000));
        const progress = 1 - remaining / CONFIG.picture.countdownMs;
        this.countdownRing.style.setProperty("--progress", progress.toFixed(3));
      } else {
        this.countdownEndsAt = null;
        this.setPhase("saving");
        this.countdown.classList.remove("countdown--visible");
        this.countdown.setAttribute("aria-hidden", "true");
        this.flash.classList.remove("capture-flash--active");
        requestAnimationFrame(() => this.flash.classList.add("capture-flash--active"));
        void this.saveCapture();
      }
    }

    if (this.resetMessageAt !== null && now >= this.resetMessageAt) {
      this.resetMessageAt = null;
      this.setPhase("idle");
      this.status.classList.remove("status--visible", "status--error");
      this.status.setAttribute("aria-hidden", "true");
    }
  }

  private async saveCapture(): Promise<void> {
    try {
      const filename = await this.capture();
      // The visitor gets a tick; the filename is for whoever is at the keyboard.
      console.info(`[HomeWebcam] saved ${filename}`);
      this.setPhase("saved");
      this.showStatus("checkCircle", "Picture saved", false);
    } catch (error) {
      console.error("[HomeWebcam] picture capture failed", error);
      this.setPhase("error");
      this.showStatus("warning", "Picture could not be saved", true);
    }
    this.resetMessageAt = performance.now() + CONFIG.picture.savedMessageMs;
  }

  private showStatus(icon: keyof typeof ICON, message: string, isError: boolean): void {
    this.statusIcon.innerHTML = ICON[icon];
    this.statusText.textContent = message;
    this.status.setAttribute("aria-hidden", "false");
    this.status.classList.toggle("status--error", isError);
    this.status.classList.add("status--visible");
  }

  /**
   * The phase is mirrored onto the body so it can be waited on from outside -
   * `npm run screenshot -- --after` and the station CLI both read it, and a
   * capture that guesses at timing captures the wrong moment. See friction 0006.
   */
  private setPhase(phase: PicturePhase): void {
    this.phase = phase;
    document.body.dataset.picturePhase = phase;
  }

  private presentMode(): void {
    document.body.dataset.experienceMode = this.mode;
    const inPicture = this.mode === "picture";
    const inPaint = this.mode === "paint";
    this.pictureTile.element.classList.toggle("tile--selected", inPicture);
    this.pictureTile.element.setAttribute("aria-pressed", String(inPicture));
    this.paintTile.element.classList.toggle("tile--selected", inPaint);
    this.paintTile.element.setAttribute("aria-pressed", String(inPaint));
    this.paint.setActive(inPaint);
    // In picture mode the badge stops advertising the way in and starts showing
    // the shape that fires the shutter.
    const hint = this.pictureTile.hint;
    if (hint !== null) {
      hint.element.innerHTML = inPicture ? ICON.handPalm : ICON.handPeace;
      hint.element.prepend(hint.ring);
    }
  }

  /**
   * Re-reads where the panels sit with every transform suppressed, because the
   * physics needs their rest position and getBoundingClientRect reports where
   * the springs have currently thrown them.
   */
  private measure(): void {
    this.dock.style.transform = "";
    for (const tile of this.tiles) tile.element.style.transform = "";

    const dockBox = this.dock.getBoundingClientRect();
    const panels: PanelLayout[] = this.tiles.map((tile) => {
      const box = tile.element.getBoundingClientRect();
      if (CONFIG.ui.glass.refraction && box.width > 0) {
        tile.element.style.setProperty("--lens", lensFor(tile.element, box));
      }
      return {
        center: centerOf(box),
        rect: {
          x: box.left / window.innerWidth,
          y: box.top / window.innerHeight,
          width: box.width / window.innerWidth,
          height: box.height / window.innerHeight,
        },
        selectable: tile.spec.selectable,
      };
    });
    // The countdown and the status chip are the same material as the tiles, so
    // they get the same rim refraction; their sizes are fixed, so the lens for
    // each is built once and cached.
    for (const element of [this.countdownDial, this.status]) {
      const box = element.getBoundingClientRect();
      if (CONFIG.ui.glass.refraction && box.width > 0) {
        element.style.setProperty("--lens", lensFor(element, box));
      }
    }
    this.physics.setLayout(centerOf(dockBox), panels);
  }
}

function hintRingOf(hint: HTMLElement): HTMLElement {
  const ring = hint.querySelector(".ring");
  if (!(ring instanceof HTMLElement)) throw new Error("gesture badge lost its ring");
  return ring;
}

function lensFor(element: HTMLElement, box: DOMRect): string {
  // The radius lives in the stylesheet, so read it back rather than duplicating
  // it here: a lens built for the wrong corner leaves a visible seam.
  const radius = Number.parseFloat(getComputedStyle(element).borderTopLeftRadius) || 0;
  return ensureLens({
    width: Math.round(box.width),
    height: Math.round(box.height),
    radius,
    band: CONFIG.ui.glass.band,
    strength: CONFIG.ui.glass.strength,
    aberration: CONFIG.ui.glass.aberration,
  });
}

/** Screen-unit centre: y over the viewport height, x over it too, so it is round. */
function centerOf(box: DOMRect): { x: number; y: number } {
  return {
    x: (box.left + box.width / 2) / window.innerHeight,
    y: (box.top + box.height / 2) / window.innerHeight,
  };
}

function translate(offset: { x: number; y: number }, height: number): string {
  return `translate3d(${(offset.x * height).toFixed(2)}px, ${(offset.y * height).toFixed(2)}px, 0)`;
}

function hasGesture(frame: PerceptionFrame, gesture: GestureName): boolean {
  return frame.hands.some(
    (hand) =>
      hand.gesture === gesture && hand.gestureConfidence >= CONFIG.interaction.minGestureConfidence,
  );
}
