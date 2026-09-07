// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DebugTask, TaskAssignment, TaskRecorder, TaskStore } from "../../src/debug/tasks.js";
import { TaskPanel } from "../../src/debug/tasks.js";
import { digestTrace } from "../../src/debug/trace.js";

/**
 * The task list, without a station and without a camera.
 *
 * What it can check is the part that decides whether the tool is usable at all:
 * that a step is a button, that pressing it starts a take against that step and
 * pressing again stops it, that an answered step says so, and that a run made
 * by scripted hands is labelled as one wherever a person might read it.
 */
const BODY = readFileSync(resolve(process.cwd(), "index.html"), "utf8")
  .replace(/[\s\S]*<body>/, "")
  .replace(/<\/body>[\s\S]*/, "")
  .replace(/<script[\s\S]*?<\/script>/g, "");

function task(overrides: Partial<DebugTask> = {}): DebugTask {
  return {
    id: "cursor-jumps-2026",
    title: "Cursor jumps between hands",
    description: "It swaps to the other hand when both are up.",
    createdAt: "2026-09-05T08:00:00.000Z",
    status: "open",
    steps: [
      { id: "s1", instruction: "Raise your right hand and point at the tile", runs: [] },
      { id: "s2", instruction: "Now raise the left one as well", runs: [] },
    ],
    ...overrides,
  };
}

function build(tasks: DebugTask[] = [task()]) {
  document.body.innerHTML = BODY;
  let running: TaskAssignment | null = null;

  const store: TaskStore = {
    list: vi.fn(async () => tasks),
    attach: vi.fn(async () => undefined),
    setStatus: vi.fn(async () => undefined),
  };
  const recorder: TaskRecorder = {
    start: vi.fn((assignment: TaskAssignment) => {
      if (running !== null) throw new Error("already recording");
      running = assignment;
    }),
    stop: vi.fn(() => {
      running = null;
    }),
    assignment: () => running,
  };

  const panel = new TaskPanel(document, store, recorder);
  return { panel, store, recorder };
}

function steps(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(".task__step")];
}

function press(index: number): void {
  const button = steps()[index]?.querySelector("button");
  if (!(button instanceof HTMLButtonElement)) throw new Error(`no step ${index}`);
  button.click();
}

