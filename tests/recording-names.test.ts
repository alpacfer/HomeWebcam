import { describe, expect, it } from "vitest";
import { applyRun, applyStatus, recordingFile, recordingStem, taskFile } from "../vite.config.js";

/**
 * The two halves of naming a debug recording, checked against each other.
 *
 * The server builds a stem from the name a person typed, hands it to the
 * browser, and validates it again when the video comes back. Those two halves
 * were written apart and disagreed: the pattern was lowercase-only and every
 * stem carried the T and the Z of an ISO timestamp, so the manifest saved and
 * the video was rejected with a 400. This is that agreement, pinned.
 */
describe("recording names", () => {
  it("accepts every stem it produces", () => {
    for (const name of [
      "hand lost when backlit",
      "Cursor JUMPS between hands",
      "victory -> picture, 60 fps",
      "æøå and other letters",
      "     ",
      "!!!",
    ]) {
      const stem = recordingStem(name);
      expect(
        recordingFile(stem, ".webm"),
        `rejected the stem it built for "${name}"`,
      ).not.toBeNull();
    }
  });

  it("keeps the typed name in the filename, so a recording can be found again", () => {
    expect(recordingStem("Hand lost when backlit")).toMatch(/^hand-lost-when-backlit-\d{4}-/);
  });

  it("names the unnameable rather than writing a file called nothing", () => {
    expect(recordingStem("!!!")).toMatch(/^recording-\d{4}-/);
  });

  it("refuses a stem that would write outside the recordings directory", () => {
    for (const hostile of [
      "../captures/picture",
      "..",
      "sub/dir",
      "/etc/passwd",
      "with.dots",
      "",
      "-leading-dash",
    ]) {
      expect(recordingFile(hostile, ".webm"), `let "${hostile}" through`).toBeNull();
    }
  });

  it("puts the pair of files side by side", () => {
    const stem = recordingStem("a take");
    const video = recordingFile(stem, ".webm");
    const manifest = recordingFile(stem, ".json");
    expect(video).toMatch(/\/recordings\/a-take-.*\.webm$/);
    expect(manifest).toBe(video?.replace(/\.webm$/, ".json"));
  });
});

/**
 * What the station is allowed to change about a task, and what it must keep.
 *
 * The run shape is copied field by field on the way in, which is safe and which
 * silently dropped `perceptionSource` the day it was added - so a puppet's
 * numbers sat in a task file looking exactly like a person's. See friction 0020.
 */
function runsOf(
  task: { steps: Array<{ runs: unknown[] }> },
  step: number,
): Array<Record<string, unknown>> {
  return (task.steps[step]?.runs ?? []) as Array<Record<string, unknown>>;
}

describe("task updates", () => {
  const task = () => ({
    id: "a-task",
    title: "A task",
    status: "open",
    steps: [
      { id: "s1", instruction: "one", runs: [] },
      { id: "s2", instruction: "two", runs: [] },
    ],
  });

  it("keeps where a run's hands came from", () => {
    const subject = task();
    expect(
      applyRun(subject, {
        stepId: "s1",
        recording: "a-take",
        note: "",
        perceptionSource: "puppet",
        digest: { frames: 3 },
      }),
    ).toBeNull();
    const run = runsOf(subject, 0)[0];
    expect(run?.perceptionSource).toBe("puppet");
    expect(run?.digest).toEqual({ frames: 3 });
  });

  it("calls a run whose provenance is missing unknown, never camera", () => {
    const subject = task();
    applyRun(subject, { stepId: "s1", recording: "a-take" });
    applyRun(subject, { stepId: "s1", recording: "b-take", perceptionSource: "nonsense" });
    expect(runsOf(subject, 0).map((run) => run.perceptionSource)).toEqual(["unknown", "unknown"]);
  });

  it("finishes a task once every step has been answered", () => {
    const subject = task();
    applyRun(subject, { stepId: "s1", recording: "one", perceptionSource: "camera" });
    expect(subject.status).toBe("open");
    applyRun(subject, { stepId: "s2", recording: "two", perceptionSource: "camera" });
    expect(subject.status).toBe("done");
  });

  it("refuses a run that names no step or no recording", () => {
    expect(applyRun(task(), { stepId: "nope", recording: "x" })?.code).toBe(404);
    expect(applyRun(task(), { stepId: "s1" })?.code).toBe(400);
  });

  it("takes only the three statuses a task can be in", () => {
    const subject = task();
    expect(applyStatus(subject, { status: "dismissed" })).toBeNull();
    expect(subject.status).toBe("dismissed");
    expect(applyStatus(subject, { status: "deleted" })?.code).toBe(400);
    expect(subject.status).toBe("dismissed");
  });

  it("refuses a task id that would read outside the tasks directory", () => {
    expect(taskFile("a-task-2026-09-05T08-05-24-318Z")).not.toBeNull();
    for (const hostile of ["../recordings/x", "..", "a/b", "with.dots", ""]) {
      expect(taskFile(hostile), `let "${hostile}" through`).toBeNull();
    }
  });
});
