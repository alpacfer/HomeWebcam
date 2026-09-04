import type { CameraMode } from "../camera/camera.js";
import type { CursorState } from "../interaction/cursor.js";
import type { DetectorTimings } from "../perception/engine.js";
import type { FaceObservation, PerceptionFrame } from "../perception/types.js";

/** Everything the HUD shows that is not in the PerceptionFrame itself. */
export interface HudStats {
  /** Debug/final presentation and capture profile currently active. */
  mode: CameraMode;
  /** Rate the perception loop achieves, capped by the camera. */
  fps: number;
  /** What the camera actually negotiated. See describeStream(). */
  camera: string;
  /** Per-detector cost. The budget at 60 fps is 16.7 ms for all of them. */
  timings: DetectorTimings;
}

/** Corner readout: is the loop alive, and what does it currently see. */
export class Hud {
  constructor(private readonly root: HTMLElement) {}

  /** The HUD is a developer tool. A visitor at the station should never see it. */
  setVisible(visible: boolean): void {
    this.root.classList.toggle("hud--hidden", !visible);
  }

  render(frame: PerceptionFrame, cursor: CursorState, stats: HudStats): void {
    const gestures = frame.hands
      .filter((h) => h.gesture !== "None")
      .map((h) => `${h.side}:${h.gesture}`)
      .join("  ");

    const lines = [
      `${stats.mode.toUpperCase()} · ${stats.fps.toFixed(0)} fps loop · camera ${stats.camera}`,
      `hands ${stats.timings.hands.toFixed(1)}ms · faces ${stats.timings.faces.toFixed(1)}ms`,
      `hands ${frame.hands.length} · faces ${frame.faces.length}`,
      gestures || "no gesture",
    ];

    // One line per face, not per feature: the mesh has 478 points and the HUD
    // is 42 characters wide. These four numbers are the ones worth watching
    // while tuning, and the overlay shows the rest.
    for (const face of frame.faces) lines.push(describeFace(face));

    lines.push(
      cursor.position === null
        ? "raise a hand to point"
        : `cursor ${cursor.position.x.toFixed(2)}, ${cursor.position.y.toFixed(2)} · dwell ${(cursor.dwellProgress * 100).toFixed(0)}%`,
    );
    lines.push("D debug · F final");

    this.root.textContent = lines.join("\n");
  }

  showError(message: string, hint: string): void {
    this.root.classList.remove("hud--hidden");
    this.root.classList.add("hud--error");
    this.root.textContent = `${message}\n\n${hint}`;
  }
}

function describeFace(face: FaceObservation): string {
  const name = face.identity?.displayName ?? face.trackId;
  if (face.features === null) return `${name} · no features`;

  const { expression, headPose } = face.features;
  const pose = headPose === null ? "no pose" : `yaw ${headPose.yaw.toFixed(0)}°`;
  return `${name} smile ${expression.smile.toFixed(2)} · open ${expression.mouthOpen.toFixed(2)} · brow ${expression.browRaise.toFixed(2)} · ${pose}`;
}
