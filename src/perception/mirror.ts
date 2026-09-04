import type { Rect, Vec2 } from "./types.js";

/**
 * The single place the camera-to-screen flip happens.
 *
 * MediaPipe reports coordinates as the camera sees them. The screen shows a
 * mirrored image. Every detector routes its output through here so the flip
 * exists exactly once and can be tested. See docs/adr/0004-mirrored-screen-space.md.
 */

/** Normalized camera-space point -> normalized mirrored screen space. */
export function toMirroredScreen(p: { x: number; y: number }): Vec2 {
  return { x: 1 - p.x, y: p.y };
}

/**
 * Pixel bounding box -> normalized mirrored screen space.
 *
 * The x flip has to account for the box width: mirroring the left edge alone
 * would place the box one width to the left of where it belongs.
 */
export function boxToMirroredScreen(
  box: { originX: number; originY: number; width: number; height: number },
  videoWidth: number,
  videoHeight: number,
): Rect {
  const w = videoWidth || 1;
  const h = videoHeight || 1;
  const normWidth = box.width / w;
  return {
    x: 1 - box.originX / w - normWidth,
    y: box.originY / h,
    width: normWidth,
    height: box.height / h,
  };
}
