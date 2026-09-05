/**
 * The contract between the perception layer and everything above it.
 *
 * IMPORTANT: every coordinate in this file is in **mirrored screen space**:
 * normalized 0..1, x already flipped so that x=0 is the left edge of what the
 * visitor sees on screen. Raising your right hand moves x toward 1.
 * The flip happens once, in the detectors. Nothing above this layer should ever
 * mirror a coordinate again. See docs/adr/0004-mirrored-screen-space.md.
 */

/** Normalized point in mirrored screen space. */
export interface Vec2 {
  x: number;
  y: number;
}

/** Normalized rectangle in mirrored screen space. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The eight gestures the bundled MediaPipe model can recognize, plus "None". */
export type GestureName =
  | "None"
  | "Closed_Fist"
  | "Open_Palm"
  | "Pointing_Up"
  | "Thumb_Down"
  | "Thumb_Up"
  | "Victory"
  | "ILoveYou";

export interface HandObservation {
  /** Which of the visitor's hands this is, corrected for the mirror. */
  side: "left" | "right";
  /** 21 MediaPipe hand landmarks. Index constants live in ./landmarks.ts. */
  landmarks: Vec2[];
  /** Index fingertip. The pointing device for the cursor. */
  indexTip: Vec2;
  /** Mean of the five palm landmarks. Steadier than any single point. */
  palmCenter: Vec2;
  gesture: GestureName;
  gestureConfidence: number;
}

/** Set by an IdentityDetector once someone is enrolled. Null when unknown. */
export interface Identity {
  personId: string;
  displayName: string;
  /** Cosine similarity to the enrolled template, 0..1. */
  similarity: number;
}

/**
 * Expression signals, 0..1, from MediaPipe's blendshapes.
 *
 * Blendshapes rather than geometry measured off the mesh: the model already
 * normalizes for head size, distance and rotation, which a raw lip-gap-over-
 * face-height ratio does not. A smile read geometrically changes value when the
 * visitor steps back; this does not.
 *
 * Left and right are the VISITOR's, as everywhere else in this file.
 */
export interface Expression {
  /** Mean of the two mouth corners. */
  smile: number;
  /** Jaw opening. Speech hovers around 0.1-0.3; a deliberate gape approaches 1. */
  mouthOpen: number;
  /** Mean of the inner and outer brow raises. */
  browRaise: number;
  /** 1 = fully closed. Both at once is a blink; one is a wink. */
  blinkLeft: number;
  blinkRight: number;
}

/**
 * Head orientation in degrees, in mirrored screen space.
 *
 * Signs follow the screen, not the camera: yaw is negative when the visitor
 * turns toward the left of the screen they are looking at, positive toward the
 * right, and 0 facing the station. Pitch is positive looking up, roll positive
 * tilting the head toward the right of the screen.
 */
export interface HeadPose {
  yaw: number;
  pitch: number;
  roll: number;
}

/** Mesh points worth naming, so consumers never index the mesh themselves. */
export interface FacePoints {
  noseTip: Vec2;
  chin: Vec2;
  forehead: Vec2;
  leftEye: Vec2;
  rightEye: Vec2;
  /** Iris centres, the raw material for gaze. Fall back to the eye centre. */
  leftIris: Vec2;
  rightIris: Vec2;
  mouthCenter: Vec2;
}

/** What a face is doing, as opposed to merely where it is. */
export interface FaceFeatures {
  /** 478 mesh points in mirrored screen space. Index with FACE from ./landmarks.ts. */
  mesh: Vec2[];
  points: FacePoints;
  expression: Expression;
  /** Null when the model returned no transformation matrix for this face. */
  headPose: HeadPose | null;
}

export interface FaceObservation {
  /** Stable for as long as the face keeps being tracked across frames. */
  trackId: string;
  box: Rect;
  confidence: number;
  /** Null when CONFIG.faces.features is off, or the plain detector produced it. */
  features: FaceFeatures | null;
  identity: Identity | null;
}

/**
 * Something said out loud, as the speech model heard it.
 *
 * The station has one ear and it is on the same clock as the camera: an
 * utterance arrives on the first frame after the model finished with it, which
 * is a second or so after the mouth stopped moving. `startedAt` and `endedAt`
 * are when it was *said*, so a trace can line words up with hands.
 */
export interface Utterance {
  /** As written, punctuation and all: " Stop that." */
  text: string;
  /** Lower-cased, punctuation dropped. What a command is matched against. */
  words: string[];
  startedAt: number;
  endedAt: number;
  /**
   * "injected" means the station was told these words rather than hearing them,
   * which is how the wiring is tested without a microphone. It is the same rule
   * as the puppet's, for the same reason. See ADR 0011.
   */
  source: "microphone" | "injected";
}

/** One assembled observation of the world. Produced by PerceptionEngine.step(). */
export interface PerceptionFrame {
  /** Monotonic frame counter since start. */
  seq: number;
  /** performance.now() when the frame was processed, in ms. */
  t: number;
  hands: HandObservation[];
  faces: FaceObservation[];
  /** Said since the previous frame. Almost always empty. See ADR 0016. */
  heard: Utterance[];
}

/**
 * A perception module. Add one by implementing this and registering it in
 * src/perception/engine.ts. Detectors are synchronous per frame on purpose:
 * MediaPipe's *ForVideo methods block, and interleaving them with async work
 * makes frame timestamps go backwards, which MediaPipe rejects.
 */
export interface Detector<TResult> {
  readonly name: string;
  /** Loads models. Called once, before the first step(). */
  init(): Promise<void>;
  /** @param timestampMs Strictly increasing across calls. */
  detect(video: HTMLVideoElement, timestampMs: number): TResult;
  close(): void;
}

/** Identity is a separate seam because MediaPipe has no face-recognition task. */
export interface IdentityDetector {
  readonly name: string;
  init(): Promise<void>;
  /** Returns null when the face is not recognized or the module is a no-op. */
  identify(video: HTMLVideoElement, face: FaceObservation): Identity | null;
  close(): void;
}

export const EMPTY_FRAME: PerceptionFrame = { seq: 0, t: 0, hands: [], faces: [], heard: [] };
