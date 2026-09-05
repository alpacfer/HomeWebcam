import { CONFIG } from "../config.js";
import { FaceFeaturesDetector } from "./detectors/face-features.js";
import { FacesDetector } from "./detectors/faces.js";
import { HandsDetector } from "./detectors/hands.js";
import { NoopIdentityDetector } from "./detectors/identity.js";
import { assertModelsPresent } from "./models.js";
import type {
  Detector,
  FaceObservation,
  HandObservation,
  IdentityDetector,
  PerceptionFrame,
  Utterance,
} from "./types.js";
import { VoiceEar, type VoiceStatus } from "./voice.js";

/** Smoothed per-detector cost in ms. The frame budget at 60 fps is 16.7 ms. */
export interface DetectorTimings {
  hands: number;
  faces: number;
}

/** How much of an old measurement survives a new one. Enough to stop the flicker. */
const TIMING_SMOOTHING = 0.9;

/**
 * Runs the enabled detectors and assembles a PerceptionFrame. This is the only
 * place that knows which detectors exist.
 *
 * Detectors do not all run on every frame. Each has a cadence in CONFIG, and a
 * detector that sits out a frame contributes its previous result, so a
 * PerceptionFrame is always complete: nothing above this layer can tell which
 * frames were detection frames, and a face never blinks out mid-blink. See
 * ADR 0006 for why the loop is decoupled from the detectors.
 *
 * To add a detector: implement Detector<T> under ./detectors, hold it as a
 * field here, init it in init(), call it in step(), and widen PerceptionFrame.
 */
export class PerceptionEngine {
  private readonly hands = new HandsDetector();
  private readonly faces: Detector<FaceObservation[]> = CONFIG.faces.features
    ? new FaceFeaturesDetector()
    : new FacesDetector();
  private readonly identity: IdentityDetector = new NoopIdentityDetector();
  /**
   * The ear. Not a Detector: it does not run per camera frame and it never
   * touches MediaPipe, so it has none of the timestamp rules. It listens on its
   * own thread and this drains what it heard into each frame. See ADR 0016.
   */
  private readonly ear = new VoiceEar();

  private seq = 0;
  private lastTimestamp = -1;
  private lastHands: HandObservation[] = [];
  private lastFaces: FaceObservation[] = [];
  private readonly timings: DetectorTimings = { hands: 0, faces: 0 };

  async init(): Promise<void> {
    await assertModelsPresent();
    // Sequential, not Promise.all: both detectors compile WASM kernels on the
    // GPU and doing it concurrently is slower and occasionally fails on Linux.
    await this.hands.init();
    await this.faces.init();
    await this.identity.init();
  }

  /**
   * Opens or closes the microphone. The app calls this with the camera mode:
   * the station listens in debug mode and not in front of a visitor. The model
   * loads on the first call and stays loaded. See ADR 0016.
   */
  listen(on: boolean): void {
    if (on) void this.ear.listen();
    else this.ear.deafen();
  }

  /**
   * @param timestampMs Must strictly increase. MediaPipe throws on a timestamp
   *   that is not greater than the previous one, so duplicates are skipped.
   */
  step(video: HTMLVideoElement, timestampMs: number): PerceptionFrame | null {
    if (timestampMs <= this.lastTimestamp) return null;
    this.lastTimestamp = timestampMs;
    this.seq++;

    if (!CONFIG.hands.enabled) {
      this.lastHands = [];
    } else if (this.due(CONFIG.hands.everyNFrames)) {
      this.lastHands = this.timed("hands", () => this.hands.detect(video, timestampMs));
    }

    if (!CONFIG.faces.enabled) {
      this.lastFaces = [];
    } else if (this.due(CONFIG.faces.everyNFrames)) {
      this.lastFaces = this.timed("faces", () => this.faces.detect(video, timestampMs));
      if (CONFIG.faces.identifyPeople) {
        for (const face of this.lastFaces) {
          face.identity = this.identity.identify(video, face);
        }
      }
    }

    return {
      seq: this.seq,
      t: performance.now(),
      hands: this.lastHands,
      faces: this.lastFaces,
      heard: this.hear(),
    };
  }

  /**
   * What each detector costs, for the HUD. docs/hardware.md asks for exactly
   * this number before anyone decides to decimate or drop a detector, and it is
   * not obtainable from the loop's frame rate: a pass that only runs every
   * other frame hides inside a healthy-looking average.
   */
  get detectorTimings(): DetectorTimings {
    return { ...this.timings };
  }

  /** What the ear is doing: the HUD and the station snapshot both show it. */
  get voice(): VoiceStatus {
    return this.ear.state;
  }

  /**
   * Everything heard since the last call. `step` folds this into the frame it
   * builds; the app drains it separately while a puppet is driving, because a
   * puppet replaces the hands and has nothing to say about the ear.
   */
  hear(): Utterance[] {
    return this.ear.drain();
  }

  /** Tells the station it heard something. See VoiceEar.inject. */
  say(text: string): void {
    this.ear.inject(text);
  }

  close(): void {
    this.hands.close();
    this.faces.close();
    this.identity.close();
    this.ear.close();
  }

  private due(everyNFrames: number): boolean {
    return everyNFrames <= 1 || this.seq % everyNFrames === 0;
  }

  private timed<T>(key: keyof DetectorTimings, run: () => T): T {
    const start = performance.now();
    const result = run();
    const elapsed = performance.now() - start;
    this.timings[key] = this.timings[key] * TIMING_SMOOTHING + elapsed * (1 - TIMING_SMOOTHING);
    return result;
  }
}
