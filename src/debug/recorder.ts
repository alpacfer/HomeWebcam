import { CONFIG } from "../config.js";
import type { CursorState } from "../interaction/cursor.js";
import { requireElement } from "../lib/assert.js";
import type { DetectorTimings } from "../perception/engine.js";
import type { PerceptionFrame, Vec2 } from "../perception/types.js";
import type { TaskAssignment } from "./tasks.js";
import { digestTrace, type SceneSample, type TraceDigest, type TraceSample } from "./trace.js";

/**
 * Records what the perception models were given, for a bug report.
 *
 * The video is the camera stream itself - the same frames `detectForVideo` is
 * handed - not a capture of the screen. A screen recording shows the symptom;
 * this shows the input that produced it, so the take can be replayed against a
 * changed detector afterwards. It is therefore *unmirrored*, because that is
 * how the models see it: the x flip happens inside the detectors, one layer
 * later. See ADR 0004 and ADR 0014.
 *
 * Beside the video goes a manifest: the name and description whoever hit stop
 * typed, the camera mode and what it actually negotiated, the loop's frame rate
 * while the take ran, the whole of CONFIG, every error the page threw, and a
 * per-frame trace of what the models said and where the interface was. Without
 * the trace a recording can only show that something looked wrong; with it,
 * "the hand was there and the gesture came back None" is a thing the file
 * itself states.
 *
 * A take can be answering a task (see ./tasks.ts), in which case it already
 * knows its own name and the dialog only asks what happened.
 *
 * Debug camera mode only, and it is the reason the mouse pointer exists there
 * at all: a station driven by hands has no way to press a button in a corner.
 */

/** What was true of the run when a take started. Supplied by the app. */
export interface RecordingDiagnostics {
  cameraMode: string;
  /** What the camera actually negotiated. See describeStream(). */
  cameraSource: string;
  /** Native size of the frames the detectors receive. */
  video: { width: number; height: number };
  /** The window the interface was laid out in. Cursor coordinates are of it. */
  viewport: { width: number; height: number; devicePixelRatio: number };
  /** "puppet" means the hands in the trace were invented. See ADR 0011. */
  perceptionSource: "camera" | "puppet";
  /** Frames the loop processes per second. */
  fps: number;
  /** Frames the camera delivers per second, measured rather than negotiated. */
  capturedFps: number;
  detectors: DetectorTimings;
  /** Why the last camera mode change failed, if it did. */
  cameraError: string | null;
}

/** Anything the page threw while the take was running. */
export interface RecordedError {
  ms: number;
  message: string;
  source: "error" | "unhandledrejection";
}

export interface RecordingManifest {
  name: string;
  description: string;
  recordedAt: string;
  durationMs: number;
  /** The step this take was recorded to answer, if it was asked for. */
  task: TaskAssignment | null;
  video: {
    mimeType: string;
    bytes: number;
    width: number;
    height: number;
    /** Always false: this is the camera image as the models receive it. */
    mirrored: boolean;
  };
  viewport: { width: number; height: number; devicePixelRatio: number };
  camera: { mode: string; source: string; error: string | null };
  /** Whether recording cost the loop frames is the first thing a reader asks. */
  health: {
    fpsAtStart: number;
    fpsWhileRecording: Spread;
    capturedFpsWhileRecording: Spread;
    detectorsAtStart: DetectorTimings;
  };
  perception: { source: "camera" | "puppet"; samples: number };
  /** The trace in numbers, so a run can be read without opening the trace. */
  digest: TraceDigest;
  errors: RecordedError[];
  /** Every threshold that produced the behaviour in the video. */
  config: typeof CONFIG;
  userAgent: string;
  trace: TraceSample[];
}

export interface Spread {
  min: number;
  median: number;
  max: number;
}

export interface RecordingTake {
  name: string;
  description: string;
  video: Blob;
  /** Null unless the take was recorded against a task step. */
  assignment: TaskAssignment | null;
  digest: TraceDigest;
  manifest: RecordingManifest;
}

