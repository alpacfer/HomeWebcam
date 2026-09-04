import { FilesetResolver, GestureRecognizer } from "@mediapipe/tasks-vision";
import { CONFIG } from "../../config.js";
import { at } from "../../lib/assert.js";
import { HAND, PALM_LANDMARKS } from "../landmarks.js";
import { toMirroredScreen } from "../mirror.js";
import { MODEL_URL, WASM_PATH } from "../models.js";
import type { Detector, GestureName, HandObservation, Vec2 } from "../types.js";

/**
 * Hands and gestures in one pass.
 *
 * GestureRecognizer bundles the hand landmarker, so running a separate
 * HandLandmarker alongside it would double the per-frame cost for nothing.
 */
export class HandsDetector implements Detector<HandObservation[]> {
  readonly name = "hands";
  private recognizer: GestureRecognizer | null = null;

  async init(): Promise<void> {
    const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);
    this.recognizer = await GestureRecognizer.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_URL.gestureRecognizer, delegate: "GPU" },
      runningMode: "VIDEO",
      numHands: CONFIG.hands.maxHands,
      minHandDetectionConfidence: CONFIG.hands.minDetectionConfidence,
      minTrackingConfidence: CONFIG.hands.minTrackingConfidence,
    });
  }

  detect(video: HTMLVideoElement, timestampMs: number): HandObservation[] {
    if (this.recognizer === null) return [];
    const result = this.recognizer.recognizeForVideo(video, timestampMs);
    const hands: HandObservation[] = [];

    for (let i = 0; i < result.landmarks.length; i++) {
      const raw = at(result.landmarks, i, "landmarks");
      // Camera space in, mirrored screen space out. The one flip.
      const landmarks: Vec2[] = raw.map(toMirroredScreen);

      const topGesture = result.gestures[i]?.[0];
      const handedness = result.handedness[i]?.[0]?.categoryName;

      hands.push({
        side: resolveSide(handedness),
        landmarks,
        indexTip: at(landmarks, HAND.INDEX_TIP, "indexTip"),
        palmCenter: mean(PALM_LANDMARKS.map((idx) => at(landmarks, idx, "palm"))),
        gesture: (topGesture?.categoryName ?? "None") as GestureName,
        gestureConfidence: topGesture?.score ?? 0,
      });
    }
    return hands;
  }

  close(): void {
    this.recognizer?.close();
    this.recognizer = null;
  }
}

/**
 * MediaPipe documents handedness as being labelled for a mirrored selfie view,
 * which is what the visitor sees, so we pass the label straight through.
 * That is documented behaviour, not something verified against this camera:
 * if left/right read backwards at the station, flip CONFIG.hands.swapHandedness.
 */
function resolveSide(categoryName: string | undefined): "left" | "right" {
  const asReported = categoryName === "Left" ? "left" : "right";
  if (!CONFIG.hands.swapHandedness) return asReported;
  return asReported === "left" ? "right" : "left";
}

function mean(points: readonly Vec2[]): Vec2 {
  let x = 0;
  let y = 0;
  for (const p of points) {
    x += p.x;
    y += p.y;
  }
  return { x: x / points.length, y: y / points.length };
}
