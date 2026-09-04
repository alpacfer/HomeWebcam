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

export interface FaceObservation {
  /** Stable for as long as the face keeps being tracked across frames. */
  trackId: string;
  box: Rect;
  confidence: number;
  identity: Identity | null;
}

/** One assembled observation of the world. Produced by PerceptionEngine.step(). */
export interface PerceptionFrame {
  /** Monotonic frame counter since start. */
  seq: number;
  /** performance.now() when the frame was processed, in ms. */
  t: number;
  hands: HandObservation[];
  faces: FaceObservation[];
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

export const EMPTY_FRAME: PerceptionFrame = { seq: 0, t: 0, hands: [], faces: [] };
