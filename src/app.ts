import {
  CameraError,
  type CameraMode,
  describeStream,
  startCamera,
  stopCamera,
} from "./camera/camera.js";
import { CONFIG } from "./config.js";
import { installDebugBridge, type LoopSnapshot } from "./debug/bridge.js";
import { PuppetController } from "./debug/puppet.js";
import { type CursorState, HandCursor } from "./interaction/cursor.js";
import { requireElement } from "./lib/assert.js";
import { FpsMeter } from "./lib/fps.js";
import { PerceptionEngine } from "./perception/engine.js";
import type { PerceptionFrame } from "./perception/types.js";
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

  private readonly engine = new PerceptionEngine();
  private readonly cursor = new HandCursor();
  private readonly fps = new FpsMeter();
  /** Scripted hands, for verification. Inert unless something arms it. */
  readonly puppet = new PuppetController();

  private stream: MediaStream | null = null;
  private source = "starting";
  private running = false;
  private mode: CameraMode = CONFIG.ui.defaultCameraMode;
  private modeChange: Promise<void> = Promise.resolve();
  private loopGeneration = 0;
  private lastHudAt = 0;
  private lastFrame: PerceptionFrame | null = null;
  private lastCursor: CursorState | null = null;

  constructor(root: ParentNode = document) {
    this.video = requireElement(root, "#camera", HTMLVideoElement);
    this.canvas = requireElement(root, "#overlay", HTMLCanvasElement);
    this.hud = new Hud(requireElement(root, "#hud", HTMLElement));
    this.experience = new ExperienceUi(root, () => this.capturePicture());

    const ctx = this.canvas.getContext("2d");
    if (ctx === null) throw new Error("2D canvas context unavailable");
    this.ctx = ctx;
  }

  async start(): Promise<void> {
    setupMirror(this.video);
    this.presentMode();
    // Only on resize. The canvas is position:fixed inset:0, so its CSS box
    // cannot change any other way, and fitCanvas reads clientWidth - a forced
    // synchronous layout that has no business in a 60 fps loop.
    window.addEventListener("resize", () => fitCanvas(this.canvas));
    window.addEventListener("keydown", (e) => {
      if (e.repeat) return;
      const key = e.key.toLowerCase();
      if (key === "d" || key === "f") {
        e.preventDefault();
        this.requestMode(key === "d" ? "debug" : "final");
      } else if (key === "p") {
        this.experience.enterPicture();
      } else if (key === "c") {
        this.experience.requestCapture(performance.now());
      }
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
      requestVideoFrameCallback?: (cb: (now: number) => void) => number;
    };
    if (typeof withVideoCallback.requestVideoFrameCallback === "function") {
      withVideoCallback.requestVideoFrameCallback((now) => this.onFrame(now, generation));
    } else {
      requestAnimationFrame((now) => this.onFrame(now, generation));
    }
  }

  private onFrame(now: number, generation: number): void {
    if (generation !== this.loopGeneration) return;
    // A puppet replaces the detectors outright rather than merging with them:
    // half-real hands would be the one kind of evidence worse than none.
    const frame = this.puppet.active
      ? this.puppet.frame(now, window.innerWidth / window.innerHeight)
      : this.engine.step(this.video, now);
    if (frame !== null) {
      this.fps.tick(now);
      const cursor = this.experience.update(frame, this.cursor.update(frame));
      this.lastFrame = frame;
      this.lastCursor = cursor;
      const showDebug = this.mode === "debug";
      drawOverlay(this.ctx, frame, cursor, showDebug);

      if (showDebug && frame.t - this.lastHudAt >= 1000 / CONFIG.ui.hudHz) {
        this.lastHudAt = frame.t;
        this.hud.render(frame, cursor, {
          mode: this.mode,
          fps: this.fps.fps,
          camera: this.source,
          timings: this.engine.detectorTimings,
        });
      }
    }
    this.scheduleFrame(generation);
  }

  private requestMode(mode: CameraMode): void {
    // Serializing keeps a quick D/F sequence deterministic even while the
    // hardware is still completing the first format change.
    this.modeChange = this.modeChange
      .then(async () => {
        if (mode === this.mode || this.stream === null) return;
        const previousMode = this.mode;
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
        this.source = describeStream(this.stream, mode);
        this.presentMode();
        this.startFrameLoop();
      })
      .catch((error: unknown) => {
        console.error(error);
      });
  }

  private presentMode(): void {
    document.body.dataset.cameraMode = this.mode;
    this.hud.setVisible(this.mode === "debug");
  }

  /** Everything the frame loop knows, for the debug bridge. Dev only. */
  loop(): LoopSnapshot {
    return {
      live: this.running,
      cameraMode: this.mode,
      cameraSource: this.source,
      fps: this.fps.fps,
      timings: this.engine.detectorTimings,
      frame: this.lastFrame,
      cursor: this.lastCursor,
    };
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
