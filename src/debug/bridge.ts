import type { CameraMode, StationView } from "../camera/camera.js";
import { CONFIG } from "../config.js";
import type { CursorState } from "../interaction/cursor.js";
import type { PaintStatus } from "../interaction/paint-session.js";
import type { DetectorTimings } from "../perception/engine.js";
import type { GestureName, PerceptionFrame, Rect, Vec2 } from "../perception/types.js";
import type { VoiceStatus } from "../perception/voice.js";
import {
  builtinScenarios,
  type PuppetController,
  type PuppetPose,
  type PuppetScenario,
} from "./puppet.js";
import type { DebugRecorder, RecorderState } from "./recorder.js";
import type { TaskPanel, TaskPanelState } from "./tasks.js";

/**
 * The station's debug surface: one structured snapshot of everything worth
 * knowing, and a way to drive hands into the app.
 *
 * It exists because the alternative is what happened before it did - a fresh
 * throwaway CDP script for every question, each one scraping the DOM with its
 * own regex, none of them updated when the markup moved. Nine of them in a
 * single afternoon. One typed reader that lives next to the code it reads is
 * cheaper to keep true.
 *
 * Development builds only: `installDebugBridge` is called behind
 * `import.meta.env.DEV`, so nothing here reaches the station's production
 * bundle. See scripts/station.mjs for the command line on the other end.
 */

/** What the frame loop knows. Supplied by App. */
export interface LoopSnapshot {
  live: boolean;
  voice: VoiceStatus;
  cameraMode: CameraMode;
  /** What is on the glass, which since ADR 0021 need not match the camera profile. */
  view: StationView;
  cameraSource: string;
  fps: number;
  capturedFps: number;
  sinceLastFrameMs: number;
  timings: DetectorTimings;
  /** Why the last camera mode change failed, if it did. */
  error: string | null;
  /** The last uncaught error. A frame loop that died says so here. */
  crash: string | null;
  frame: PerceptionFrame | null;
  cursor: CursorState | null;
  /** Paint mode in numbers while it is on. Null otherwise. */
  paint: PaintStatus | null;
}

export interface DebugHost {
  loop(): LoopSnapshot;
  /** Tells the ear it heard something, without a microphone. See ADR 0016. */
  say(text: string): void;
  /** Switches the camera profile, leaving the view alone. See StationView. */
  requestMode(mode: CameraMode): void;
  /** Puts the instruments on the glass or takes them off, leaving the camera alone. */
  setView(view: StationView): void;
  readonly puppet: PuppetController;
  readonly recorder: DebugRecorder;
  readonly tasks: TaskPanel;
}

export interface PanelSnapshot {
  id: string;
  /** Where it is on screen right now, normalized, including its travel. */
  rect: Rect;
  /** Travel from rest, in px, as the renderer wrote it. */
  offset: Vec2;
  leanDeg: Vec2;
  /** 0..1 reveal-light intensity. */
  glow: number;
  /** 0..1 dwell toward selecting this panel. */
  dwell: number;
  /** 0..1 of the gesture hold advertised on this panel, if it advertises one. */
  hold: number | null;
  classes: string[];
}

