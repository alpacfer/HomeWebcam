import { describe, expect, it } from "vitest";
import { GestureHold } from "../src/interaction/gesture-hold.js";

describe("GestureHold", () => {
  it("fires once after a continuous hold", () => {
    const hold = new GestureHold(900);

    expect(hold.update(true, 100)).toEqual({ progress: 0, activated: false });
    expect(hold.update(true, 550)).toEqual({ progress: 0.5, activated: false });
    expect(hold.update(true, 1000)).toEqual({ progress: 1, activated: true });
    expect(hold.update(true, 1500)).toEqual({ progress: 1, activated: false });
  });

  it("requires a new complete hold after the gesture disappears", () => {
    const hold = new GestureHold(500);

    hold.update(true, 0);
    expect(hold.update(true, 250).activated).toBe(false);
    expect(hold.update(false, 300)).toEqual({ progress: 0, activated: false });
    expect(hold.update(true, 400)).toEqual({ progress: 0, activated: false });
    expect(hold.update(true, 900)).toEqual({ progress: 1, activated: true });
  });
});
