import type { Rect } from "./types.js";

interface Track {
  id: string;
  center: { x: number; y: number };
  lastSeenSeq: number;
}

/**
 * Greedy nearest-centroid tracker.
 *
 * MediaPipe's face detector is stateless: it returns a fresh unordered list
 * every frame with no identity. Anything that follows a person over time (a
 * greeting, a name label, an enrolment prompt) needs a stable id, so we assign
 * one here by matching centroids between frames.
 *
 * Good enough for a handful of people standing at a kiosk. It will swap ids if
 * two people cross paths closer than `maxJump`.
 */
export class CentroidTracker {
  private tracks: Track[] = [];
  private nextId = 1;

  /**
   * @param maxJump Max normalized centre movement still counted as the same
   *   person. 0.15 is roughly a head-width at kiosk distance.
   * @param maxMissedFrames How long an id survives an occlusion or dropout.
   */
  constructor(
    private readonly maxJump = 0.15,
    private readonly maxMissedFrames = 15,
  ) {}

  /** @returns One id per input box, in the same order. */
  assign(boxes: readonly Rect[], seq: number): string[] {
    const centers = boxes.map((b) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 }));
    const claimed = new Set<string>();
    const ids: string[] = [];

    for (const center of centers) {
      let best: Track | null = null;
      let bestDist = this.maxJump;
      for (const track of this.tracks) {
        if (claimed.has(track.id)) continue;
        const d = Math.hypot(track.center.x - center.x, track.center.y - center.y);
        if (d < bestDist) {
          best = track;
          bestDist = d;
        }
      }
      if (best === null) {
        best = { id: `face-${this.nextId++}`, center, lastSeenSeq: seq };
        this.tracks.push(best);
      } else {
        best.center = center;
        best.lastSeenSeq = seq;
      }
      claimed.add(best.id);
      ids.push(best.id);
    }

    this.tracks = this.tracks.filter((t) => seq - t.lastSeenSeq <= this.maxMissedFrames);
    return ids;
  }

  reset(): void {
    this.tracks = [];
  }
}