export interface StationSnapshot {
  t: number;
  live: boolean;
  /**
   * A hidden or unfocused window is throttled by the compositor, and every
   * frame-rate number measured in that state is a measurement of the throttle.
   * Two separate wrong conclusions were drawn from that before it was reported.
   */
  visibility: { state: string; focused: boolean };
  /**
   * "puppet" means the hands in this snapshot were invented by
   * src/debug/puppet.ts. Nothing measured under it says anything about the
   * detectors.
   */
  perceptionSource: "camera" | "puppet";
  /**
   * `fps` is what the loop processes; `capturedFps` is what the camera
   * delivers. They diverge for opposite reasons and want opposite fixes, and
   * `source` reports only what was negotiated, which can be a fiction.
   */
  camera: {
    mode: CameraMode;
    /**
     * The view is here beside the profile because they used to be one word.
     * A take recorded on the visitor's profile reads `mode: "final", view:
     * "debug"`, and that pairing is the whole point of ADR 0021.
     */
    view: StationView;
    source: string;
    fps: number;
    capturedFps: number;
    /**
     * How long since a frame was actually processed. Every rate in here is a
     * rolling average that holds its last value, so a loop that has stopped
     * being handed frames reports the speed it managed before it stopped. This
     * is the number that says whether any of the others are current.
     */
    sinceLastFrameMs: number;
    timings: DetectorTimings;
    /**
     * A mode change that failed reopens the profile that worked, so the station
     * keeps running and the keystroke looks ignored. This says what happened.
     */
    error: string | null;
  };
  /** The last uncaught error anywhere in the page, or null. */
  crash: string | null;
  hands: Array<{
    side: string;
    gesture: GestureName;
    confidence: number;
    indexTip: Vec2;
    palmCenter: Vec2;
  }>;
  faces: number;
  cursor: { position: Vec2 | null; dwell: number; gesture: GestureName } | null;
  experience: { mode: string; phase: string };
  menu: { dock: Vec2; panels: PanelSnapshot[] };
  picture: { countdown: number; countdownVisible: boolean; statusVisible: boolean };
  /**
   * Paint mode. `visible` is what the browser computed for the canvas, not what
   * the app believes about it (friction 0019); `tray` is read off the chips the
   * same way the menu is read off the tiles.
   */
  paint: {
    visible: boolean;
    /**
     * The canvas's pixel size. A visible canvas that is 0 by 0 draws nothing
     * and says nothing about it; every stroke lands in an empty buffer while the
     * stroke count climbs. See friction 0023.
     */
    canvas: { width: number; height: number };
    status: PaintStatus | null;
    tray: PanelSnapshot[];
  };
  /** The debug video recorder. Only reachable in debug camera mode. See ADR 0014. */
  recording: RecorderState;
  /** What the station has been asked to do in front of the camera. See ADR 0015. */
  tasks: TaskPanelState;
  /** The ear: the microphone, the speech model, and what it last heard. ADR 0016. */
  voice: VoiceStatus;
  /** Text a visitor can read. The interface is meant to have none. See ADR 0010. */
  visibleText: string[];
}

export interface StationBridge {
  snapshot(): StationSnapshot;
  config: typeof CONFIG;
  /** The interactions this station has, ready to play. Keyed by name. */
  scenarios(): Record<string, PuppetScenario>;
  puppet: {
    /** A scenario, or the name of a built-in one. */
    play(scenario: PuppetScenario | string): void;
    hold(pose: PuppetPose): void;
    stop(): void;
    readonly active: boolean;
    finished(): boolean;
  };
  /**
   * The corner control, without a mouse. `save` fills in the dialog that is
   * waiting for a name and resolves with the filename it landed under.
   */
  recorder: {
    start(): void;
    stop(): void;
    save(name: string, description: string): Promise<string>;
    discard(): void;
  };
  /**
   * The task list, without a mouse. `record` presses a step's button; the take
   * that follows is filed against that step when it is saved.
   */
  tasks: {
    refresh(): Promise<void>;
    record(taskId: string, stepId: string): void;
  };
  /**
   * Puts words in the station's ear. They arrive marked as injected, so a check
   * that passes this way can never be quoted as the speech model working.
   */
  say(text: string): void;
  /**
   * The two halves of what D and F used to do together. `camera.use` changes
   * what the camera delivers and nothing on the glass; `view.set` the reverse.
   * The CLI's `camera final` is how a take on the visitor's profile is recorded
   * from the debug view. See StationView and ADR 0021.
   */
  camera: { use(mode: CameraMode): void };
  view: { set(view: StationView): void };
  /**
   * The painting's pixels, because a check that reads the stroke count reads a
   * number the app also wrote. `painted` counts pixels with any alpha;
   * `sample` reads one, at normalized coordinates, as [r, g, b, a].
   */
  paint: {
    painted(): number;
    sample(x: number, y: number): [number, number, number, number];
  };
}

declare global {
  interface Window {
    __station?: StationBridge;
  }
}

