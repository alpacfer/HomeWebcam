import type { HeadPose } from "./types.js";

/**
 * Head orientation from MediaPipe's facial transformation matrix.
 *
 * The matrix maps the canonical face model onto the detected face, so its
 * rotation block is the head's orientation. Reading angles off it is cheaper
 * and far steadier than inferring them from landmark positions, which wobble
 * with expression.
 *
 * Output is CAMERA space. Route it through poseToMirroredScreen() before it
 * reaches anything above the perception layer.
 */

const DEG = 180 / Math.PI;

/** Guards the asin() branch where yaw and roll stop being separable. */
const GIMBAL_EPSILON = 1e-7;

/**
 * @param data 16 values, column-major, as MediaPipe emits them: element (row,
 *   col) lives at `data[col * 4 + row]`. That layout is why the reads below
 *   look transposed.
 * @returns Null if the matrix is not 4x4, so a model that stops emitting one
 *   degrades to "no pose" rather than to garbage angles.
 */
export function headPoseFromMatrix(data: readonly number[]): HeadPose | null {
  if (data.length !== 16) return null;

  const m11 = data[0] ?? 0;
  const m21 = data[1] ?? 0;
  const m31 = data[2] ?? 0;
  const m13 = data[8] ?? 0;
  const m22 = data[5] ?? 0;
  const m23 = data[9] ?? 0;
  const m33 = data[10] ?? 0;

  // YXZ order: yaw first, then pitch, then roll. That matches how a neck works
  // - you turn, then nod, then tilt - so the three numbers stay independent
  // through the range a person actually uses. An XYZ decomposition of the same
  // matrix makes yaw bleed into roll as soon as the head is not level.
  const pitch = Math.asin(clamp(-m23, -1, 1));
  if (Math.abs(m23) < 1 - GIMBAL_EPSILON) {
    return {
      yaw: Math.atan2(m13, m33) * DEG,
      pitch: pitch * DEG,
      roll: Math.atan2(m21, m22) * DEG,
    };
  }
  // Looking straight up or straight down: yaw and roll describe the same
  // rotation and only their sum is recoverable. Attribute it all to yaw.
  return { yaw: Math.atan2(-m31, m11) * DEG, pitch: pitch * DEG, roll: 0 };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
