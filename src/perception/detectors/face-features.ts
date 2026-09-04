import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import { CONFIG } from "../../config.js";
import { at } from "../../lib/assert.js";
import { expressionFromBlendshapes, NEUTRAL_EXPRESSION } from "../expression.js";
import { headPoseFromMatrix } from "../headpose.js";
import { FACE } from "../landmarks.js";
import { poseToMirroredScreen, toMirroredScreen } from "../mirror.js";
import { MODEL_URL, WASM_PATH } from "../models.js";
import { CentroidTracker } from "../tracker.js";
import type { Detector, FaceFeatures, FaceObservation, FacePoints, Rect, Vec2 } from "../types.js";

/** The mesh only carries iris points when the model bundles iris refinement. */
const MESH_SIZE_WITH_IRISES = 478;

/**
 * Faces with their features: where the head is, where every part of it is, what
 * it is doing and which way it is pointing.
 *
 * This REPLACES FacesDetector rather than joining it. FaceLandmarker runs its
 * own face detection before landmarking, so keeping BlazeFace alongside would
 * pay for finding the face twice and use only one of the answers - the same
 * reason HandsDetector does not run a HandLandmarker next to the gesture
 * recognizer. CONFIG.faces.features chooses between the two. See ADR 0007.
 */
export class FaceFeaturesDetector implements Detector<FaceObservation[]> {
  readonly name = "face-features";
  private landmarker: FaceLandmarker | null = null;
  private readonly tracker = new CentroidTracker();
  private seq = 0;

  async init(): Promise<void> {
    const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);
    this.landmarker = await FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_URL.faceLandmarker, delegate: "GPU" },
      runningMode: "VIDEO",
      numFaces: CONFIG.faces.maxFaces,
      minFaceDetectionConfidence: CONFIG.faces.minDetectionConfidence,
      // Both outputs are extra heads on a graph that has already done the work.
      // Expression and head pose are most of the point of running this model,
      // so paying for them here is cheaper than deriving either from the mesh.
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
    });
  }

  detect(video: HTMLVideoElement, timestampMs: number): FaceObservation[] {
    if (this.landmarker === null) return [];
    const result = this.landmarker.detectForVideo(video, timestampMs);

    const features: FaceFeatures[] = [];
    for (let i = 0; i < result.faceLandmarks.length; i++) {
      // Camera space in, mirrored screen space out. The one flip.
      const mesh: Vec2[] = at(result.faceLandmarks, i, "faceLandmarks").map(toMirroredScreen);
      const matrix = result.facialTransformationMatrixes[i]?.data;
      const pose = matrix === undefined ? null : headPoseFromMatrix(matrix);

      features.push({
        mesh,
        points: namedPoints(mesh),
        expression:
          result.faceBlendshapes[i] === undefined
            ? NEUTRAL_EXPRESSION
            : expressionFromBlendshapes(at(result.faceBlendshapes, i, "blendshapes").categories),
        headPose: pose === null ? null : poseToMirroredScreen(pose),
      });
    }

    const boxes = features.map((f) => meshBounds(f.mesh));
    this.seq++;
    const ids = this.tracker.assign(boxes, this.seq);

    return features.map((f, i) => ({
      trackId: ids[i] ?? `face-unassigned-${i}`,
      box: at(boxes, i, "box"),
      // FaceLandmarker reports no per-face score. This is the bar the face
      // cleared to be in the list at all, not a measurement of how sure we are.
      confidence: CONFIG.faces.minDetectionConfidence,
      features: f,
      identity: null,
    }));
  }

  close(): void {
    this.landmarker?.close();
    this.landmarker = null;
    this.tracker.reset();
  }
}

/**
 * Bounds of the mesh, which is the skin of the face and nothing else.
 *
 * Tighter than BlazeFace's box, which includes some forehead and jaw margin. It
 * has to stay consistent frame to frame rather than match the other detector,
 * because CentroidTracker matches box centres between frames and a box that
 * changed definition mid-stream would break track ids, not just labels.
 */
function meshBounds(mesh: readonly Vec2[]): Rect {
  if (mesh.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const p of mesh) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function namedPoints(mesh: readonly Vec2[]): FacePoints {
  const leftEye = midpoint(
    at(mesh, FACE.LEFT_EYE_INNER, "leftEyeInner"),
    at(mesh, FACE.LEFT_EYE_OUTER, "leftEyeOuter"),
  );
  const rightEye = midpoint(
    at(mesh, FACE.RIGHT_EYE_INNER, "rightEyeInner"),
    at(mesh, FACE.RIGHT_EYE_OUTER, "rightEyeOuter"),
  );
  // A model without iris refinement stops at 467. Falling back to the eye
  // centre keeps the station running with a slightly duller gaze rather than
  // throwing on a missing index in the middle of the frame loop.
  const hasIrises = mesh.length >= MESH_SIZE_WITH_IRISES;

  return {
    noseTip: at(mesh, FACE.NOSE_TIP, "noseTip"),
    chin: at(mesh, FACE.CHIN, "chin"),
    forehead: at(mesh, FACE.FOREHEAD, "forehead"),
    leftEye,
    rightEye,
    leftIris: hasIrises ? at(mesh, FACE.LEFT_IRIS_CENTER, "leftIris") : leftEye,
    rightIris: hasIrises ? at(mesh, FACE.RIGHT_IRIS_CENTER, "rightIris") : rightEye,
    mouthCenter: midpoint(
      at(mesh, FACE.UPPER_LIP, "upperLip"),
      at(mesh, FACE.LOWER_LIP, "lowerLip"),
    ),
  };
}

function midpoint(a: Vec2, b: Vec2): Vec2 {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}
