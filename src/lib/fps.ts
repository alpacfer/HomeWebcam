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
