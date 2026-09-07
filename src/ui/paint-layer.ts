import {
  type Segment,
  type Stroke,
  segmentAt,
  segmentsOf,
  tailOf,
} from "../interaction/painting.js";
import type { Vec2 } from "../perception/types.js";
import { fitCanvas } from "./mirror.js";

/**
 * The canvas the painting is on. A renderer: it holds no state of its own
 * beyond which point of the open stroke it has already drawn.
 *
 * Strokes are drawn as they grow, one curve per new point, rather than by
 * redrawing everything every frame: this runs beside two detectors on the same
 * machine, and a long session's worth of strokes redrawn sixty times a second
 * is a cost with nothing to show for it. A full redraw happens only when the
 * window is resized, or the painting is cleared, or a stroke is erased.
 *
 * The context may be null. happy-dom has no 2D canvas, and the model behind
 * this has to be testable there; with no context the layer simply draws nothing.
 */
export class PaintLayer {
  private readonly ctx: CanvasRenderingContext2D | null;
  private following: Stroke | null = null;
  private drawn = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d");
  }

  get element(): HTMLCanvasElement {
    return this.canvas;
  }

  /**
   * The painting is only on the glass in Paint mode; it is kept in memory
   * otherwise. The canvas is sized here and not in the constructor: it is born
   * hidden, and a hidden element measures 0 by 0, so a canvas fitted then has
   * no pixels and every stroke drawn on it goes nowhere. That is how the first
   * afternoon's painting was invisible. See friction 0023.
   */
  setVisible(visible: boolean): void {
    this.canvas.hidden = !visible;
    if (visible) fitCanvas(this.canvas);
  }

  /** The canvas's pixel size. Zero by zero is the bug this class once had. */
  get size(): { width: number; height: number } {
    return { width: this.canvas.width, height: this.canvas.height };
  }

  /** The window changed size: the pixels are gone and everything is drawn again. */
  fit(strokes: readonly Stroke[]): void {
    fitCanvas(this.canvas);
    this.redraw(strokes);
  }

  /** Draws whatever `stroke` has gained since the last call. */
  follow(stroke: Stroke): void {
    if (this.following !== stroke) {
      this.following = stroke;
      this.drawn = 1;
    }
    const ctx = this.ctx;
    if (ctx === null) return;
    this.prepare(ctx, stroke);
    for (let n = Math.max(1, this.drawn); n < stroke.points.length; n++) {
      const segment = segmentAt(stroke.points, n);
      if (segment !== null) this.curve(ctx, segment);
    }
    this.drawn = stroke.points.length;
  }

  /** The fingers parted: reach the last point, or leave a dot for a pinch that never moved. */
  finish(stroke: Stroke): void {
    this.follow(stroke);
    this.following = null;
    this.drawn = 0;
    const ctx = this.ctx;
    if (ctx === null) return;
    this.prepare(ctx, stroke);
    const first = stroke.points[0];
    if (stroke.points.length === 1 && first !== undefined) {
      this.dot(ctx, first, stroke);
      return;
    }
    const tail = tailOf(stroke.points);
    if (tail === null) return;
    ctx.beginPath();
    ctx.moveTo(...this.px(tail.from));
    ctx.lineTo(...this.px(tail.to));
    ctx.stroke();
  }

  redraw(strokes: readonly Stroke[]): void {
    const ctx = this.ctx;
    if (ctx === null) return;
    ctx.globalCompositeOperation = "source-over";
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    for (const stroke of strokes) {
      this.prepare(ctx, stroke);
      const first = stroke.points[0];
      if (stroke.points.length === 1 && first !== undefined) {
        this.dot(ctx, first, stroke);
        continue;
      }
      for (const segment of segmentsOf(stroke.points)) this.curve(ctx, segment);
      const tail = tailOf(stroke.points);
      if (tail !== null) {
        ctx.beginPath();
        ctx.moveTo(...this.px(tail.from));
        ctx.lineTo(...this.px(tail.to));
        ctx.stroke();
      }
    }
    // The open stroke, if there is one, has been drawn in full.
    if (this.following !== null) this.drawn = this.following.points.length;
  }

  clear(): void {
    this.following = null;
    this.drawn = 0;
    const ctx = this.ctx;
    if (ctx === null) return;
    ctx.globalCompositeOperation = "source-over";
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  /**
   * The eraser is a stroke that removes alpha rather than adding colour, so it
   * cuts a hole down to the mirror instead of painting the mirror's colour over
   * a picture that keeps moving.
   */
  private prepare(ctx: CanvasRenderingContext2D, stroke: Stroke): void {
    const erasing = stroke.tool.kind === "erase";
    ctx.globalCompositeOperation = erasing ? "destination-out" : "source-over";
    ctx.strokeStyle = erasing ? "#000" : stroke.tool.color;
    ctx.fillStyle = ctx.strokeStyle;
    ctx.lineWidth = stroke.tool.width * this.canvas.height;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  }

  private curve(ctx: CanvasRenderingContext2D, segment: Segment): void {
    ctx.beginPath();
    ctx.moveTo(...this.px(segment.from));
    ctx.quadraticCurveTo(...this.px(segment.control), ...this.px(segment.to));
    ctx.stroke();
  }

  private dot(ctx: CanvasRenderingContext2D, point: Vec2, stroke: Stroke): void {
    const [x, y] = this.px(point);
    ctx.beginPath();
    ctx.arc(x, y, (stroke.tool.width * this.canvas.height) / 2, 0, Math.PI * 2);
    ctx.fill();
  }

  private px(point: Vec2): [number, number] {
    return [point.x * this.canvas.width, point.y * this.canvas.height];
  }
}