export function installDebugBridge(host: DebugHost): void {
  const bridge: StationBridge = {
    config: CONFIG,
    snapshot: () => snapshot(host),
    scenarios: () => builtinScenarios(defaultTarget()),
    puppet: {
      play(scenario) {
        const resolved =
          typeof scenario === "string" ? builtinScenarios(defaultTarget())[scenario] : scenario;
        if (resolved === undefined) {
          throw new Error(
            `no scenario "${scenario}". Try: ${Object.keys(builtinScenarios(defaultTarget())).join(", ")}`,
          );
        }
        host.puppet.play(resolved, performance.now());
        markSource("puppet");
      },
      hold(pose) {
        host.puppet.hold(pose, performance.now());
        markSource("puppet");
      },
      stop() {
        host.puppet.stop();
        markSource("camera");
      },
      get active() {
        return host.puppet.active;
      },
      finished: () => host.puppet.finished(performance.now()),
    },
    recorder: {
      start: () => host.recorder.start(),
      stop: () => host.recorder.stop(),
      save: (name, description) => host.recorder.saveWith(name, description),
      discard: () => host.recorder.discard(),
    },
    tasks: {
      refresh: () => host.tasks.refresh(),
      record: (taskId, stepId) => host.tasks.recordStep(taskId, stepId),
    },
    say: (text) => host.say(text),
    camera: { use: (mode) => host.requestMode(mode) },
    view: { set: (view) => host.setView(view) },
    paint: {
      painted: () => countPainted(),
      sample: (x, y) => samplePaint(x, y),
    },
  };
  window.__station = bridge;
  markSource("camera");
}

