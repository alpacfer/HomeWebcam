import { FaceDetector, FilesetResolver } from "@mediapipe/tasks-vision";
import { CONFIG } from "../../config.js";
import { boxToMirroredScreen } from "../mirror.js";
import { MODEL_URL, WASM_PATH } from "../models.js";
import { CentroidTracker } from "../tracker.js";
import type { Detector, FaceObservation } from "../types.js";

/**
 * Face presence and position, with a stable track id per person.
 *
 * This answers "is somebody there, and where" - not "who" and not "doing what".
 * Identity lives in ./identity.ts because MediaPipe ships no face-recognition
 * task. Features live in ./face-features.ts, which replaces this detector when
 * CONFIG.faces.features is on: BlazeFace is a tenth of the model and a fraction
 * of the per-frame cost, so it stays as the cheap presence-only option.
 */
export class FacesDetector implements Detector<FaceObservation[]> {
  readonly name = "faces";
  private detector: FaceDetector | null = null;
  private readonly tracker = new CentroidTracker();
  private seq = 0;

  async init(): Promise<void> {
    const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);
    this.detector = await FaceDetector.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_URL.faceDetector, delegate: "GPU" },
      runningMode: "VIDEO",
      minDetectionConfidence: CONFIG.faces.minDetectionConfidence,
    });
  }

  detect(video: HTMLVideoElement, timestampMs: number): FaceObservation[] {
    if (this.detector === null) return [];
    const { detections } = this.detector.detectForVideo(video, timestampMs);
    // FaceDetector reports boxes in source pixels, not normalized.
    const boxes = detections.map((d) =>
      d.boundingBox === undefined
        ? { x: 0, y: 0, width: 0, height: 0 }
        : boxToMirroredScreen(d.boundingBox, video.videoWidth, video.videoHeight),
    );

    this.seq++;
    const ids = this.tracker.assign(boxes, this.seq);

    return boxes.map((box, i) => ({
      trackId: ids[i] ?? `face-unassigned-${i}`,
      box,
      confidence: detections[i]?.categories[0]?.score ?? 0,
      features: null,
      identity: null,
    }));
  }

  close(): void {
    this.detector?.close();
    this.detector = null;
    this.tracker.reset();
  }
}
