import { HAND, PALM_LANDMARKS } from "../perception/landmarks.js";
import type { GestureName, HandObservation, Vec2 } from "../perception/types.js";

/**
 * Synthetic hands, shaped like the ones MediaPipe produces.
 *
 * These exist so an interaction can be exercised without a person standing in
 * the hallway. Waiting for a human to wave at the camera cost this project
 * seven minutes of wall clock in one sitting, for three screenshots.
 *
 * What they are NOT is a test of perception. A fixture hand is exactly as
 * confident and as steady as we tell it to be, so it can prove that a Victory
 * hold opens Picture mode and can never prove that the model recognises a
 * Victory. See docs/adr/0011-puppet-perception.md.
 */

/**
 * One open right hand, wrist at the origin, fingers up the negative y axis,
 * roughly one unit tall. Proportions are eyeballed from MediaPipe output at
 * kiosk distance; they only have to be plausible enough that the debug overlay
 * draws something hand-shaped.
 */
const OPEN_HAND: readonly Vec2[] = [
  { x: 0, y: 0 }, // 0  wrist
  { x: -0.22, y: -0.1 }, // 1  thumb CMC
  { x: -0.36, y: -0.24 }, // 2  thumb MCP
  { x: -0.46, y: -0.36 }, // 3  thumb IP
  { x: -0.54, y: -0.46 }, // 4  thumb tip
  { x: -0.16, y: -0.5 }, // 5  index MCP
  { x: -0.19, y: -0.7 }, // 6
  { x: -0.2, y: -0.82 }, // 7
  { x: -0.21, y: -0.93 }, // 8  index tip
  { x: 0, y: -0.53 }, // 9  middle MCP
  { x: 0, y: -0.75 }, // 10
  { x: 0, y: -0.88 }, // 11
  { x: 0, y: -1 }, // 12 middle tip
  { x: 0.15, y: -0.51 }, // 13 ring MCP
  { x: 0.17, y: -0.71 }, // 14
  { x: 0.18, y: -0.83 }, // 15
  { x: 0.19, y: -0.93 }, // 16 ring tip
  { x: 0.28, y: -0.45 }, // 17 pinky MCP
  { x: 0.32, y: -0.61 }, // 18
  { x: 0.34, y: -0.71 }, // 19
  { x: 0.35, y: -0.8 }, // 20 pinky tip
];

/** Index of the knuckle each finger folds toward, and the joints that fold. */
const FINGERS: ReadonlyArray<{ mcp: number; joints: readonly number[] }> = [
  { mcp: 1, joints: [2, 3, 4] }, // thumb
  { mcp: 5, joints: [6, 7, 8] },
  { mcp: 9, joints: [10, 11, 12] },
  { mcp: 13, joints: [14, 15, 16] },
  { mcp: 17, joints: [18, 19, 20] },
];

/** Where a fully curled joint ends up relative to its knuckle: folded into the palm. */
const CURLED = [
  { x: 0.02, y: 0.06 },
  { x: 0.04, y: 0.1 },
  { x: 0.05, y: 0.13 },
];

/** Curl per finger (thumb, index, middle, ring, pinky) for each gesture. */
const SHAPES: Record<GestureName, readonly number[]> = {
  None: [0.2, 0.2, 0.2, 0.2, 0.2],
  Open_Palm: [0, 0, 0, 0, 0],
  Victory: [0.6, 0, 0, 1, 1],
  Pointing_Up: [0.5, 0, 1, 1, 1],
  Closed_Fist: [0.8, 1, 1, 1, 1],
  Thumb_Up: [0, 1, 1, 1, 1],
  Thumb_Down: [0, 1, 1, 1, 1],
  ILoveYou: [0, 0, 1, 1, 0],
};

export interface FixtureOptions {
  /** Where the index fingertip goes, in normalized mirrored screen space. */
  indexTip: Vec2;
  gesture: GestureName;
  side: "left" | "right";
  /** Hand height as a fraction of the viewport height. 0.22 is arm's length. */
  scale: number;
  /** Viewport width over height, so the hand is not stretched on a 16:9 screen. */
  aspect: number;
  confidence: number;
}

/**
 * Builds a HandObservation the rest of the app cannot tell from a real one.
 *
 * Anchored on the index fingertip rather than the wrist, because that is the
 * point a person aims with and the point the cursor tracks: a scenario that
 * says "point here" means the fingertip lands here.
 */
export function fixtureHand(options: FixtureOptions): HandObservation {
  const curls = SHAPES[options.gesture];
  const shaped = OPEN_HAND.map((point) => ({ ...point }));

  FINGERS.forEach((finger, index) => {
    const curl = curls[index] ?? 0;
    if (curl === 0) return;
    const knuckle = shaped[finger.mcp];
    if (knuckle === undefined) return;
    finger.joints.forEach((joint, jointIndex) => {
      const open = shaped[joint];
      const target = CURLED[jointIndex];
      if (open === undefined || target === undefined) return;
      open.x += curl * (knuckle.x + target.x - open.x);
      open.y += curl * (knuckle.y + target.y - open.y);
    });
  });

  // A left hand is the mirror of a right one about the wrist.
  const handedness = options.side === "left" ? -1 : 1;
  const sx = (options.scale / options.aspect) * handedness;
  const sy = options.scale;

  const tip = shaped[HAND.INDEX_TIP];
  if (tip === undefined) throw new Error("fixture hand has no index tip");
  const originX = options.indexTip.x - tip.x * sx;
  const originY = options.indexTip.y - tip.y * sy;

  const landmarks = shaped.map((point) => ({
    x: originX + point.x * sx,
    y: originY + point.y * sy,
  }));

  return {
    side: options.side,
    landmarks,
    indexTip: at(landmarks, HAND.INDEX_TIP),
    palmCenter: mean(PALM_LANDMARKS.map((index) => at(landmarks, index))),
    gesture: options.gesture,
    gestureConfidence: options.confidence,
  };
}

function at(points: readonly Vec2[], index: number): Vec2 {
  const point = points[index];
  if (point === undefined) throw new Error(`fixture hand has no landmark ${index}`);
  return point;
}

function mean(points: readonly Vec2[]): Vec2 {
  let x = 0;
  let y = 0;
  for (const point of points) {
    x += point.x;
    y += point.y;
  }
  return { x: x / points.length, y: y / points.length };
}
