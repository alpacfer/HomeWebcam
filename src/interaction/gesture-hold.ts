export interface HoldState {
  progress: number;
  /** True once per continuous hold, when the configured duration is reached. */
  activated: boolean;
}

/** Converts a noisy per-frame boolean into one deliberate, latched activation. */
export class GestureHold {
  private startedAt: number | null = null;
  private fired = false;

  constructor(private readonly durationMs: number) {}

  update(active: boolean, now: number): HoldState {
    if (!active) {
      this.startedAt = null;
      this.fired = false;
      return { progress: 0, activated: false };
    }

    if (this.startedAt === null) this.startedAt = now;
    const progress = Math.min(1, Math.max(0, (now - this.startedAt) / this.durationMs));
    const activated = progress >= 1 && !this.fired;
    if (activated) this.fired = true;
    return { progress, activated };
  }
}