describe("TaskPanel", () => {
  beforeEach(() => {
    document.body.innerHTML = BODY;
  });

  it("shows nothing at all until debug mode asks for it", async () => {
    const { panel, store } = build();
    expect(document.getElementById("tasks")?.classList.contains("tasks--hidden")).toBe(true);
    // Not merely hidden: a mirror showing the visitor interface asks the server
    // for nothing at all.
    expect(store.list).not.toHaveBeenCalled();

    panel.setVisible(true);
    await panel.refresh();
    expect(document.getElementById("tasks")?.classList.contains("tasks--hidden")).toBe(false);
    expect(store.list).toHaveBeenCalled();
  });

  it("puts the task on screen with a button for every step", async () => {
    const { panel } = build();
    panel.setVisible(true);
    await panel.refresh();

    expect(document.querySelector(".task__title")?.textContent).toBe("Cursor jumps between hands");
    expect(document.querySelector(".task__description")?.textContent).toContain("both are up");
    const instructions = [...document.querySelectorAll(".task__instruction")].map(
      (element) => element.textContent,
    );
    expect(instructions).toEqual([
      "Raise your right hand and point at the tile",
      "Now raise the left one as well",
    ]);
  });

  it("collapses a task that is done, so an open one stays on the screen", async () => {
    // A done task rendered in full is most of a 1080p panel spent on work
    // nobody has to do, and the open task below it goes off the bottom where
    // the person standing at the station cannot press it. See friction 0029.
    const { panel } = build([
      task({ id: "answered", title: "Already answered", status: "done" }),
      task({ id: "waiting", title: "Still to do" }),
    ]);
    panel.setVisible(true);
    await panel.refresh();

    const titles = [...document.querySelectorAll(".task__title")].map((e) => e.textContent);
    expect(titles).toEqual(["Already answered", "Still to do"]);
    // Every step button on screen belongs to the task that still needs a body.
    const owners = steps().map((step) => step.closest(".task")?.getAttribute("data-task"));
    expect(owners).toEqual(["waiting", "waiting"]);
    const done = document.querySelector('[data-task="answered"]');
    expect(done?.querySelector(".task__description")?.textContent).toContain("answered");
  });

  it("says so when there is nothing to do", async () => {
    const { panel } = build([]);
    panel.setVisible(true);
    await panel.refresh();
    expect(document.getElementById("tasks-empty")?.hidden).toBe(false);
  });

  it("records the step that was pressed, and stops on the second press", async () => {
    const { panel, recorder } = build();
    panel.setVisible(true);
    await panel.refresh();

    press(0);
    expect(recorder.start).toHaveBeenCalledWith({
      taskId: "cursor-jumps-2026",
      taskTitle: "Cursor jumps between hands",
      stepId: "s1",
      stepNumber: 1,
      instruction: "Raise your right hand and point at the tile",
    });
    expect(steps()[0]?.dataset.state).toBe("recording");
    expect(panel.state.recordingFor).toEqual({ taskId: "cursor-jumps-2026", stepId: "s1" });

    press(0);
    expect(recorder.stop).toHaveBeenCalledTimes(1);
    expect(panel.state.recordingFor).toBeNull();
  });

  it("stops the running take rather than starting a second one on top of it", async () => {
    const { panel, recorder } = build();
    panel.setVisible(true);
    await panel.refresh();

    press(0);
    press(1);
    // The second press is a stop, not a start: two takes at once would end the
    // first one silently and lose whatever it caught.
    expect(recorder.start).toHaveBeenCalledTimes(1);
    expect(recorder.stop).toHaveBeenCalledTimes(1);
  });

  it("files a finished take against the step that asked for it", async () => {
    const { panel, store } = build();
    panel.setVisible(true);
    await panel.refresh();

    await panel.attach(
      {
        taskId: "cursor-jumps-2026",
        taskTitle: "Cursor jumps between hands",
        stepId: "s2",
        stepNumber: 2,
        instruction: "Now raise the left one as well",
      },
      {
        recording: "cursor-jumps-step-2-2026",
        note: "It stayed on the right hand.",
        perceptionSource: "camera",
        digest: digestTrace([]),
      },
    );

    expect(store.attach).toHaveBeenCalledWith(
      "cursor-jumps-2026",
      expect.objectContaining({ stepId: "s2", recording: "cursor-jumps-step-2-2026" }),
    );
  });

  it("marks an answered step and names the take under it", async () => {
    const answered = task({
      steps: [
        {
          id: "s1",
          instruction: "Raise your right hand and point at the tile",
          runs: [
            {
              recording: "a-take-2026",
              at: "2026-09-05T08:10:00.000Z",
              note: "nothing happened",
              perceptionSource: "camera",
              digest: digestTrace([]),
            },
          ],
        },
        { id: "s2", instruction: "Now raise the left one as well", runs: [] },
      ],
    });
    const { panel } = build([answered]);
    panel.setVisible(true);
    await panel.refresh();

    expect(steps()[0]?.dataset.state).toBe("answered");
    expect(steps()[1]?.dataset.state).toBe("waiting");
    // The note first, then where the take is: both in full, neither truncated.
    expect(document.querySelector(".task__run")?.textContent).toBe("nothing happened");
    expect(document.querySelector(".task__run--file")?.textContent).toBe("a-take-2026.webm");
  });

  it("says on the mirror when a step was answered by scripted hands", async () => {
    const puppeted = task({
      steps: [
        {
          id: "s1",
          instruction: "Raise your right hand and point at the tile",
          runs: [
            {
              recording: "a-take-2026",
              at: "2026-09-05T08:10:00.000Z",
              note: "",
              perceptionSource: "puppet",
              digest: digestTrace([]),
            },
          ],
        },
      ],
    });
    const { panel } = build([puppeted]);
    panel.setVisible(true);
    await panel.refresh();
    // ADR 0011: an invented answer must be unmistakable wherever it is read.
    expect(document.querySelector(".task__run--file")?.textContent).toContain("puppet");
  });

  it("takes a task off the mirror when it is dismissed", async () => {
    const { panel, store } = build();
    panel.setVisible(true);
    await panel.refresh();

    const dismiss = document.querySelector(".task__dismiss");
    if (!(dismiss instanceof HTMLButtonElement)) throw new Error("no dismiss button");
    dismiss.click();
    await vi.waitFor(() =>
      expect(store.setStatus).toHaveBeenCalledWith("cursor-jumps-2026", "dismissed"),
    );
  });

  it("keeps a dismissed task off the list without being asked twice", async () => {
    const { panel } = build([task({ status: "dismissed" })]);
    panel.setVisible(true);
    await panel.refresh();
    expect(steps()).toHaveLength(0);
    expect(document.getElementById("tasks-empty")?.hidden).toBe(false);
  });

  it("reports a server it cannot reach instead of showing an empty list", async () => {
    document.body.innerHTML = BODY;
    const store: TaskStore = {
      list: vi.fn(async () => {
        throw new Error("task server returned 500");
      }),
      attach: vi.fn(async () => undefined),
      setStatus: vi.fn(async () => undefined),
    };
    const panel = new TaskPanel(document, store, {
      start: vi.fn(),
      stop: vi.fn(),
      assignment: () => null,
    });
    panel.setVisible(true);
    await panel.refresh();

    expect(document.getElementById("tasks-error")?.hidden).toBe(false);
    expect(document.getElementById("tasks-error")?.textContent).toContain("500");
    expect(panel.state.error).toContain("500");
  });
});
