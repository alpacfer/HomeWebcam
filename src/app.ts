import {
  CameraError,
  type CameraMode,
  describeStream,
  type StationView,
  startCamera,
  stopCamera,
} from "./camera/camera.js";
import { CONFIG } from "./config.js";
import { installDebugBridge, type LoopSnapshot } from "./debug/bridge.js";
import { PuppetController } from "./debug/puppet.js";
import { DebugRecorder, type RecordingDiagnostics, type RecordingTake } from "./debug/recorder.js";
import { httpTaskStore, TaskPanel } from "./debug/tasks.js";
import { type CursorState, HandCursor } from "./interaction/cursor.js";
import { routeUtterance } from "./interaction/voice-commands.js";
import { requireElement } from "./lib/assert.js";
import { FpsMeter, SkippedFrames } from "./lib/fps.js";
import { PerceptionEngine } from "./perception/engine.js";
import type { PerceptionFrame, Utterance } from "./perception/types.js";
import { ExperienceUi } from "./ui/experience.js";
import { Hud } from "./ui/hud.js";
import { fitCanvas, setupMirror } from "./ui/mirror.js";
import { drawOverlay } from "./ui/overlay.js";

/**
 * Wires camera -> perception -> interaction -> render and owns the frame loop.
 *
 * The loop is driven by requestVideoFrameCallback where available, so detectors
 * run once per *camera* frame instead of once per display refresh. On a 30 fps
 * camera and a 60 Hz screen that halves the work for identical results.
 *
 * At 60 fps the whole frame has 16.7 ms. Everything in here that does not have
 * to happen every frame does not: the detectors have their own cadence inside
 * PerceptionEngine, the canvas is only resized when the window is, and the HUD
 * repaints at CONFIG.ui.hudHz. What is left in the hot path is one detector
 * pass and one canvas draw.
 */
export class App {
  private readonly video: HTMLVideoElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly hud: Hud;
  private readonly experience: ExperienceUi;
  /**
   * Records the frames the detectors are given, for a bug report. Not gated on
   * DEV like the rest of src/debug/: it is reachable from debug camera mode in
   * any build the station actually runs. See ADR 0014.
   */
  readonly recorder: DebugRecorder;
  /** The list of things to go and do in front of the camera. See ADR 0015. */
  readonly tasks: TaskPanel;

  private readonly engine = new PerceptionEngine();
  private readonly cursor = new HandCursor();
  private readonly fps = new FpsMeter();
  /** Camera frames per processed frame, so an under-delivering camera is
   * distinguishable from a loop that cannot keep up. */
  private readonly skipped = new SkippedFrames();
  /** Scripted hands, for verification. Inert unless something arms it. */
  readonly puppet = new PuppetController();

  private stream: MediaStream | null = null;
  private source = "starting";
  private running = false;
  /** The camera profile: which resolution and rate the camera is delivering. */
  private mode: CameraMode = CONFIG.ui.defaultCameraMode;
  /**
   * What is on the glass: the visitor's mirror, or the instruments. Normally
   * the same word as `mode`, and deliberately not the same variable, so a take
   * can be recorded on the visitor's camera profile. See StationView.
   */
  private view: StationView = CONFIG.ui.defaultCameraMode;
  private modeChange: Promise<void> = Promise.resolve();
  private loopGeneration = 0;
  private lastHudAt = 0;
  /** When a frame was last processed, for "is this loop alive" questions. */
  private lastFrameAt = 0;
  private lastFrame: PerceptionFrame | null = null;
  private lastCursor: CursorState | null = null;
  /**
   * Why the last mode change did not happen. A failed switch falls back to the
   * working profile and leaves a mirror that looks fine and ignored the key, so
   * the reason has to end up somewhere a person can read it.
   */
  private lastCameraError: string | null = null;
  /**
   * The last thing that was thrown and not caught.
   *
   * An exception inside the frame callback ends the loop: nothing reschedules
   * it, the picture freezes on its last frame, and every meter holds the value
   * it had. From the outside that is indistinguishable from a slow camera,
   * which is how an afternoon gets spent on the wrong thing.
   */
  private lastCrash: string | null = null;

