import type { Expression } from "./types.js";

/**
 * Turns MediaPipe's 52 blendshape scores into the handful of signals the
 * interface will actually use.
 *
 * Kept apart from the detector because it is pure: a list of named scores in, a
 * fixed shape out. That is the part worth unit-testing, and the part that has
 * to survive MediaPipe renaming or reordering a category.
 *
 * The names are ARKit's, and ARKit names sides from the point of view of the
 * face being tracked - `eyeBlinkLeft` is the visitor's left eye. That is
 * already the convention this codebase uses everywhere else, so nothing here
 * swaps anything. Do not "fix" it to match the mirrored coordinates: the
 * coordinates are flipped, the labels are not, and both are correct.
 */

/** Blendshape score by name, 0 for anything the model did not report. */
type Scores = ReadonlyMap<string, number>;

export interface BlendshapeCategory {
  categoryName: string;
  score: number;
}

export const NEUTRAL_EXPRESSION: Expression = {
  smile: 0,
  mouthOpen: 0,
  browRaise: 0,
  blinkLeft: 0,
  blinkRight: 0,
};

export function expressionFromBlendshapes(categories: readonly BlendshapeCategory[]): Expression {
  if (categories.length === 0) return NEUTRAL_EXPRESSION;
  const s: Scores = new Map(categories.map((c) => [c.categoryName, c.score]));

  return {
    // Averaged rather than maxed: one-sided smile scores drift up on a face
    // turned away from the camera, and the mean cancels most of that.
    smile: mean(s, ["mouthSmileLeft", "mouthSmileRight"]),
    mouthOpen: get(s, "jawOpen"),
    browRaise: mean(s, ["browInnerUp", "browOuterUpLeft", "browOuterUpRight"]),
    blinkLeft: get(s, "eyeBlinkLeft"),
    blinkRight: get(s, "eyeBlinkRight"),
  };
}

function get(scores: Scores, name: string): number {
  return scores.get(name) ?? 0;
}

function mean(scores: Scores, names: readonly string[]): number {
  let total = 0;
  for (const name of names) total += get(scores, name);
  return total / names.length;
}
