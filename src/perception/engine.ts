import { CONFIG } from "../config.js";
import { FacesDetector } from "./detectors/faces.js";
import { HandsDetector } from "./detectors/hands.js";
import { NoopIdentityDetector } from "./detectors/identity.js";
import { assertModelsPresent } from "./models.js";
import type { IdentityDetector, PerceptionFrame } from "./types.js";

/**
 * Runs the enabled detectors once per video frame and assembles a
 * PerceptionFrame. This is the only place that knows which detectors exist.
 *
 * To add a detector: implement Detector<T> under ./detectors, hold it as a
 * field here, init it in init(), call it in step(), and widen PerceptionFrame.
 */
export class PerceptionEngine {
  private readonly hands = new HandsDetector();
  private readonly faces = new FacesDetector();
  private readonly identity: IdentityDetector = new NoopIdentityDetector();

  private seq = 0;
  private lastTimestamp = -1;

  async init(): Promise<void> {
    await assertModelsPresent();
    // Sequential, not Promise.all: both detectors compile WASM kernels on the
    // GPU and doing it concurrently is slower and occasionally fails on Linux.
    await this.hands.init();
    await this.faces.init();
    await this.identity.init();
  }

  /**
   * @param timestampMs Must strictly increase. MediaPipe throws on a timestamp
   *   that is not greater than the previous one, so duplicates are skipped.
   */
  step(video: HTMLVideoElement, timestampMs: number): PerceptionFrame | null {
    if (timestampMs <= this.lastTimestamp) return null;
    this.lastTimestamp = timestampMs;
    this.seq++;

    const hands = CONFIG.hands.enabled ? this.hands.detect(video, timestampMs) : [];
    const faces = CONFIG.faces.enabled ? this.faces.detect(video, timestampMs) : [];

    if (CONFIG.faces.identifyPeople) {
      for (const face of faces) {
        face.identity = this.identity.identify(video, face);
      }
    }

    return { seq: this.seq, t: performance.now(), hands, faces };
  }

  close(): void {
    this.hands.close();
    this.faces.close();
    this.identity.close();
  }
}