  constructor(root: ParentNode = document) {
    this.video = requireElement(root, "#camera", HTMLVideoElement);
    this.canvas = requireElement(root, "#overlay", HTMLCanvasElement);
    this.hud = new Hud(requireElement(root, "#hud", HTMLElement));
    this.experience = new ExperienceUi(root, () => this.capturePicture());
    this.recorder = new DebugRecorder(root, {
      stream: () => this.stream,
      diagnostics: () => this.recordingDiagnostics(),
      scene: () => this.experience.scene(),
      save: (take) => this.saveRecording(take),
    });
    // The panel drives the recorder and the recorder files what it produced, so
    // one of them has to be built first. The closures are only called later.
    this.tasks = new TaskPanel(root, httpTaskStore(), {
      start: (assignment) => this.recorder.start(assignment),
      stop: () => this.recorder.stop(),
      assignment: () => this.recorder.assignment(),
    });

    const ctx = this.canvas.getContext("2d");
    if (ctx === null) throw new Error("2D canvas context unavailable");
    this.ctx = ctx;
  }

  async start(): Promise<void> {
    setupMirror(this.video);
    this.presentView();
    this.presentMode();
    // Only on resize. The canvas is position:fixed inset:0, so its CSS box
    // cannot change any other way, and fitCanvas reads clientWidth - a forced
    // synchronous layout that has no business in a 60 fps loop.
    window.addEventListener("resize", () => fitCanvas(this.canvas));
    window.addEventListener("keydown", (e) => {
      if (e.repeat) return;
      // d, f, p, b, x and c are letters, and the recorder's dialog has text
      // fields in it. Without this, naming a recording "debug flicker" reopens
      // the camera twice and fires the shutter.
      if (isTextEntry(e.target)) return;
      const key = e.key.toLowerCase();
      if (key === "d" || key === "f") {
        e.preventDefault();
        const chosen = key === "d" ? "debug" : "final";
        this.setView(chosen);
        this.requestMode(chosen);
      } else if (key === "r") {
        // The other camera profile, same view: this is how the debug surface
        // gets to look at, and record, the 1080p the visitor gets. ADR 0021.
        e.preventDefault();
        this.requestMode(this.mode === "debug" ? "final" : "debug");
      } else if (key === "p") {
        this.experience.enterPicture();
      } else if (key === "b") {
        this.experience.enterPaint();
      } else if (key === "x") {
        this.experience.clearPainting();
      } else if (key === "c") {
        this.experience.requestCapture(performance.now());
      }
    });

    window.addEventListener("error", (event) => {
      this.lastCrash = `${event.message} (${event.filename}:${event.lineno})`;
    });
    window.addEventListener("unhandledrejection", (event) => {
      const reason: unknown = event.reason;
      this.lastCrash = reason instanceof Error ? reason.message : String(reason);
    });

    try {
      this.stream = await startCamera(this.video, this.mode);
      this.source = describeStream(this.stream, this.mode);
      await this.engine.init();
    } catch (error) {
      if (error instanceof CameraError) {
        this.hud.showError(error.message, error.hint);
      } else {
        this.hud.showError(
          error instanceof Error ? error.message : String(error),
          "See the browser console for the full stack.",
        );
      }
      throw error;
    }

    fitCanvas(this.canvas);
    this.watchStream(this.stream);
    // Dev only: the station's debug surface, and the door the puppet comes in
    // through. Stripped from a production build. See src/debug/bridge.ts.
    if (import.meta.env.DEV) installDebugBridge(this);
    document.body.classList.add("is-live");
    this.running = true;
    this.startFrameLoop();
  }

  stop(): void {
    this.running = false;
    this.loopGeneration++;
    this.recorder.cameraChanging();
    this.engine.close();
    stopCamera(this.stream);
    this.stream = null;
  }

  private startFrameLoop(): void {
    this.loopGeneration++;
    this.scheduleFrame(this.loopGeneration);
  }

