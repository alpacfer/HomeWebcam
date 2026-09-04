/**
 * Hermite interpolation between two edges, clamped outside them.
 *
 * Used wherever an effect has to fade in over a distance - the reach of a hand,
 * the depth of a glass rim - because a linear ramp visibly kinks at both ends
 * and this does not. Descending edges (edge0 > edge1) invert it, which is the
 * natural way to write a falloff.
 */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge0 === edge1) return x < edge0 ? 0 : 1;
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
