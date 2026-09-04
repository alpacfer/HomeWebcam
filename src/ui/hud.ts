import type { CursorState } from "../interaction/cursor.js";
import type { PerceptionFrame } from "../perception/types.js";

/** Corner readout: is the loop alive, and what does it currently see. */
export class Hud {
  constructor(private readonly root: HTMLElement) {}

  /** The HUD is a developer tool. A visitor at the station should never see it. */
  setVisible(visible: boolean): void {
    this.root.classList.toggle("hud--hidden", !visible);
  }

  /**
   * @param fps Rate the perception loop achieves, which is capped by the
   *   camera but can also be lower if detection cannot keep up.
   * @param source What the camera actually negotiated. See describeStream().
   */
  render(frame: PerceptionFrame, cursor: CursorState, fps: number, source: string): void {
    const gestures = frame.hands
      .filter((h) => h.gesture !== "None")
      .map((h) => `${h.side}:${h.gesture}`)
      .join("  ");

    this.root.textContent = [
      `${fps.toFixed(0)} fps processed · camera ${source}`,
      `hands ${frame.hands.length} · faces ${frame.faces.length}`,
      gestures || "no gesture",
      cursor.position === null
        ? "raise a hand to point"
        : `cursor ${cursor.position.x.toFixed(2)}, ${cursor.position.y.toFixed(2)} · dwell ${(cursor.dwellProgress * 100).toFixed(0)}%`,
    ].join("\n");
  }

  showError(message: string, hint: string): void {
    this.root.classList.remove("hud--hidden");
    this.root.classList.add("hud--error");
    this.root.textContent = `${message}\n\n${hint}`;
  }
}