  private scheduleFrame(generation: number): void {
    if (!this.running || generation !== this.loopGeneration) return;
    const withVideoCallback = this.video as HTMLVideoElement & {
      requestVideoFrameCallback?: (
        cb: (now: number, metadata: { presentedFrames: number }) => void,
      ) => number;
    };
    if (typeof withVideoCallback.requestVideoFrameCallback === "function") {
      withVideoCallback.requestVideoFrameCallback((now, metadata) =>
        this.onFrame(now, generation, metadata.presentedFrames),
      );
    } else {
      // The fallback has no frame count, so it cannot report skipped frames.
      requestAnimationFrame((now) => this.onFrame(now, generation, null));
    }
  }

  private onFrame(now: number, generation: number, presentedFrames: number | null): void {
    try {
      this.processFrame(now, generation, presentedFrames);
    } catch (error) {
      // The loop outlives a bad frame. Whatever threw is recorded and the next
      // frame is scheduled anyway: a station that goes black because one draw
      // failed is worse than one that draws the next frame.
      this.lastCrash = error instanceof Error ? error.message : String(error);
      console.error(error);
      this.scheduleFrame(generation);
    }
  }

  private processFrame(now: number, generation: number, presentedFrames: number | null): void {
    if (generation !== this.loopGeneration) return;
    if (presentedFrames !== null) this.skipped.tick(presentedFrames);
    // A puppet replaces the detectors outright rather than merging with them:
    // half-real hands would be the one kind of evidence worse than none.
    const frame = this.puppet.active
      ? // A puppet replaces the hands. The ear is a separate sense and keeps
        // working, so a spoken "stop" still stops a scripted run.
        withHeard(
          this.puppet.frame(now, window.innerWidth / window.innerHeight),
          this.engine.hear(),
        )
      : this.engine.step(this.video, now, {
          faces: !(CONFIG.faces.offWhilePainting && this.experience.painting),
        });
    if (frame !== null) {
      this.fps.tick(now);
      this.lastFrameAt = performance.now();
      const cursor = this.experience.update(frame, this.cursor.update(frame));
      this.lastFrame = frame;
      this.lastCursor = cursor;
      // Sampled before the words are acted on, so the take that a spoken "stop"
      // ends has that word in its own trace.
      this.recorder.sample(frame, cursor);
      for (const utterance of frame.heard) this.onHeard(utterance);
      const showDebug = this.view === "debug";
      drawOverlay(this.ctx, frame, cursor, showDebug, this.experience.brush());

      if (showDebug && frame.t - this.lastHudAt >= 1000 / CONFIG.ui.hudHz) {
        this.lastHudAt = frame.t;
        this.recorder.setVoice(this.engine.voice);
        this.hud.render(frame, cursor, {
          mode: this.mode,
          view: this.view,
          fps: this.fps.fps,
          capturedFps: this.capturedFps,
          camera: this.source,
          timings: this.engine.detectorTimings,
          voice: this.engine.voice,
          paint: this.experience.paintStatus(),
        });
      }
    }
    this.scheduleFrame(generation);
  }

  /**
   * Unplugging the camera ends its track. Nothing else notices: the video
   * element keeps its last dimensions, `paused` stays false, and
   * requestVideoFrameCallback simply stops firing, so the loop goes quiet with
   * a black screen and no error. This station lives in a hallway, where a black
   * mirror that says nothing is indistinguishable from a broken one.
   */
  private watchStream(stream: MediaStream): void {
    const track = stream.getVideoTracks()[0];
    if (track === undefined) return;
    track.addEventListener("ended", () => {
      // A mode change stops the old track deliberately; that is not a loss.
      if (this.stream !== stream) return;
      this.onCameraLost();
    });
  }

  private onCameraLost(): void {
    this.running = false;
    this.loopGeneration++;
    // Whatever was recorded up to the moment the camera went is worth keeping:
    // it is the footage of the thing that just failed.
    this.recorder.cameraChanging();
    this.source = "disconnected";
    document.body.classList.remove("is-live");
    // showError un-hides the HUD, so this reaches a visitor in final mode too.
    this.hud.showError(
      "The camera stopped.",
      "Check that it is plugged in, then reopen the mirror. If it was just moved to another port, the browser needs to ask for it again.",
    );
  }