export interface RecorderHost {
  /** The exact stream the detectors are reading. Null before the camera opens. */
  stream(): MediaStream | null;
  diagnostics(): RecordingDiagnostics;
  /** Where the interface is, this frame. Only asked for while recording. */
  scene(): SceneSample;
  /** Writes the take locally. Resolves with the filename it landed under. */
  save(take: RecordingTake): Promise<string>;
}

export type RecorderPhase =
  | "unsupported"
  | "idle"
  | "recording"
  | "naming"
  | "saving"
  | "saved"
  | "error";

/** Everything the station's debug snapshot reports about the recorder. */
export interface RecorderState {
  phase: RecorderPhase;
  visible: boolean;
  elapsedMs: number;
  samples: number;
  /** The task step this take is answering, if any. */
  task: TaskAssignment | null;
  lastSaved: string | null;
  error: string | null;
}

/** Trace coordinates are normalized, so four decimals is a tenth of a pixel. */
const TRACE_DECIMALS = 4;

export class DebugRecorder {
  private readonly root: HTMLElement;
  private readonly toggle: HTMLButtonElement;
  private readonly ring: HTMLElement;
  private readonly readout: HTMLElement;
  private readonly dialog: HTMLDialogElement;
  private readonly form: HTMLFormElement;
  private readonly title: HTMLElement;
  private readonly summary: HTMLElement;
  private readonly askedFor: HTMLElement;
  private readonly nameRow: HTMLElement;
  private readonly nameField: HTMLInputElement;
  private readonly descriptionLabel: HTMLElement;
  private readonly descriptionField: HTMLTextAreaElement;
  private readonly errorText: HTMLElement;
  private readonly listening: HTMLElement;
  private readonly discardButton: HTMLButtonElement;

  private phase: RecorderPhase = "idle";
  private visible = false;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private trace: TraceSample[] = [];
  private errors: RecordedError[] = [];
  private startedAt = 0;
  private startedWall = 0;
  private startDiagnostics: RecordingDiagnostics | null = null;
  private fpsSamples: number[] = [];
  private capturedFpsSamples: number[] = [];
  private ticker: ReturnType<typeof setInterval> | null = null;
  private pending: { video: Blob; durationMs: number } | null = null;
  private task: TaskAssignment | null = null;
  private lastSaved: string | null = null;
  private lastError: string | null = null;

  private readonly onWindowError = (event: ErrorEvent): void =>
    this.noteError(event.message, "error");
  private readonly onRejection = (event: PromiseRejectionEvent): void =>
    this.noteError(describeReason(event.reason), "unhandledrejection");