function paintCanvas(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null {
  const canvas = document.getElementById("paint");
  if (!(canvas instanceof HTMLCanvasElement)) return null;
  const ctx = canvas.getContext("2d");
  return ctx === null ? null : { canvas, ctx };
}

function countPainted(): number {
  const target = paintCanvas();
  if (target === null) return 0;
  const { data } = target.ctx.getImageData(0, 0, target.canvas.width, target.canvas.height);
  let painted = 0;
  for (let i = 3; i < data.length; i += 4) if ((data[i] ?? 0) > 0) painted++;
  return painted;
}

function samplePaint(x: number, y: number): [number, number, number, number] {
  const target = paintCanvas();
  if (target === null) return [0, 0, 0, 0];
  const px = Math.min(target.canvas.width - 1, Math.max(0, Math.round(x * target.canvas.width)));
  const py = Math.min(target.canvas.height - 1, Math.max(0, Math.round(y * target.canvas.height)));
  const { data } = target.ctx.getImageData(px, py, 1, 1);
  return [data[0] ?? 0, data[1] ?? 0, data[2] ?? 0, data[3] ?? 0];
}

/**
 * Scenarios that say "point at the target" aim at the first mode tile, found
 * where it currently is rather than where the stylesheet used to put it.
 */
function defaultTarget(): Vec2 {
  const tile = document.querySelector(".tile");
  if (!(tile instanceof HTMLElement)) return { x: 0.5, y: 0.12 };
  const box = tile.getBoundingClientRect();
  return {
    x: (box.left + box.width / 2) / window.innerWidth,
    y: (box.top + box.height / 2) / window.innerHeight,
  };
}

/**
 * The station wears a badge whenever its hands are invented, in every camera
 * mode, so a screenshot taken under the puppet can never be mistaken for
 * evidence that the real thing works. The styling is in styles.css.
 */
function markSource(source: "camera" | "puppet"): void {
  document.body.dataset.perceptionSource = source;
}

function snapshot(host: DebugHost): StationSnapshot {
  const loop = host.loop();
  const frame = loop.frame;
  const cursor = loop.cursor;

  return {
    t: performance.now(),
    live: loop.live,
    visibility: { state: document.visibilityState, focused: document.hasFocus() },
    perceptionSource: host.puppet.active ? "puppet" : "camera",
    camera: {
      mode: loop.cameraMode,
      view: loop.view,
      source: loop.cameraSource,
      fps: loop.fps,
      capturedFps: loop.capturedFps,
      sinceLastFrameMs: loop.sinceLastFrameMs,
      timings: loop.timings,
      error: loop.error,
    },
    crash: loop.crash,
    hands: (frame?.hands ?? []).map((hand) => ({
      side: hand.side,
      gesture: hand.gesture,
      confidence: hand.gestureConfidence,
      indexTip: hand.indexTip,
      palmCenter: hand.palmCenter,
    })),
    faces: frame?.faces.length ?? 0,
    cursor:
      cursor === null
        ? null
        : { position: cursor.position, dwell: cursor.dwellProgress, gesture: cursor.gesture },
    experience: {
      mode: document.body.dataset.experienceMode ?? "unknown",
      phase: document.body.dataset.picturePhase ?? "unknown",
    },
    menu: readMenu(),
    paint: readPaint(loop.paint),
    picture: readPicture(),
    recording: host.recorder.state,
    tasks: host.tasks.state,
    voice: loop.voice,
    visibleText: readVisibleText(),
  };
}

/**
 * Read back off the DOM rather than out of the physics.
 *
 * The renderer is the last thing that touches these numbers, so reading them
 * where it left them checks what is actually on the glass. A snapshot taken
 * from the physics would agree with itself even if the renderer dropped a write.
 */
function readMenu(): StationSnapshot["menu"] {
  const dock = document.getElementById("dock");
  return {
    dock: dock === null ? { x: 0, y: 0 } : translationOf(dock),
    panels: readPanels(".tile", "mode", ".tile__ring"),
  };
}

function readPaint(status: PaintStatus | null): StationSnapshot["paint"] {
  const canvas = document.getElementById("paint");
  return {
    visible: canvas !== null && getComputedStyle(canvas).display !== "none",
    canvas:
      canvas instanceof HTMLCanvasElement
        ? { width: canvas.width, height: canvas.height }
        : { width: 0, height: 0 },
    status,
    tray: readPanels(".chip", "chip", ".chip__ring"),
  };
}

/** Tiles and chips are read the same way: the renderer wrote these, so they are what is on the glass. */
function readPanels(selector: string, idKey: string, ringSelector: string): PanelSnapshot[] {
  const panels: PanelSnapshot[] = [];
  for (const panel of document.querySelectorAll(selector)) {
    if (!(panel instanceof HTMLElement)) continue;
    const box = panel.getBoundingClientRect();
    panels.push({
      id: panel.dataset[idKey] ?? "?",
      rect: {
        x: box.left / window.innerWidth,
        y: box.top / window.innerHeight,
        width: box.width / window.innerWidth,
        height: box.height / window.innerHeight,
      },
      offset: translationOf(panel),
      leanDeg: rotationOf(panel),
      glow: numberProperty(panel, "--glow"),
      dwell: ringProgress(panel.querySelector(ringSelector)),
      hold:
        panel.querySelector(".tile__hint .ring") === null
          ? null
          : ringProgress(panel.querySelector(".tile__hint .ring")),
      classes: [...panel.classList],
    });
  }
  return panels;
}

function readPicture(): StationSnapshot["picture"] {
  const countdown = document.getElementById("countdown");
  const status = document.getElementById("capture-status");
  return {
    countdown: ringProgress(document.getElementById("countdown-ring")),
    countdownVisible: countdown?.classList.contains("countdown--visible") ?? false,
    statusVisible: status?.classList.contains("status--visible") ?? false,
  };
}

/**
 * Every word a visitor could read, so "the interface has no text in it" is a
 * thing a test can check rather than a thing somebody remembers. Screen-reader
 * text and the developer HUD do not count.
 */
function readVisibleText(): string[] {
  const stage = document.getElementById("stage");
  if (stage === null) return [];
  const walker = document.createTreeWalker(stage, NodeFilter.SHOW_TEXT);
  const found: string[] = [];
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = node.textContent?.trim() ?? "";
    if (text === "") continue;
    const parent = node.parentElement;
    if (parent === null) continue;
    if (parent.closest(".sr-only, #hud") !== null) continue;
    if (parent.closest("[aria-hidden='true']") !== null) continue;
    const style = getComputedStyle(parent);
    if (style.display === "none" || style.visibility === "hidden") continue;
    found.push(text);
  }
  return found;
}

function translationOf(element: HTMLElement): Vec2 {
  const match = element.style.transform.match(/translate3d\((-?[\d.]+)px,\s*(-?[\d.]+)px/);
  return match === null ? { x: 0, y: 0 } : { x: Number(match[1]), y: Number(match[2]) };
}

function rotationOf(element: HTMLElement): Vec2 {
  const x = element.style.transform.match(/rotateX\((-?[\d.]+)deg\)/);
  const y = element.style.transform.match(/rotateY\((-?[\d.]+)deg\)/);
  return { x: Number(x?.[1] ?? 0), y: Number(y?.[1] ?? 0) };
}

function ringProgress(element: Element | null): number {
  return element instanceof HTMLElement ? numberProperty(element, "--progress") : 0;
}

function numberProperty(element: HTMLElement, name: string): number {
  return Number(element.style.getPropertyValue(name) || 0);
}
