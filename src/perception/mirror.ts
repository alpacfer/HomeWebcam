import type { HeadPose, Rect, Vec2, Vec3 } from "./types.js";

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
 * Camera-space world landmark (metres, origin at the hand's centre) -> mirrored.
 *
 * A reflection in a vertical plane negates x and nothing else. The origin is
 * the hand's own centre, so there is no "1 -" here: a point 3 cm to the
 * camera's left of the centre is 3 cm to the screen's right of it.
 */
export function toMirroredWorld(p: { x: number; y: number; z: number }): Vec3 {
  return { x: -p.x, y: p.y, z: p.z };
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

/**
 * Camera-space head pose -> mirrored screen space.
 *
 * Reflecting the world in a vertical plane reverses the two rotations that have
 * a left and a right - yaw and roll - and leaves the one that does not, pitch.
 * Getting this wrong produces a head that leans the wrong way while the mesh
 * drawn over it leans the right way, which reads as a rendering glitch rather
 * than the sign error it is.
 */
export function poseToMirroredScreen(pose: HeadPose): HeadPose {
  return { yaw: -pose.yaw, pitch: pose.pitch, roll: -pose.roll };
}
