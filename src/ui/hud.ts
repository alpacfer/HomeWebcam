import type { CameraMode, StationView } from "../camera/camera.js";
import { CONFIG } from "../config.js";
import type { CursorState } from "../interaction/cursor.js";
import type { PaintStatus } from "../interaction/paint-session.js";
import type { DetectorTimings } from "../perception/engine.js";
import type { FaceObservation, PerceptionFrame } from "../perception/types.js";
import type { VoiceStatus } from "../perception/voice.js";

/** Everything the HUD shows that is not in the PerceptionFrame itself. */
export interface HudStats {
  /** Debug/final presentation and capture profile currently active. */
  mode: CameraMode;
  /** Rate the perception loop achieves, capped by the camera. */
  fps: number;
  /** What is on the glass. Only ever "debug" here, since that is where the HUD is. */
  view: StationView;
  /** Rate the camera actually delivers, measured rather than negotiated. */
  capturedFps: number;
  /** What the camera actually negotiated. See describeStream(). */
  camera: string;
  /** Per-detector cost. The budget at 60 fps is 16.7 ms for all of them. */
  timings: DetectorTimings;
  /** What the ear is doing. See src/perception/voice.ts. */
  voice: VoiceStatus;
  /** Paint mode, while it is on. Null otherwise. */
  paint: PaintStatus | null;
}

/** Below this fraction of the negotiated rate the shortfall is called out. 0.8
 * clears the jitter of a camera holding its rate and catches a halving. */
const SHORTFALL_RATIO = 0.8;

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
      // The profile by name and by what it negotiated: "camera final 1920x1080@30"
      // on the debug view is a take being made on the visitor's camera. ADR 0021.
      `${stats.view.toUpperCase()} · ${stats.fps.toFixed(0)} fps loop · camera ${stats.mode} ${stats.camera}`,
      `delivering ${stats.capturedFps.toFixed(0)} fps${describeShortfall(stats)}`,
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
    lines.push(describeVoice(stats.voice));
    if (stats.paint !== null) lines.push(describePaint(stats.paint));
    lines.push("D debug · F final · R swap camera · P picture · B paint");

    this.root.textContent = lines.join("\n");
  }

  showError(message: string, hint: string): void {
    this.root.classList.remove("hud--hidden");
    this.root.classList.add("hud--error");
    this.root.textContent = `${message}\n\n${hint}`;
  }
}

/**
 * The camera reports the frame rate it negotiated, not the one it is sending,
 * and the C922 halves the real rate in dim light while still claiming 30. So
 * the shortfall is named here rather than left as two numbers to compare.
 */
function describeShortfall(stats: HudStats): string {
  const claimed = Number(stats.camera.match(/@(\d+)/)?.[1] ?? 0);
  if (claimed === 0 || stats.capturedFps === 0) return "";
  if (stats.capturedFps >= claimed * SHORTFALL_RATIO) return "";
  return ` · CAMERA SHORT of ${claimed} (light? see docs/hardware.md)`;
}

/**
 * One line for the ear. The level matters while tuning the gate, and whether
 * the model is loaded matters the first time somebody says something and
 * nothing happens for forty seconds. See CONFIG.voice.
 */
function describeVoice(voice: VoiceStatus): string {
  if (voice.error !== null) return `ear ${voice.error}`;
  if (!voice.listening) return "ear off";
  const level = `${(voice.level * 100).toFixed(0)}%`;
  if (!voice.ready) return `ear loading · level ${level}`;
  const state = voice.speaking ? "hearing" : voice.pending > 0 ? "thinking" : "listening";
  return (
    `ear ${state} · level ${level}` +
    (voice.lastText === ""
      ? ""
      : ` · ${voice.lastSource === "injected" ? "INJECTED" : "heard"} "${voice.lastText.trim().slice(0, 20)}"`)
  );
}

/**
 * The pinch ratio is the number to watch while tuning CONFIG.paint.pinch: hold
 * the fingers open, then closed, and read where each lands against the two
 * thresholds. "loose" is a line still open with its ink held back: the fingers
 * have left contact and the gate is waiting to see whether they come back.
 */
function describePaint(paint: PaintStatus): string {
  // Both rulers, side by side, while the metric one is on trial. ADR 0021.
  const metres = paint.pinchMetres === null ? "" : ` ${(paint.pinchMetres * 1000).toFixed(0)}mm`;
  const ratio = paint.pinch === null ? "no hand" : `${paint.pinch.toFixed(2)}${metres}`;
  const state = paint.painting
    ? paint.touching
      ? "painting"
      : "loose"
    : paint.pinched
      ? "pinched"
      : "open";
  // A far hand starts its lines on the joints rather than the tips. ADR 0024.
  const far =
    paint.handSize !== null && paint.handSize < CONFIG.paint.pinch.farBelow
      ? ` · far ${paint.handSize.toFixed(2)}`
      : "";
  const tool =
    paint.tool.kind === "erase"
      ? `eraser ${paint.tool.width.toFixed(3)}`
      : `${paint.tool.color} ${paint.tool.width.toFixed(3)}`;
  return `pinch ${ratio} · ${state}${far} · ${tool} · ${paint.strokes} strokes`;
}

function describeFace(face: FaceObservation): string {
  const name = face.identity?.displayName ?? face.trackId;
  if (face.features === null) return `${name} · no features`;

  const { expression, headPose } = face.features;
  const pose = headPose === null ? "no pose" : `yaw ${headPose.yaw.toFixed(0)}°`;
  return `${name} smile ${expression.smile.toFixed(2)} · open ${expression.mouthOpen.toFixed(2)} · brow ${expression.browRaise.toFixed(2)} · ${pose}`;
}