  /**
   * What the camera actually delivers, as opposed to what it claims.
   *
   * getSettings() reports the negotiated frame rate, which the C922 keeps
   * saying is 30 while auto-exposure quietly halves it. Processed fps times
   * camera frames per processed frame recovers the real delivery rate.
   */
  private get capturedFps(): number {
    return this.fps.fps * this.skipped.framesPerProcessed;
  }

  /** Switches the camera profile. The debug bridge's door too; see StationView. */
  requestMode(mode: CameraMode): void {
    // Serializing keeps a quick D/F sequence deterministic even while the
    // hardware is still completing the first format change.
    this.modeChange = this.modeChange
      .then(async () => {
        if (mode === this.mode || this.stream === null) return;
        const previousMode = this.mode;
        this.recorder.cameraChanging();
        this.loopGeneration++;
        stopCamera(this.stream);
        this.stream = null;
        this.video.srcObject = null;

        try {
          this.stream = await startCamera(this.video, mode);
        } catch (error) {
          // The old track has to close before the exclusive camera can reopen.
          // If the requested profile fails, restore the working profile so a
          // mistyped key cannot leave the station with a black mirror.
          this.stream = await startCamera(this.video, previousMode);
          this.source = describeStream(this.stream, previousMode);
          this.startFrameLoop();
          throw error;
        }

        this.mode = mode;
        this.lastCameraError = null;
        this.source = describeStream(this.stream, mode);
        this.watchStream(this.stream);
        this.presentMode();
        this.startFrameLoop();
      })
      .catch((error: unknown) => {
        this.lastCameraError = `${mode}: ${error instanceof Error ? error.message : String(error)}`;
        console.error(error);
      });
  }

  /** Puts the instruments on the glass, or takes them off. */
  setView(view: StationView): void {
    if (view === this.view) return;
    this.view = view;
    this.presentView();
  }

  private presentMode(): void {
    // For the CLI, which waits on it after a keystroke. No stylesheet rule
    // reads it any more: everything that moves on screen is keyed on the view.
    document.body.dataset.cameraMode = this.mode;
    // A profile change swaps the video element's picture, so anything holding
    // measured hit rectangles has to hear about it. See friction 0026.
    this.experience.relayout();
  }

  private presentView(): void {
    document.body.dataset.view = this.view;
    // The view is on the body, so stylesheet rules keyed on it have just
    // changed where things are. See friction 0026.
    this.experience.relayout();
    const debug = this.view === "debug";
    this.hud.setVisible(debug);
    this.recorder.setVisible(debug);
    this.tasks.setVisible(debug);
    // The mirror does not listen to the hallway. See ADR 0016.
    this.engine.listen(debug);
  }

  /** Tells the ear it heard something. The debug bridge's door. See ADR 0016. */
  say(text: string): void {
    this.engine.say(text);
  }

  /** Everything the frame loop knows, for the debug bridge. Dev only. */
  loop(): LoopSnapshot {
    return {
      live: this.running,
      voice: this.engine.voice,
      cameraMode: this.mode,
      view: this.view,
      cameraSource: this.source,
      // Both meters hold a rolling average that never decays, so a dead loop
      // would keep reporting the rate it managed before it died.
      fps: this.running ? this.fps.fps : 0,
      capturedFps: this.running ? this.capturedFps : 0,
      sinceLastFrameMs: this.lastFrameAt === 0 ? -1 : performance.now() - this.lastFrameAt,
      timings: this.engine.detectorTimings,
      error: this.lastCameraError,
      crash: this.lastCrash,
      frame: this.lastFrame,
      cursor: this.lastCursor,
      paint: this.experience.paintStatus(),
    };
  }

