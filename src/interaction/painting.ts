import type { Vec2 } from "../perception/types.js";

/**
 * What has been painted, as data.
 *
 * Points are normalized mirrored screen space, so a painting survives a window
 * resize and a trace can line a stroke up with the hand that drew it. The
 * canvas that shows it is a renderer (src/ui/paint-layer.ts); this is the
 * state it renders, and it is testable without one.
 */

export interface Tool {
  kind: "brush" | "erase";
  /** CSS colour. Ignored by the eraser, kept so switching back restores it. */
  color: string;
  /** Line width in screen heights. */
  width: number;
}

export interface Stroke {
  tool: Tool;
  points: Vec2[];
}

export class Painting {
  private readonly strokes: Stroke[] = [];
  private active: Stroke | null = null;

  /**
   * @param minSegment Distance in screen heights below which a new sample is
   *   the same point. Landmark jitter at a standstill is a few pixels; without
   *   this it is drawn as a small, dense scribble.
   */
  constructor(private readonly minSegment: number) {}

  get all(): readonly Stroke[] {
    return this.strokes;
  }

  get current(): Stroke | null {
    return this.active;
  }

  get count(): number {
    return this.strokes.length;
  }

  get points(): number {
    return this.strokes.reduce((sum, stroke) => sum + stroke.points.length, 0);
  }

  /** Starts a stroke. Ends any that was still open, which should not happen. */
  begin(tool: Tool, point: Vec2): Stroke {
    this.end();
    // The tool is copied: a colour chosen after the stroke has ended must not
    // recolour what is already on the glass.
    this.active = { tool: { ...tool }, points: [{ ...point }] };
    this.strokes.push(this.active);
    return this.active;
  }

  /** Adds a point to the open stroke. Returns true when it was far enough to keep. */
  extend(point: Vec2): boolean {
    if (this.active === null) return false;
    const last = this.active.points.at(-1);
    if (last !== undefined && Math.hypot(point.x - last.x, point.y - last.y) < this.minSegment) {
      return false;
    }
    this.active.points.push({ ...point });
    return true;
  }

  end(): void {
    this.active = null;
  }

  clear(): void {
    this.strokes.length = 0;
    this.active = null;
  }
}

/** A quadratic curve from `from` to `to`, bent toward `control`. */
export interface Segment {
  from: Vec2;
  control: Vec2;
  to: Vec2;
}

/**
 * The smooth path through a stroke's points: one quadratic curve per point,
 * running between the midpoints of successive samples with the sample itself
 * as the control. The curve passes through every midpoint and bends around
 * every point, so a hand's jitter becomes a gentle wobble instead of a zigzag,
 * and the whole thing can be drawn one segment at a time as points arrive.
 *
 * Only the segment that ends at point `n` needs points `n-2..n`, which is what
 * `segmentAt` is for; `segmentsOf` is the same thing for a whole stroke, used
 * when the canvas has to be redrawn from scratch.
 */
export function segmentAt(points: readonly Vec2[], n: number): Segment | null {
  const control = points[n - 1];
  const to = points[n];
  if (control === undefined || to === undefined || n < 1) return null;
  const before = points[n - 2];
  // The first curve starts at the first point itself, so the line begins where
  // the fingers met and not half a segment later.
  const from = before === undefined ? control : mid(before, control);
  return { from, control, to: mid(control, to) };
}

export function segmentsOf(points: readonly Vec2[]): Segment[] {
  const segments: Segment[] = [];
  for (let n = 1; n < points.length; n++) {
    const segment = segmentAt(points, n);
    if (segment !== null) segments.push(segment);
  }
  return segments;
}

/**
 * The stretch from the last midpoint to the last point, drawn when a stroke
 * ends so the line reaches the place the fingers parted.
 */
export function tailOf(points: readonly Vec2[]): { from: Vec2; to: Vec2 } | null {
  const last = points.at(-1);
  const before = points.at(-2);
  if (last === undefined || before === undefined) return null;
  return { from: mid(before, last), to: last };
}

function mid(a: Vec2, b: Vec2): Vec2 {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}
