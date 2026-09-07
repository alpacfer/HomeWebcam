/** Named indices into the landmark arrays MediaPipe produces, for hands and faces. */

/** Named indices into HandObservation.landmarks (MediaPipe's 21-point hand). */
export const HAND = {
  WRIST: 0,
  /** The thumb's last joint before the tip. With INDEX_DIP, what a pinch is held on. */
  THUMB_IP: 3,
  THUMB_TIP: 4,
  INDEX_MCP: 5,
  INDEX_DIP: 7,
  INDEX_TIP: 8,
  MIDDLE_MCP: 9,
  MIDDLE_TIP: 12,
  RING_MCP: 13,
  RING_TIP: 16,
  PINKY_MCP: 17,
  PINKY_TIP: 20,
} as const;

/** Landmarks averaged to get a stable palm centre. */
export const PALM_LANDMARKS = [
  HAND.WRIST,
  HAND.INDEX_MCP,
  HAND.MIDDLE_MCP,
  HAND.RING_MCP,
  HAND.PINKY_MCP,
] as const;

/** Pairs to stroke when drawing a hand skeleton. */
export const HAND_BONES: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [0, 5],
  [5, 6],
  [6, 7],
  [7, 8],
  [5, 9],
  [9, 10],
  [10, 11],
  [11, 12],
  [9, 13],
  [13, 14],
  [14, 15],
  [15, 16],
  [13, 17],
  [17, 18],
  [18, 19],
  [19, 20],
  [0, 17],
];

/**
 * Named indices into FaceFeatures.mesh (MediaPipe's 478-point face mesh).
 *
 * Sides are the VISITOR's, matching HandObservation.side: LEFT_EYE_OUTER is the
 * corner of the eye they would call their left. Because the mesh is in mirrored
 * screen space it draws on the right of the screen, which is where they see it
 * in a mirror. MediaPipe numbers its mesh the same way round, so these are its
 * indices unchanged - no renaming, and nothing here re-does the flip.
 *
 * Points 468-477 are the irises. They only exist because face_landmarker.task
 * bundles the iris refinement; a 468-point mesh would stop at 467.
 */
export const FACE = {
  NOSE_TIP: 1,
  CHIN: 152,
  FOREHEAD: 10,
  LEFT_EYE_INNER: 362,
  LEFT_EYE_OUTER: 263,
  RIGHT_EYE_INNER: 133,
  RIGHT_EYE_OUTER: 33,
  LEFT_IRIS_CENTER: 473,
  RIGHT_IRIS_CENTER: 468,
  MOUTH_LEFT: 291,
  MOUTH_RIGHT: 61,
  UPPER_LIP: 13,
  LOWER_LIP: 14,
} as const;

/**
 * Contours to stroke when drawing a face.
 *
 * Rings, not bones: each entry is a run of points to connect in order. Drawing
 * the full tesselation would be ~2600 line segments per face per frame for a
 * grey smear; the features are what a developer actually needs to see, and they
 * cost about 150. `closed` rings join their last point back to their first.
 */
export interface FaceContour {
  readonly name: string;
  readonly closed: boolean;
  readonly points: readonly number[];
}

export const FACE_CONTOURS: readonly FaceContour[] = [
  {
    name: "oval",
    closed: true,
    points: [
      10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152,
      148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109,
    ],
  },
  {
    name: "leftEye",
    closed: true,
    points: [362, 382, 381, 380, 374, 373, 390, 249, 263, 466, 388, 387, 386, 385, 384, 398],
  },
  {
    name: "rightEye",
    closed: true,
    points: [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246],
  },
  { name: "leftIris", closed: true, points: [474, 475, 476, 477] },
  { name: "rightIris", closed: true, points: [469, 470, 471, 472] },
  { name: "leftBrowUpper", closed: false, points: [300, 293, 334, 296, 336] },
  { name: "leftBrowLower", closed: false, points: [276, 283, 282, 295, 285] },
  { name: "rightBrowUpper", closed: false, points: [70, 63, 105, 66, 107] },
  { name: "rightBrowLower", closed: false, points: [46, 53, 52, 65, 55] },
  {
    name: "lipsOuter",
    closed: true,
    points: [
      61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185,
    ],
  },
  {
    name: "lipsInner",
    closed: true,
    points: [
      78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308, 415, 310, 311, 312, 13, 82, 81, 80, 191,
    ],
  },
];
