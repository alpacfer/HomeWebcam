import { CameraError, describeStream, startCamera, stopCamera } from "./camera/camera.js";
import { CONFIG } from "./config.js";
import { HandCursor } from "./interaction/cursor.js";
import { requireElement } from "./lib/assert.js";
import { FpsMeter } from "./lib/fps.js";
import { PerceptionEngine } from "./perception/engine.js";
import { Hud } from "./ui/hud.js";
import { fitCanvas, setupMirror } from "./ui/mirror.js";
import { drawOverlay } from "./ui/overlay.js";

/**
 * Wires camera -> perception -> interaction -> render and owns the frame loop.
 *
 * The loop is driven by requestVideoFrameCallback where available, so detectors
 * run once per *camera* frame instead of once per display refresh. On a 30 fps
 * camera and a 60 Hz screen that halves the work for identical results.
 */
export class App {
  private readonly video: HTMLVideoElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly hud: Hud;

  private readonly engine = new PerceptionEngine();
  private readonly cursor = new HandCursor();
  private readonly fps = new FpsMeter();

  private stream: MediaStream | null = null;
  private source = "starting";
  private running = false;
  private showDebug: boolean = CONFIG.ui.debugOverlay;

  constructor(root: ParentNode = document) {
    this.video = requireElement(root, "#camera", HTMLVideoElement);
    this.canvas = requireElement(root, "#overlay", HTMLCanvasElement);
    this.hud = new Hud(requireElement(root, "#hud", HTMLElement));

    const ctx = this.canvas.getContext("2d");
    if (ctx === null) throw new Error("2D canvas context unavailable");
    this.ctx = ctx;
  }

  async start(): Promise<void> {
    setupMirror(this.video);
    window.addEventListener("resize", () => fitCanvas(this.canvas));
    window.addEventListener("keydown", (e) => {
      if (e.key === "d") {
        this.showDebug = !this.showDebug;
        this.hud.setVisible(this.showDebug);
      }
    });

    try {
      this.stream = await startCamera(this.video);
      this.source = describeStream(this.stream);
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

    this.hud.setVisible(this.showDebug);
    document.body.classList.add("is-live");
    this.running = true;
    this.scheduleFrame();
  }

  stop(): void {
    this.running = false;
    this.engine.close();
    stopCamera(this.stream);
    this.stream = null;
  }

  private scheduleFrame(): void {
    if (!this.running) return;
    const withVideoCallback = this.video as HTMLVideoElement & {
      requestVideoFrameCallback?: (cb: (now: number) => void) => number;
    };
    if (typeof withVideoCallback.requestVideoFrameCallback === "function") {
      withVideoCallback.requestVideoFrameCallback((now) => this.onFrame(now));
    } else {
      requestAnimationFrame((now) => this.onFrame(now));
    }
  }

  private onFrame(now: number): void {
    fitCanvas(this.canvas);
    const frame = this.engine.step(this.video, now);
    if (frame !== null) {
      this.fps.tick(now);
      const cursor = this.cursor.update(frame);
      drawOverlay(this.ctx, frame, cursor, this.showDebug);
      this.hud.render(frame, cursor, this.fps.fps, this.source);
    }
    this.scheduleFrame();
  }
}
