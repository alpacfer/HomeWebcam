import type { CursorState } from "../interaction/cursor.js";
import { at } from "../lib/assert.js";
import { HAND_BONES } from "../perception/landmarks.js";
import type { PerceptionFrame, Vec2 } from "../perception/types.js";

const HAND_COLOR = "rgba(120, 230, 255, 0.9)";
const FACE_COLOR = "rgba(255, 205, 110, 0.9)";
const CURSOR_COLOR = "rgba(255, 255, 255, 0.95)";

/**
 * Draws perception output on top of the mirror.
 *
 * Debug rendering only. Real interface elements belong in their own modules;
 * this file exists so a developer or agent can see what the detectors think.
 */
export function drawOverlay(
  ctx: CanvasRenderingContext2D,
  frame: PerceptionFrame,
  cursor: CursorState,
  showDebug: boolean,
): void {
  const { width: w, height: h } = ctx.canvas;
  ctx.clearRect(0, 0, w, h);
  const px = (p: Vec2): [number, number] => [p.x * w, p.y * h];

  if (showDebug) {
    ctx.lineWidth = Math.max(2, w / 640);

    for (const hand of frame.hands) {
      ctx.strokeStyle = HAND_COLOR;
      ctx.beginPath();
      for (const [a, b] of HAND_BONES) {
        const from = at(hand.landmarks, a, "bone");
        const to = at(hand.landmarks, b, "bone");
        ctx.moveTo(...px(from));
        ctx.lineTo(...px(to));
      }
      ctx.stroke();

      ctx.fillStyle = HAND_COLOR;
      for (const p of hand.landmarks) {
        const [x, y] = px(p);
        ctx.beginPath();
        ctx.arc(x, y, ctx.lineWidth * 1.6, 0, Math.PI * 2);
        ctx.fill();
      }

      if (hand.gesture !== "None") {
        const [x, y] = px(hand.palmCenter);
        label(ctx, `${hand.side} · ${hand.gesture}`, x, y - h * 0.06, HAND_COLOR);
      }
    }

    for (const face of frame.faces) {
      const [x, y] = px({ x: face.box.x, y: face.box.y });
      ctx.strokeStyle = FACE_COLOR;
      ctx.strokeRect(x, y, face.box.width * w, face.box.height * h);
      const name = face.identity?.displayName ?? face.trackId;
      label(ctx, name, x, y - ctx.lineWidth * 4, FACE_COLOR);
    }
  }

  if (cursor.position !== null) {
    const [x, y] = px(cursor.position);
    const r = w * 0.022;
    ctx.lineWidth = Math.max(3, w / 400);

    ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();

    if (cursor.dwellProgress > 0) {
      ctx.strokeStyle = CURSOR_COLOR;
      ctx.beginPath();
      ctx.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + cursor.dwellProgress * Math.PI * 2);
      ctx.stroke();
    }

    ctx.fillStyle = CURSOR_COLOR;
    ctx.beginPath();
    ctx.arc(x, y, ctx.lineWidth, 0, Math.PI * 2);
    ctx.fill();
  }
}

function label(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color: string,
): void {
  ctx.font = `${Math.round(ctx.canvas.width / 60)}px ui-monospace, monospace`;
  ctx.textBaseline = "bottom";
  ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
  const pad = ctx.canvas.width / 200;
  const m = ctx.measureText(text);
  ctx.fillRect(
    x - pad,
    y - m.actualBoundingBoxAscent - pad,
    m.width + pad * 2,
    m.actualBoundingBoxAscent + pad * 2,
  );
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}
