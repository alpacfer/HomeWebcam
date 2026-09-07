// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CONFIG } from "../../src/config.js";
import { fixtureHand } from "../../src/debug/hand-fixtures.js";
import { DebugRecorder, type RecorderHost, type RecordingTake } from "../../src/debug/recorder.js";
import type { CursorState } from "../../src/interaction/cursor.js";
import type { PerceptionFrame } from "../../src/perception/types.js";
import type { SceneSample } from "../../src/ui/experience.js";

/**
 * The debug recorder, without a camera and without a station.
 *
 * MediaRecorder does not exist outside a browser, so this installs one that
 * behaves the way Chrome's does - chunks on request, a stop event, a mimeType -
 * and checks the code around it: what it collects, when it stops itself, what
 * ends up in the manifest, and that a failed save keeps the take rather than
 * dropping the one artifact the person was trying to file a bug with.
 */
const BODY = readFileSync(resolve(process.cwd(), "index.html"), "utf8")
  .replace(/[\s\S]*<body>/, "")
  .replace(/<\/body>[\s\S]*/, "")
  .replace(/<script[\s\S]*?<\/script>/g, "");

class FakeMediaRecorder extends EventTarget {
  static instances: FakeMediaRecorder[] = [];
  static supported = ["video/webm;codecs=vp8"];
  static isTypeSupported(type: string): boolean {
    return FakeMediaRecorder.supported.includes(type);
  }

  readonly mimeType: string;
  state = "inactive";

  constructor(
    readonly stream: MediaStream,
    options: { mimeType?: string } = {},
  ) {
    super();
    this.mimeType = options.mimeType ?? "video/webm";
    FakeMediaRecorder.instances.push(this);
  }

  start(): void {
    this.state = "recording";
  }

  requestData(): void {
    this.emitChunk(1024);
  }

  stop(): void {
    this.state = "inactive";
    this.dispatchEvent(new Event("stop"));
  }

  emitChunk(size: number): void {
    const event = new Event("dataavailable") as Event & { data: Blob };
    // happy-dom's Blob reports the size of what it was given.
    Object.defineProperty(event, "data", { value: new Blob(["x".repeat(size)]) });
    this.dispatchEvent(event);
  }
}

/** One frame of "where the interface was", the way ExperienceUi reports it. */
const SCENE: SceneSample = {
  mode: "home",
  phase: "idle",
  menu: {
    hovered: "picture",
    panels: [
      { id: "picture", rect: { x: 0.4, y: 0.03, width: 0.07, height: 0.13 }, glow: 0.8 },
      { id: "paint", rect: { x: 0.53, y: 0.03, width: 0.07, height: 0.13 }, glow: 0.1 },
    ],
  },
  paint: null,
};

const NO_CURSOR: CursorState = {
  position: null,
  dwellProgress: 0,
  activated: false,
  gesture: "None",
};

function frameAt(t: number): PerceptionFrame {
  return {
    seq: Math.round(t / 16),
    t,
    faces: [],
    heard: [],
    hands: [
      fixtureHand({
        indexTip: { x: 0.5, y: 0.4 },
        gesture: "Victory",
        side: "right",
        scale: 0.22,
        aspect: 16 / 9,
        confidence: 0.9,
      }),
    ],
  };
}

function build(save = vi.fn(async (_take: RecordingTake) => "a-name-2026-01-01.webm")) {
  document.body.innerHTML = BODY;
  const host: RecorderHost = {
    stream: () => ({}) as MediaStream,
    diagnostics: () => ({
      cameraMode: "debug",
      view: "debug",
      cameraSource: "1280x720@60",
      video: { width: 1280, height: 720 },
      viewport: { width: 1920, height: 1080, devicePixelRatio: 1 },
      perceptionSource: "camera",
      fps: 58.4,
      capturedFps: 59.1,
      detectors: { hands: 9.2, faces: 3.1 },
      cameraError: null,
    }),
    scene: () => SCENE,
    save,
  };
  const recorder = new DebugRecorder(document, host);
  recorder.setVisible(true);
  return { recorder, save };
}

function element(id: string): HTMLElement {
  const found = document.getElementById(id);
  if (found === null) throw new Error(`index.html has no #${id}`);
  return found;
}

function activeRecorder(): FakeMediaRecorder {
  const last = FakeMediaRecorder.instances.at(-1);
  if (last === undefined) throw new Error("no MediaRecorder was created");
  return last;
}

