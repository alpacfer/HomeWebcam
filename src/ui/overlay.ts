import type { CursorState } from "../interaction/cursor.js";
import type { BrushCursor } from "../interaction/paint-session.js";
import { at } from "../lib/assert.js";
import { FACE_CONTOURS, HAND_BONES } from "../perception/landmarks.js";
import type { FaceFeatures, PerceptionFrame, Vec2 } from "../perception/types.js";

const HAND_COLOR = "rgba(120, 230, 255, 0.9)";
const FACE_COLOR = "rgba(255, 205, 110, 0.9)";
/** The mesh is 150 segments over someone's face. It has to sit behind the box. */
const MESH_COLOR = "rgba(255, 205, 110, 0.45)";
const IRIS_COLOR = "rgba(255, 235, 190, 0.95)";
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
  brush: BrushCursor | null = null,
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
      if (face.features !== null) drawFaceFeatures(ctx, face.features, px);

      ctx.lineWidth = Math.max(2, w / 640);
      const [x, y] = px({ x: face.box.x, y: face.box.y });
      ctx.strokeStyle = FACE_COLOR;
      ctx.strokeRect(x, y, face.box.width * w, face.box.height * h);
      const name = face.identity?.displayName ?? face.trackId;
      label(ctx, name, x, y - ctx.lineWidth * 4, FACE_COLOR);
    }
  }

  if (brush !== null) {
    drawBrush(ctx, brush, cursor.dwellProgress, px);
  } else if (cursor.position !== null) {
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

/**
 * The brush in place of the cursor: a ring the size the ink will be, in the
 * colour it will be, and the two fingertips that have to meet on it. Open, the
 * fingertips sit either side of the ring; pinched, they land on it and the ring
 * fills. That is the whole lesson, and it is drawn rather than written.
 */
function drawBrush(
  ctx: CanvasRenderingContext2D,
  brush: BrushCursor,
  dwell: number,
  px: (p: Vec2) => [number, number],
): void {
  const { width: w, height: h } = ctx.canvas;
  const [x, y] = px(brush.position);
  // Never thinner than the cursor was: a 9 px line has a 4 px ring otherwise.
  const r = Math.max(w * 0.012, (brush.width * h) / 2);
  ctx.lineWidth = Math.max(2, w / 640);

  ctx.setLineDash(brush.erasing ? [ctx.lineWidth * 3, ctx.lineWidth * 3] : []);
  ctx.strokeStyle = brush.erasing ? "rgba(255, 255, 255, 0.9)" : brush.color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  // The grip disc grows from the middle as the fingers close and is full when
  // the ink flows, so the gesture answers back the whole way in instead of only
  // at the threshold. It is drawn from the raw measurement and the solid fill
  // from the ink actually flowing - the gate closed *and* the fingers together
  // this frame - so the moment they part the disc drops back to the grip, the
  // same frame the ink stops. See ADR 0023.
  if (brush.grip > 0 || brush.pressed) {
    ctx.globalAlpha = brush.erasing ? 0.22 : 0.55;
    ctx.fillStyle = brush.erasing ? "#fff" : brush.color;
    ctx.beginPath();
    ctx.arc(x, y, r * (brush.pressed ? 1 : brush.grip), 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // A dwell on a chip, drawn round the brush the way it is drawn round the cursor.
  if (dwell > 0) {
    ctx.strokeStyle = CURSOR_COLOR;
    ctx.beginPath();
    ctx.arc(x, y, r + ctx.lineWidth * 3, -Math.PI / 2, -Math.PI / 2 + dwell * Math.PI * 2);
    ctx.stroke();
  }

  ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
  for (const tip of [brush.thumb, brush.index]) {
    if (tip === null) continue;
    const [tx, ty] = px(tip);
    ctx.beginPath();
    ctx.arc(tx, ty, ctx.lineWidth * 1.4, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * Feature contours rather than the full tesselation, and no per-point dots.
 * A face at kiosk distance is maybe 300 px tall: 478 dots on it is a solid
 * blob that proves the model ran and nothing else. Outlines show whether the
 * mesh is actually tracking the eyes and mouth, which is the thing you are
 * looking at the debug overlay to find out.
 */
function drawFaceFeatures(
  ctx: CanvasRenderingContext2D,
  features: FaceFeatures,
  px: (p: Vec2) => [number, number],
): void {
  ctx.lineWidth = Math.max(1, ctx.canvas.width / 1400);
  ctx.strokeStyle = MESH_COLOR;
  ctx.beginPath();
  for (const contour of FACE_CONTOURS) {
    for (let i = 0; i < contour.points.length; i++) {
      const point = at(features.mesh, at(contour.points, i, "contour"), "mesh");
      if (i === 0) ctx.moveTo(...px(point));
      else ctx.lineTo(...px(point));
    }
    if (contour.closed) ctx.closePath();
  }
  ctx.stroke();

  // Iris centres, brighter than the mesh: they are where gaze will come from,
  // and a mesh that has locked onto the face but not the eyes looks fine until
  // you can see these sitting still while the person looks around.
  ctx.fillStyle = IRIS_COLOR;
  for (const iris of [features.points.leftIris, features.points.rightIris]) {
    const [x, y] = px(iris);
    ctx.beginPath();
    ctx.arc(x, y, Math.max(1.5, ctx.canvas.width / 500), 0, Math.PI * 2);
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