  constructor(
    root: ParentNode,
    private readonly host: RecorderHost,
  ) {
    this.root = requireElement(root, "#recorder", HTMLElement);
    this.toggle = requireElement(root, "#recorder-toggle", HTMLButtonElement);
    this.ring = requireElement(root, "#recorder-ring", HTMLElement);
    this.readout = requireElement(root, "#recorder-readout", HTMLElement);
    this.dialog = requireElement(root, "#recorder-dialog", HTMLDialogElement);
    this.form = requireElement(root, "#recorder-form", HTMLFormElement);
    this.title = requireElement(root, "#recorder-title", HTMLElement);
    this.summary = requireElement(root, "#recorder-summary", HTMLElement);
    this.askedFor = requireElement(root, "#recorder-asked-for", HTMLElement);
    this.nameRow = requireElement(root, "#recorder-name-row", HTMLElement);
    this.nameField = requireElement(root, "#recorder-name", HTMLInputElement);
    this.descriptionLabel = requireElement(root, "#recorder-description-label", HTMLElement);
    this.descriptionField = requireElement(root, "#recorder-description", HTMLTextAreaElement);
    this.errorText = requireElement(root, "#recorder-error", HTMLElement);
    this.listening = requireElement(root, "#recorder-listening", HTMLElement);
    this.discardButton = requireElement(root, "#recorder-discard", HTMLButtonElement);

    this.toggle.addEventListener("click", () => this.onToggle());
    this.form.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.saveTake();
    });
    this.discardButton.addEventListener("click", () => this.discard());
    // Escape closes a modal dialog on its own; a discarded take must not leave
    // the recorder stuck in "naming" with a blob nobody can reach.
    this.dialog.addEventListener("cancel", () => this.discard());

    if (typeof MediaRecorder === "undefined") this.setPhase("unsupported");
    this.setVisible(false);
    this.present();
  }

  get state(): RecorderState {
    return {
      phase: this.phase,
      visible: this.visible,
      elapsedMs: this.elapsedMs(),
      samples: this.trace.length,
      task: this.task,
      lastSaved: this.lastSaved,
      error: this.lastError,
    };
  }

  get recording(): boolean {
    return this.phase === "recording";
  }

  /** The step a running take is answering. Null when it is answering nothing. */
  assignment(): TaskAssignment | null {
    return this.phase === "recording" ? this.task : null;
  }

  /** Debug camera mode only: in final mode there is no pointer to press it. */
  setVisible(visible: boolean): void {
    this.visible = visible;
    this.root.classList.toggle("recorder--hidden", !visible);
    // Hidden and inert, not merely invisible: nothing a visitor could tab into.
    this.root.setAttribute("aria-hidden", String(!visible));
    this.toggle.disabled = !visible || this.phase === "unsupported";
  }

  start(assignment: TaskAssignment | null = null): void {
    if (this.phase === "unsupported") throw new Error("MediaRecorder is unavailable");
    if (this.phase === "recording") return;
    if (this.phase === "naming" || this.phase === "saving") {
      throw new Error("finish the take that is waiting for a name first");
    }
    const stream = this.host.stream();
    if (stream === null) throw new Error("the camera is not open");

    const mimeType = CONFIG.recording.mimeTypes.find((type) => MediaRecorder.isTypeSupported(type));
    if (mimeType === undefined) throw new Error("this browser records none of the WebM profiles");

    const recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: CONFIG.recording.videoBitsPerSecond,
    });
    recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) this.chunks.push(event.data);
    });
    recorder.addEventListener("stop", () => this.onRecorderStopped());
    recorder.addEventListener("error", () => this.fail("the browser stopped recording"));

    this.recorder = recorder;
    this.chunks = [];
    this.trace = [];
    this.errors = [];
    this.fpsSamples = [];
    this.capturedFpsSamples = [];
    this.task = assignment;
    this.startDiagnostics = this.host.diagnostics();
    this.startedAt = performance.now();
    this.startedWall = Date.now();
    this.lastError = null;
    this.lastSaved = null;
    // A timeslice hands the take over as it goes instead of assembling every
    // frame of it at stop, which is what a 30 s take at 8 Mb/s would otherwise
    // do in one allocation.
    recorder.start(1000);
    this.setPhase("recording");
    // A page that throws during a take is reporting on the take. Listeners
    // rather than a patched console: nothing else in the app is disturbed.
    window.addEventListener("error", this.onWindowError);
    window.addEventListener("unhandledrejection", this.onRejection);

    // On a wall clock, not the frame loop: a take has to end at 30 seconds even
    // if the thing being debugged is the loop having stopped delivering frames.
    this.ticker = setInterval(() => this.tick(), CONFIG.recording.healthSampleMs);
    this.present();
  }

  stop(): void {
    if (this.phase !== "recording" || this.recorder === null) return;
    // stop() delivers the buffered remainder as a last dataavailable before it
    // fires stop, so the tail of the take is already in hand by then.
    this.recorder.stop();
  }

  /**
   * The camera is about to be closed or replaced. A take may not span two
   * negotiated formats: half of it would be a different picture at a different
   * rate, and the manifest could only describe one of them.
   */
  cameraChanging(): void {
    if (this.phase === "recording") this.stop();
  }

  /** One processed frame. Called from the frame loop while a take is running. */
  sample(frame: PerceptionFrame, cursor: CursorState): void {
    if (this.phase !== "recording") return;
    this.trace.push({
      ms: round(frame.t - this.startedAt, 1),
      seq: frame.seq,
      hands: frame.hands.map((hand) => ({
        side: hand.side,
        gesture: hand.gesture,
        confidence: round(hand.gestureConfidence, TRACE_DECIMALS),
        indexTip: roundVec(hand.indexTip),
        palmCenter: roundVec(hand.palmCenter),
        landmarks: hand.landmarks.map(roundVec),
      })),
      // Boxes and track ids only. The 478-point mesh is 60 times a second of
      // data that nothing outside the overlay reads, and it would make the
      // manifest larger than the video it describes.
      faces: frame.faces.map((face) => ({
        trackId: face.trackId,
        box: {
          x: round(face.box.x, TRACE_DECIMALS),
          y: round(face.box.y, TRACE_DECIMALS),
          width: round(face.box.width, TRACE_DECIMALS),
          height: round(face.box.height, TRACE_DECIMALS),
        },
        confidence: round(face.confidence, TRACE_DECIMALS),
      })),
      cursor: {
        position: cursor.position === null ? null : roundVec(cursor.position),
        dwell: round(cursor.dwellProgress, TRACE_DECIMALS),
        activated: cursor.activated,
        gesture: cursor.gesture,
      },
      // Where the targets were, not just where the finger was. "I pointed at
      // the tile and nothing happened" is only answerable with both.
      scene: roundScene(this.host.scene()),
      heard: frame.heard.map((utterance) => ({
        text: utterance.text,
        source: utterance.source,
      })),
    });
  }

  /** Fills in the dialog and saves, for the station CLI. See scripts/station.mjs. */
  async saveWith(name: string, description: string): Promise<string> {
    if (this.phase !== "naming") throw new Error(`nothing to save (recorder is ${this.phase})`);
    if (this.task === null) this.nameField.value = name;
    this.descriptionField.value = description;
    return this.saveTake();
  }

  /** True while a dialog is waiting for words, so speech is text rather than a command. */
  get dictating(): boolean {
    return this.phase === "naming";
  }

  /**
   * Writes something that was said into the description.
   *
   * Always the description, never the field that happens to have focus. The
   * dialog focuses the name so it can be typed, so "whichever has focus" put
   * whole spoken sentences into a sixty-character filename. The name is a
   * label you type; the description is the thing worth saying out loud, and for
   * a task take there is no name to fill in at all. See ADR 0016.
   */
  dictate(text: string): void {
    if (!this.dictating) return;
    const field = this.descriptionField;
    const existing = field.value.trim();
    field.value = existing === "" ? text : `${existing} ${text}`;
    field.setSelectionRange(field.value.length, field.value.length);
  }

  /** What the ear is doing, so the dialog can say it is listening. */
  setVoice(voice: { ready: boolean; speaking: boolean }): void {
    this.listening.hidden = !voice.ready || !this.dictating;
    this.listening.dataset.speaking = String(voice.speaking);
  }

  discard(): void {
    if (this.phase !== "naming" && this.phase !== "error") return;
    this.pending = null;
    this.trace = [];
    this.task = null;
    this.closeDialog();
    this.setPhase("idle");
    this.present();
  }

  private onToggle(): void {
    try {
      if (this.phase === "recording") this.stop();
      else this.start();
    } catch (error) {
      this.fail(error instanceof Error ? error.message : String(error));
    }
  }

  private tick(): void {
    const health = this.host.diagnostics();
    this.fpsSamples.push(health.fps);
    this.capturedFpsSamples.push(health.capturedFps);
    if (this.elapsedMs() >= CONFIG.recording.maxMs) this.stop();
    this.present();
  }

  private noteError(message: string, source: RecordedError["source"]): void {
    if (this.phase !== "recording") return;
    this.errors.push({ ms: round(performance.now() - this.startedAt, 1), message, source });
  }

  private onRecorderStopped(): void {
    const durationMs = this.elapsedMs();
    this.stopTicker();
    window.removeEventListener("error", this.onWindowError);
    window.removeEventListener("unhandledrejection", this.onRejection);
    const mimeType = this.recorder?.mimeType ?? "video/webm";
    this.recorder = null;
    const video = new Blob(this.chunks, { type: mimeType });
    this.chunks = [];
    this.pending = { video, durationMs };
    this.setPhase("naming");
    this.present();
    this.openDialog(durationMs, video.size);
  }

  private async saveTake(): Promise<string> {
    const pending = this.pending;
    if (pending === null) throw new Error("no take is waiting to be saved");
    const name = this.task === null ? this.nameField.value.trim() : nameFor(this.task);
    if (name === "") {
      this.showDialogError("Give it a name.");
      throw new Error("a recording needs a name");
    }

    const assignment = this.task;
    this.setPhase("saving");
    this.present();
    try {
      const digest = digestTrace(this.trace);
      const filename = await this.host.save({
        name,
        description: this.descriptionField.value.trim(),
        video: pending.video,
        assignment,
        digest,
        manifest: this.buildManifest(name, pending, digest),
      });
      this.pending = null;
      this.trace = [];
      this.task = null;
      this.lastSaved = filename;
      this.closeDialog();
      this.setPhase("saved");
      this.present();
      return filename;
    } catch (error) {
      // The take is kept: a failed write is exactly when losing it hurts most.
      this.setPhase("naming");
      const message = error instanceof Error ? error.message : String(error);
      this.lastError = message;
      this.showDialogError(`Could not save: ${message}`);
      this.present();
      throw error;
    }
  }

  private buildManifest(
    name: string,
    pending: { video: Blob; durationMs: number },
    digest: TraceDigest,
  ): RecordingManifest {
    const start = this.startDiagnostics ?? this.host.diagnostics();
    return {
      name,
      description: this.descriptionField.value.trim(),
      recordedAt: new Date(this.startedWall).toISOString(),
      durationMs: Math.round(pending.durationMs),
      task: this.task,
      video: {
        mimeType: pending.video.type,
        bytes: pending.video.size,
        width: start.video.width,
        height: start.video.height,
        // The camera image, as the detectors get it. See ADR 0004.
        mirrored: false,
      },
      viewport: start.viewport,
      camera: { mode: start.cameraMode, source: start.cameraSource, error: start.cameraError },
      health: {
        fpsAtStart: round(start.fps, 1),
        fpsWhileRecording: spread(this.fpsSamples),
        capturedFpsWhileRecording: spread(this.capturedFpsSamples),
        detectorsAtStart: start.detectors,
      },
      perception: { source: start.perceptionSource, samples: this.trace.length },
      digest,
      errors: this.errors,
      config: CONFIG,
      userAgent: navigator.userAgent,
      trace: this.trace,
    };
  }

  private openDialog(durationMs: number, bytes: number): void {
    const task = this.task;
    this.errorText.hidden = true;
    this.title.textContent = task === null ? "Debug recording" : `Task · ${task.taskTitle}`;
    this.askedFor.textContent = task === null ? "" : `${task.stepNumber}. ${task.instruction}`;
    this.askedFor.hidden = task === null;
    // A take answering a task already has its name. Asking for one again would
    // be asking the person to retype what the task said.
    this.nameRow.hidden = task !== null;
    this.descriptionLabel.textContent = task === null ? "What to look for" : "What happened?";
    this.summary.textContent =
      `${(durationMs / 1000).toFixed(1)} s · ${(bytes / 1024 / 1024).toFixed(1)} MB · ` +
      `${this.trace.length} perception frames`;
    this.nameField.value = "";
    this.descriptionField.value = "";
    // showModal is what puts it in the top layer; happy-dom and any browser
    // without it still get a usable dialog from the open attribute.
    if (typeof this.dialog.showModal === "function") this.dialog.showModal();
    else this.dialog.setAttribute("open", "");
    if (task === null) this.nameField.focus();
    else this.descriptionField.focus();
  }

  private closeDialog(): void {
    this.errorText.hidden = true;
    this.listening.hidden = true;
    // Focus must leave the fields before they are hidden. app.ts treats a
    // keystroke inside a text field as typing, so a field that keeps focus
    // after the dialog closes swallows every d/f/p/c the station has.
    this.nameField.blur();
    this.descriptionField.blur();
    if (typeof this.dialog.close === "function") this.dialog.close();
    else this.dialog.removeAttribute("open");
  }

  private showDialogError(message: string): void {
    this.errorText.textContent = message;
    this.errorText.hidden = false;
  }

  private fail(message: string): void {
    this.stopTicker();
    window.removeEventListener("error", this.onWindowError);
    window.removeEventListener("unhandledrejection", this.onRejection);
    this.recorder = null;
    this.lastError = message;
    this.setPhase("error");
    this.present();
  }

  private stopTicker(): void {
    if (this.ticker !== null) clearInterval(this.ticker);
    this.ticker = null;
  }

  private elapsedMs(): number {
    return this.phase === "recording" ? performance.now() - this.startedAt : this.lastDuration();
  }

  private lastDuration(): number {
    return this.pending?.durationMs ?? 0;
  }

  private setPhase(phase: RecorderPhase): void {
    this.phase = phase;
    // Mirrored onto the body so the station can wait for a phase instead of
    // sleeping, the way the picture flow does. See friction 0006.
    document.body.dataset.recorderPhase = phase;
  }

  /** Writes the phase onto the control: the dot, the ring and the readout. */
  private present(): void {
    const elapsed = this.elapsedMs();
    this.root.dataset.phase = this.phase;
    this.toggle.disabled = !this.visible || this.phase === "unsupported";
    this.ring.style.setProperty(
      "--progress",
      (this.phase === "recording" ? Math.min(1, elapsed / CONFIG.recording.maxMs) : 0).toFixed(3),
    );
    const readout = this.readoutText(elapsed);
    this.readout.textContent = readout;
    // The readout is clipped to keep the control off the mirror; the pointer
    // that debug mode provides can still get at the whole of it.
    this.readout.title = readout;
    this.toggle.setAttribute(
      "aria-label",
      this.phase === "recording" ? "Stop the debug recording" : "Record a debug video",
    );
  }

  private readoutText(elapsed: number): string {
    switch (this.phase) {
      case "unsupported":
        return "no recorder";
      case "recording":
        return this.task === null
          ? `${clock(elapsed)} / ${clock(CONFIG.recording.maxMs)}`
          : `step ${this.task.stepNumber} · ${clock(elapsed)}`;
      case "naming":
        return this.task === null ? "name it" : "what happened?";
      case "saving":
        return "saving";
      case "saved":
        return this.lastSaved ?? "saved";
      case "error":
        return this.lastError ?? "failed";
      default:
        return "debug video";
    }
  }
}

