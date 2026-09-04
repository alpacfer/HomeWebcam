// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CONFIG } from "../../src/config.js";
import { fixtureHand } from "../../src/debug/hand-fixtures.js";
import type { CursorState } from "../../src/interaction/cursor.js";
import type { GestureName, PerceptionFrame, Vec2 } from "../../src/perception/types.js";
import { ExperienceUi } from "../../src/ui/experience.js";

/**
 * The visitor interface, exercised without a station.
 *
 * The markup comes out of the real index.html rather than a copy of it, so this
 * also fails when an element the UI requires is renamed or dropped. What it
 * cannot see is anything about how the result looks - glass, refraction,
 * layout, whether an arc fills the right way. That needs pixels, and pixels
 * come from `npm run verify`.
 */
// Resolved from the project root: under a DOM environment `import.meta.url` is
// an http URL, not a file one.
const BODY = readFileSync(resolve(process.cwd(), "index.html"), "utf8")
  .replace(/[\s\S]*<body>/, "")
  .replace(/<\/body>[\s\S]*/, "")
  .replace(/<script[\s\S]*?<\/script>/g, "");

function frameWith(hands: Array<{ at: Vec2; gesture: GestureName }>, t: number): PerceptionFrame {
  return {
    seq: Math.round(t),
    t,
    faces: [],
    hands: hands.map((hand) =>
      fixtureHand({
        indexTip: hand.at,
        gesture: hand.gesture,
        side: "right",
        scale: 0.22,
        aspect: 16 / 9,
        confidence: 0.95,
      }),
    ),
  };
}

const NO_CURSOR: CursorState = {
  position: null,
  dwellProgress: 0,
  activated: false,
  gesture: "None",
};

function build(capture = vi.fn(async () => "picture-test.png")) {
  document.body.innerHTML = BODY;
  return { ui: new ExperienceUi(document, capture), capture };
}

/** Runs the loop at 60 fps for a while, the way app.ts does. */
function advance(ui: ExperienceUi, ms: number, hands: Array<{ at: Vec2; gesture: GestureName }>) {
  for (let t = 0; t <= ms; t += 16) ui.update(frameWith(hands, t), NO_CURSOR);
}

describe("ExperienceUi", () => {
  beforeEach(() => {
    document.body.removeAttribute("data-experience-mode");
    document.body.removeAttribute("data-picture-phase");
  });

  it("builds one tile per mode, each carrying an icon and a name for screen readers", () => {
    build();
    const tiles = [...document.querySelectorAll(".tile")];
    expect(tiles).toHaveLength(2);
    for (const tile of tiles) {
      expect(tile.querySelector(".tile__icon svg")).not.toBeNull();
      expect(tile.getAttribute("aria-label")).toBeTruthy();
    }
    expect(tiles.map((t) => (t as HTMLElement).dataset.mode)).toEqual(["picture", "game"]);
  });

  it("puts no words on the screen", () => {
    build();
    const stage = document.getElementById("stage");
    const visible = [...(stage?.querySelectorAll("*") ?? [])]
      .filter((el) => el.closest(".sr-only, #hud") === null)
      .filter((el) => el.closest("[aria-hidden='true']") === null)
      .flatMap((el) => [...el.childNodes])
      .filter((node) => node.nodeType === 3)
      .map((node) => node.textContent?.trim() ?? "")
      .filter((text) => text !== "");
    expect(visible).toEqual([]);
  });

  it("locks the mode that has nothing behind it yet", () => {
    build();
    const game = document.querySelector('[data-mode="game"]');
    expect(game?.classList.contains("tile--locked")).toBe(true);
    expect((game as HTMLButtonElement).disabled).toBe(true);
  });

  it("opens Picture mode from a held Victory, and not before the hold is done", () => {
    const { ui } = build();
    const victory = [{ at: { x: 0.5, y: 0.4 }, gesture: "Victory" as const }];

    advance(ui, CONFIG.interaction.gestureHoldMs - 200, victory);
    expect(document.body.dataset.experienceMode).toBe("home");

    advance(ui, CONFIG.interaction.gestureHoldMs + 200, victory);
    expect(document.body.dataset.experienceMode).toBe("picture");
  });

  it("ignores a gesture the model is not sure about", () => {
    document.body.innerHTML = BODY;
    const ui = new ExperienceUi(document, async () => "x.png");
    const unsure: PerceptionFrame = {
      seq: 1,
      t: 0,
      faces: [],
      hands: [
        fixtureHand({
          indexTip: { x: 0.5, y: 0.4 },
          gesture: "Victory",
          side: "right",
          scale: 0.22,
          aspect: 16 / 9,
          confidence: CONFIG.interaction.minGestureConfidence - 0.1,
        }),
      ],
    };
    for (let t = 0; t <= CONFIG.interaction.gestureHoldMs + 400; t += 16) {
      ui.update({ ...unsure, t }, NO_CURSOR);
    }
    expect(document.body.dataset.experienceMode).toBe("home");
  });

  it("swaps the badge from the way in to the way to shoot", () => {
    const { ui } = build();
    const badge = () => document.querySelector(".tile__hint svg path")?.getAttribute("d") ?? "";
    const peace = badge();
    ui.enterPicture();
    expect(badge()).not.toBe(peace);
    expect(document.querySelector(".tile__hint .ring")).not.toBeNull();
  });

  it("runs the whole shutter flow and reports where the picture went", async () => {
    const { ui, capture } = build();
    ui.enterPicture();
    ui.requestCapture(0);
    expect(document.body.dataset.picturePhase).toBe("countdown");
    expect(document.getElementById("countdown-number")?.textContent).toBe("3");

    advance(ui, CONFIG.picture.countdownMs + 100, []);
    expect(capture).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(document.body.dataset.picturePhase).toBe("saved"));
    expect(document.getElementById("capture-status")?.classList.contains("status--visible")).toBe(
      true,
    );
    expect(document.getElementById("capture-status-text")?.textContent).toBe("Picture saved");
  });

  it("says so when the picture could not be saved", async () => {
    const failing = vi.fn(async (): Promise<string> => {
      throw new Error("no disk");
    });
    const { ui } = build(failing);
    ui.enterPicture();
    ui.requestCapture(0);
    advance(ui, CONFIG.picture.countdownMs + 100, []);
    await vi.waitFor(() => expect(document.body.dataset.picturePhase).toBe("error"));
    expect(document.getElementById("capture-status")?.classList.contains("status--error")).toBe(
      true,
    );
  });

  it("cannot start a second countdown while one is running", () => {
    const { ui, capture } = build();
    ui.enterPicture();
    ui.requestCapture(0);
    ui.requestCapture(10);
    advance(ui, CONFIG.picture.countdownMs + 100, []);
    expect(capture).toHaveBeenCalledTimes(1);
  });
});
