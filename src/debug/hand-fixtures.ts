import { HAND, PALM_LANDMARKS } from "../perception/landmarks.js";
import type { GestureName, HandObservation, Vec2, Vec3 } from "../perception/types.js";

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

/**
 * How tall the fixture hand is in metres, wrist to middle fingertip. A nominal
 * adult hand, so a fixture's world landmarks land in the range a real one does
 * and the metric pinch gate can be exercised; nothing about detection follows
 * from it. Verify at the station against a real hand's worldLandmarks.
 */
const FIXTURE_HAND_METRES = 0.19;

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
  /** Where the anchor lands, in normalized mirrored screen space. */
  indexTip: Vec2;
  /**
   * Which point of the hand `indexTip` positions. The index fingertip by
   * default, which is what the cursor tracks; the pinch point for Paint mode,
   * whose pointer is the midpoint of thumb and index, so a scenario that says
   * "paint here" puts the ink here.
   */
  anchor?: "index" | "pinch";
  /**
   * 0 is the gesture's own hand; 1 has the thumb tip and index tip touching.
   * A pinch is not a gesture the recognizer has, so it is a shape on top of one.
   */
  pinch?: number;
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

  // The two tips close on their midpoint, and the joints behind them follow
  // half as far, so the fingers bend toward each other rather than teleport.
  const pinch = Math.min(1, Math.max(0, options.pinch ?? 0));
  if (pinch > 0) {
    const thumb = shaped[HAND.THUMB_TIP];
    const index = shaped[HAND.INDEX_TIP];
    if (thumb === undefined || index === undefined) throw new Error("fixture hand lost a tip");
    const meet = { x: (thumb.x + index.x) / 2, y: (thumb.y + index.y) / 2 };
    for (const [joint, share] of [
      [HAND.THUMB_TIP, 1],
      [HAND.INDEX_TIP, 1],
      [3, 0.5],
      [7, 0.5],
    ] as const) {
      const point = shaped[joint];
      if (point === undefined) continue;
      point.x += pinch * share * (meet.x - point.x);
      point.y += pinch * share * (meet.y - point.y);
    }
  }

  // A left hand is the mirror of a right one about the wrist.
  const handedness = options.side === "left" ? -1 : 1;
  const sx = (options.scale / options.aspect) * handedness;
  const sy = options.scale;

  const tip = shaped[HAND.INDEX_TIP];
  const thumbTip = shaped[HAND.THUMB_TIP];
  if (tip === undefined || thumbTip === undefined) throw new Error("fixture hand has no tips");
  const anchor =
    options.anchor === "pinch" ? { x: (tip.x + thumbTip.x) / 2, y: (tip.y + thumbTip.y) / 2 } : tip;
  const originX = options.indexTip.x - anchor.x * sx;
  const originY = options.indexTip.y - anchor.y * sy;

  const landmarks = shaped.map((point) => ({
    x: originX + point.x * sx,
    y: originY + point.y * sy,
  }));

  // World landmarks are the same shape in metres, centred on the hand as
  // MediaPipe centres them, flat (z = 0) because a fixture has no depth to
  // report. Mirrored the same way the screen ones are, so the two agree on
  // which side the thumb is.
  const centre = mean(shaped);
  const world: Vec3[] = shaped.map((point) => ({
    x: (point.x - centre.x) * FIXTURE_HAND_METRES * handedness,
    y: (point.y - centre.y) * FIXTURE_HAND_METRES,
    z: 0,
  }));

  return {
    side: options.side,
    landmarks,
    world,
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