/** The name a task's take files itself under. The server slugifies it. */
export function nameFor(task: TaskAssignment): string {
  return `${task.taskTitle} step ${task.stepNumber}`;
}

function describeReason(reason: unknown): string {
  if (reason instanceof Error) return `${reason.name}: ${reason.message}`;
  return String(reason);
}

function clock(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function round(value: number, decimals: number): number {
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
}

function roundVec(point: Vec2): Vec2 {
  return { x: round(point.x, TRACE_DECIMALS), y: round(point.y, TRACE_DECIMALS) };
}

function roundScene(scene: SceneSample): SceneSample {
  return {
    mode: scene.mode,
    phase: scene.phase,
    menu: {
      hovered: scene.menu.hovered,
      panels: scene.menu.panels.map((panel) => ({
        id: panel.id,
        rect: {
          x: round(panel.rect.x, TRACE_DECIMALS),
          y: round(panel.rect.y, TRACE_DECIMALS),
          width: round(panel.rect.width, TRACE_DECIMALS),
          height: round(panel.rect.height, TRACE_DECIMALS),
        },
        glow: round(panel.glow, 3),
      })),
    },
  };
}

/** Min, median and max of a sample set, so a dip during a take is visible. */
function spread(samples: number[]): Spread {
  if (samples.length === 0) return { min: 0, median: 0, max: 0 };
  const sorted = [...samples].sort((a, b) => a - b);
  const middle = sorted[Math.floor(sorted.length / 2)] ?? 0;
  return {
    min: round(sorted[0] ?? 0, 1),
    median: round(middle, 1),
    max: round(sorted[sorted.length - 1] ?? 0, 1),
  };
}