describe("DebugRecorder", () => {
  beforeEach(() => {
    FakeMediaRecorder.instances = [];
    FakeMediaRecorder.supported = ["video/webm;codecs=vp8"];
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
  });

  // This can only check the class. Whether the class actually hides anything is
  // a question for the browser, and `npm run verify` asks it there: the two
  // disagreed once, and the class lost. See friction 0019.
  it("stays out of the way until debug mode asks for it", () => {
    const { recorder } = build();
    recorder.setVisible(false);
    expect(element("recorder").classList.contains("recorder--hidden")).toBe(true);
    expect(recorder.state.visible).toBe(false);

    recorder.setVisible(true);
    expect(element("recorder").classList.contains("recorder--hidden")).toBe(false);
  });

  it("records the first WebM profile the browser supports", () => {
    FakeMediaRecorder.supported = ["video/webm;codecs=vp9", "video/webm"];
    const { recorder } = build();
    recorder.start();
    // vp8 is the preferred one and is unavailable here, so it falls to vp9.
    expect(activeRecorder().mimeType).toBe("video/webm;codecs=vp9");
    expect(recorder.state.phase).toBe("recording");
    expect(document.body.dataset.recorderPhase).toBe("recording");
  });

  it("collects one trace sample per processed frame", () => {
    const { recorder } = build();
    recorder.start();
    for (let t = 0; t < 5; t++) recorder.sample(frameAt(t * 16), NO_CURSOR);
    expect(recorder.state.samples).toBe(5);
  });

  it("ignores frames when nothing is being recorded", () => {
    const { recorder } = build();
    recorder.sample(frameAt(0), NO_CURSOR);
    expect(recorder.state.samples).toBe(0);
  });

  it("asks for a name and a description once the take is over", () => {
    const { recorder } = build();
    recorder.start();
    recorder.sample(frameAt(0), NO_CURSOR);
    recorder.stop();

    expect(recorder.state.phase).toBe("naming");
    expect(element("recorder-dialog").hasAttribute("open")).toBe(true);
    expect(element("recorder-summary").textContent).toContain("1 perception frames");
  });

  it("saves the take with what was typed, and everything a bug report needs", async () => {
    const { recorder, save } = build();
    recorder.start();
    recorder.sample(frameAt(0), { ...NO_CURSOR, position: { x: 0.4, y: 0.6 } });
    recorder.stop();

    const filename = await recorder.saveWith("Hand lost when backlit", "It drops every few s.");
    expect(filename).toBe("a-name-2026-01-01.webm");

    const take = save.mock.calls[0]?.[0];
    if (take === undefined) throw new Error("nothing was handed to save()");
    expect(take.name).toBe("Hand lost when backlit");
    expect(take.description).toBe("It drops every few s.");
    expect(take.manifest.camera).toEqual({
      mode: "debug",
      view: "debug",
      source: "1280x720@60",
      error: null,
    });
    expect(take.manifest.viewport).toEqual({ width: 1920, height: 1080, devicePixelRatio: 1 });
    expect(take.manifest.video.mirrored).toBe(false);
    expect(take.manifest.video.width).toBe(1280);
    expect(take.manifest.perception.source).toBe("camera");
    // The whole of CONFIG travels with it: a threshold is half of any repro.
    expect(take.manifest.config.cursor.dwellMs).toBe(CONFIG.cursor.dwellMs);
    expect(take.manifest.health.fpsAtStart).toBeCloseTo(58.4, 1);

    const sample = take.manifest.trace[0];
    if (sample === undefined) throw new Error("the trace is empty");
    expect(sample.hands[0]?.gesture).toBe("Victory");
    expect(sample.hands[0]?.landmarks).toHaveLength(21);
    expect(sample.cursor.position).toEqual({ x: 0.4, y: 0.6 });
    // Where the targets were, not only where the finger was.
    expect(sample.scene.menu.hovered).toBe("picture");
    expect(sample.scene.menu.panels[0]?.rect.width).toBeCloseTo(0.07, 4);
    expect(take.manifest.digest.frames).toBe(1);
    expect(take.manifest.digest.hovered).toEqual([{ panel: "picture", frames: 1 }]);

    expect(recorder.state.phase).toBe("saved");
    expect(element("recorder-dialog").hasAttribute("open")).toBe(false);
  });

  it("keeps the take when the save fails, and says why", async () => {
    const flaky = vi.fn(async (_take: RecordingTake) => "recovered.webm");
    flaky.mockRejectedValueOnce(new Error("no disk"));
    const { recorder } = build(flaky);
    recorder.start();
    recorder.sample(frameAt(0), NO_CURSOR);
    recorder.stop();

    await expect(recorder.saveWith("doomed", "")).rejects.toThrow("no disk");
    // Back to naming, not idle: the blob is the only copy of what just happened.
    expect(recorder.state.phase).toBe("naming");
    expect(element("recorder-error").hidden).toBe(false);
    expect(element("recorder-error").textContent).toContain("no disk");

    const retry = await recorder.saveWith("second try", "");
    expect(retry).toBe("recovered.webm");
  });

  it("refuses to save a take with no name", async () => {
    const { recorder, save } = build();
    recorder.start();
    recorder.stop();
    await expect(recorder.saveWith("   ", "")).rejects.toThrow(/name/);
    expect(save).not.toHaveBeenCalled();
    expect(recorder.state.phase).toBe("naming");
  });

  it("lets go of the keyboard when the dialog closes", async () => {
    const { recorder } = build();
    recorder.start();
    recorder.stop();
    expect(document.activeElement?.id).toBe("recorder-name");

    await recorder.saveWith("named", "");
    // app.ts ignores every shortcut key while a text field has focus, so a
    // field that keeps it after the dialog is hidden takes d, f, p and c with
    // it. That is how the station stopped answering F. See friction 0018.
    expect(document.activeElement?.id).not.toBe("recorder-name");
    expect(document.activeElement?.id).not.toBe("recorder-description");
  });

  it("is driven by the buttons in the dialog, not only from the bridge", async () => {
    const { recorder, save } = build();
    recorder.start();
    recorder.stop();

    const name = document.getElementById("recorder-name");
    if (!(name instanceof HTMLInputElement)) throw new Error("the name field is missing");
    name.value = "typed by a person";
    element("recorder-form").dispatchEvent(new Event("submit", { cancelable: true }));
    await vi.waitFor(() => expect(recorder.state.phase).toBe("saved"));
    expect(save.mock.calls[0]?.[0]?.name).toBe("typed by a person");

    recorder.start();
    recorder.stop();
    element("recorder-discard").dispatchEvent(new Event("click"));
    expect(recorder.state.phase).toBe("idle");
  });

  it("does not ask for a name it already knows", () => {
    const { recorder } = build();
    recorder.start({
      taskId: "a-task",
      taskTitle: "A task",
      stepId: "s1",
      stepNumber: 1,
      instruction: "Hold a Victory sign",
    });
    recorder.stop();

    // The take is named after the step, so the dialog asks only what happened.
    expect(element("recorder-name-row").hidden).toBe(true);
    expect(element("recorder-title").textContent).toBe("Task · A task");
    expect(element("recorder-asked-for").textContent).toBe("1. Hold a Victory sign");
    expect(element("recorder-description-label").textContent).toBe("What happened?");
    expect(document.activeElement?.id).toBe("recorder-description");
  });

  it("names a task take after the task and the step", async () => {
    const { recorder, save } = build();
    recorder.start({
      taskId: "a-task",
      taskTitle: "A task",
      stepId: "s2",
      stepNumber: 2,
      instruction: "Hold it closer",
    });
    recorder.sample(frameAt(0), NO_CURSOR);
    recorder.stop();
    await recorder.saveWith("ignored", "it worked the second time");

    const take = save.mock.calls[0]?.[0];
    if (take === undefined) throw new Error("nothing was handed to save()");
    expect(take.name).toBe("A task step 2");
    expect(take.description).toBe("it worked the second time");
    expect(take.assignment?.stepId).toBe("s2");
    expect(take.manifest.task?.instruction).toBe("Hold it closer");
  });

  it("writes what was said into the description, never into the name", () => {
    const { recorder } = build();
    recorder.start();
    recorder.stop();
    // The dialog focuses the name so it can be typed. Dictation still goes to
    // the description: a spoken sentence is not a sixty-character filename.
    expect(document.activeElement?.id).toBe("recorder-name");

    recorder.dictate("It lost my hand when I turned toward the window.");
    recorder.dictate("Then it found it again.");

    const description = element("recorder-description");
    if (!(description instanceof HTMLTextAreaElement)) throw new Error("no description field");
    expect(description.value).toBe(
      "It lost my hand when I turned toward the window. Then it found it again.",
    );
    const name = element("recorder-name");
    if (!(name instanceof HTMLInputElement)) throw new Error("no name field");
    expect(name.value).toBe("");
  });

  it("takes no dictation when no dialog is waiting for words", () => {
    const { recorder } = build();
    recorder.dictate("nobody asked");
    const description = element("recorder-description");
    if (!(description instanceof HTMLTextAreaElement)) throw new Error("no description field");
    expect(description.value).toBe("");
    expect(recorder.dictating).toBe(false);
  });

  it("throws away a discarded take", () => {
    const { recorder } = build();
    recorder.start();
    recorder.sample(frameAt(0), NO_CURSOR);
    recorder.stop();
    recorder.discard();

    expect(recorder.state.phase).toBe("idle");
    expect(recorder.state.samples).toBe(0);
    expect(element("recorder-dialog").hasAttribute("open")).toBe(false);
  });

  it("ends the take when the camera is about to change under it", () => {
    const { recorder } = build();
    recorder.start();
    recorder.cameraChanging();
    // A take may not span two negotiated camera formats. See ADR 0014.
    expect(recorder.state.phase).toBe("naming");
  });

  it("stops itself at the cap rather than recording forever", async () => {
    vi.useFakeTimers();
    try {
      const { recorder } = build();
      recorder.start();
      await vi.advanceTimersByTimeAsync(CONFIG.recording.maxMs + CONFIG.recording.healthSampleMs);
      expect(recorder.state.phase).toBe("naming");
    } finally {
      vi.useRealTimers();
    }
  });

  it("says so instead of pretending when the browser cannot record", () => {
    vi.stubGlobal("MediaRecorder", undefined);
    const { recorder } = build();
    expect(recorder.state.phase).toBe("unsupported");
    expect(() => recorder.start()).toThrow(/MediaRecorder/);
    expect(element("recorder-readout").textContent).toBe("no recorder");
  });
});
