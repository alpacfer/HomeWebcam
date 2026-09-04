/** Rolling frame-rate meter. Cheap enough to run every frame. */
export class FpsMeter {
  private readonly samples: number[] = [];
  private last = 0;

  constructor(private readonly window = 30) {}

  tick(t: number): void {
    if (this.last > 0) {
      this.samples.push(t - this.last);
      if (this.samples.length > this.window) this.samples.shift();
    }
    this.last = t;
  }

  get fps(): number {
    if (this.samples.length === 0) return 0;
    const mean = this.samples.reduce((a, b) => a + b, 0) / this.samples.length;
    return mean > 0 ? 1000 / mean : 0;
  }
}

/**
 * How many camera frames arrived per frame we processed.
 *
 * requestVideoFrameCallback hands us the compositor's running count of video
 * frames, so a gap of more than one means the camera produced frames the loop
 * never saw. Processed fps alone cannot tell "the camera sends 15" apart from
 * "the camera sends 30 and we keep half", and those want opposite fixes: the
 * station spent an entire session at 15 fps while every readout said 30.
 */
export class SkippedFrames {
  private readonly samples: number[] = [];
  private last = -1;

  constructor(private readonly window = 30) {}

  /** @param presentedFrames Monotonic count from VideoFrameCallbackMetadata. */
  tick(presentedFrames: number): void {
    if (this.last >= 0 && presentedFrames > this.last) {
      this.samples.push(presentedFrames - this.last);
      if (this.samples.length > this.window) this.samples.shift();
    }
    this.last = presentedFrames;
  }

  /** 1 when the loop keeps up, 2 when it processes every other camera frame. */
  get framesPerProcessed(): number {
    if (this.samples.length === 0) return 1;
    return this.samples.reduce((a, b) => a + b, 0) / this.samples.length;
  }
}