  /**
   * Something was said. While a dialog is waiting for words it is words;
   * otherwise it is the one command this station has. See ADR 0016.
   */
  private onHeard(utterance: Utterance): void {
    const action = routeUtterance(utterance, {
      dictating: this.recorder.dictating,
      recording: this.recorder.recording,
    });
    if (action.kind === "dictate") this.recorder.dictate(action.text);
    else if (action.kind === "stop") this.recorder.stop();
  }

  private recordingDiagnostics(): RecordingDiagnostics {
    return {
      cameraMode: this.mode,
      view: this.view,
      cameraSource: this.source,
      video: { width: this.video.videoWidth, height: this.video.videoHeight },
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio,
      },
      perceptionSource: this.puppet.active ? "puppet" : "camera",
      fps: this.running ? this.fps.fps : 0,
      capturedFps: this.running ? this.capturedFps : 0,
      detectors: this.engine.detectorTimings,
      cameraError: this.lastCameraError,
    };
  }

  /**
   * Writes a debug recording to the station's own disk, in two posts: the
   * manifest first, then the video against the name the server gave it back.
   *
   * Manifest first because it is the half that survives a failure usefully. If
   * the video upload dies, what is left on disk still says what was being
   * recorded, when, on which camera mode, and what the models reported - and
   * the browser still holds the take. The other order leaves an unlabelled
   * video of somebody in a hallway, which is the one artifact this project must
   * not produce. See ADR 0014.
   */
  private async saveRecording(take: RecordingTake): Promise<string> {
    const manifest = await fetch("/api/recordings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(take.manifest),
    });
    if (!manifest.ok) throw new Error(`recording server returned ${manifest.status}`);
    const named = (await manifest.json()) as { stem?: unknown };
    if (typeof named.stem !== "string") throw new Error("recording server response was invalid");

    const video = await fetch("/api/recordings", {
      method: "POST",
      headers: {
        "Content-Type": take.video.type === "" ? "video/webm" : take.video.type,
        "X-Recording-Stem": named.stem,
      },
      body: take.video,
    });
    if (!video.ok) throw new Error(`recording server returned ${video.status} for the video`);
    const saved = (await video.json()) as { filename?: unknown };
    if (typeof saved.filename !== "string")
      throw new Error("recording server response was invalid");
    console.info(`[HomeWebcam] saved recordings/${saved.filename}`);

    // A take that answers a task is filed against the step that asked for it,
    // after the video is safely on disk and never before: a run pointing at a
    // recording that failed to save is worse than no run at all.
    if (take.assignment !== null) {
      await this.tasks.attach(take.assignment, {
        recording: saved.filename.replace(/\.webm$/, ""),
        note: take.description,
        perceptionSource: take.manifest.perception.source,
        digest: take.digest,
      });
    }
    return saved.filename;
  }

  private async capturePicture(): Promise<string> {
    const width = this.video.videoWidth;
    const height = this.video.videoHeight;
    if (width === 0 || height === 0) throw new Error("Camera frame is not ready");

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (ctx === null) throw new Error("Capture canvas is unavailable");

    if (CONFIG.ui.mirrored) {
      ctx.translate(width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(this.video, 0, 0, width, height);

    const png = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob === null ? reject(new Error("PNG encoding failed")) : resolve(blob)),
        "image/png",
      );
    });
    const response = await fetch("/api/captures", {
      method: "POST",
      headers: { "Content-Type": "image/png" },
      body: png,
    });
    if (!response.ok) throw new Error(`Capture server returned ${response.status}`);
    const result = (await response.json()) as { filename?: unknown };
    if (typeof result.filename !== "string") throw new Error("Capture server response was invalid");
    return result.filename;
  }
}

/** The puppet's frame, plus anything the real ear heard while it was driving. */
function withHeard(frame: PerceptionFrame | null, heard: Utterance[]): PerceptionFrame | null {
  return frame === null ? null : { ...frame, heard };
}

/**
 * A keystroke inside a text field belongs to the field. The station's single-key
 * shortcuts are letters, so without this, typing a name into the recorder's
 * dialog drives the app.
 */
function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}
