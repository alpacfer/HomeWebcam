import type { FaceObservation, Identity, IdentityDetector } from "../types.js";

/**
 * Face recognition ("who is this?") is deliberately NOT implemented yet.
 *
 * MediaPipe Tasks has no face-recognition task. It detects and landmarks faces;
 * it does not produce identity embeddings. Recognizing named people needs a
 * second model, and picking one is a real decision with privacy consequences,
 * so it is deferred rather than guessed at. See
 * docs/adr/0003-face-recognition-deferred.md for the candidates and trade-offs.
 *
 * Everything above this layer already reads `FaceObservation.identity`, so the
 * only change needed later is a new class implementing IdentityDetector and one
 * line in PerceptionEngine. Do not scatter identity logic outside this file.
 */
export class NoopIdentityDetector implements IdentityDetector {
  readonly name = "identity:noop";

  init(): Promise<void> {
    return Promise.resolve();
  }

  identify(_video: HTMLVideoElement, _face: FaceObservation): Identity | null {
    return null;
  }

  close(): void {
    // Nothing to release.
  }
}
