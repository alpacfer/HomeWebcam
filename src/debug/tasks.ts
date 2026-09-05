import { CONFIG } from "../config.js";
import { requireElement } from "../lib/assert.js";
import type { TraceDigest } from "./trace.js";

/**
 * Tasks: a way to ask the person at the station to do something in front of the
 * camera, and get the recording back.
 *
 * The station's hardest bugs need a body in the room - a hand at the wrong
 * angle, a face against a bright window, a gesture the model only fails on when
 * a real arm makes it. Whoever is writing the code is usually not the person
 * standing there, and "can you wave at it and tell me what happened" loses
 * everything except the sentence that comes back.
 *
 * So a task is written from the keyboard, appears in the debug view, and each
 * of its steps is a button that records while it is being performed. What comes
 * back is the take, the trace, and its digest, filed against the step it
 * answers. See docs/adr/0015-camera-tasks.md.
 */

export interface TaskRun {
  /** The recording's filename stem: `<stem>.webm` and `<stem>.json`. */
  recording: string;
  at: string;
  /** What the person said about it. The one thing the video cannot report. */
  note: string;
  /**
   * "puppet" means scripted hands answered this step, not a person. It travels
   * with the run because the digest is read far from the recording, and a
   * digest of invented hands must never be read as camera evidence. See ADR 0011.
   */
  perceptionSource: "camera" | "puppet" | "unknown";
  digest: TraceDigest;
}

export interface TaskStep {
  id: string;
  instruction: string;
  runs: TaskRun[];
}

export type TaskStatus = "open" | "done" | "dismissed";

export interface DebugTask {
  id: string;
  title: string;
  /** Why it is being asked, in one or two lines. Shown under the title. */
  description: string;
  createdAt: string;
  status: TaskStatus;
  steps: TaskStep[];
}

/** What a take is answering. Travels into the recording's manifest. */
export interface TaskAssignment {
  taskId: string;
  taskTitle: string;
  stepId: string;
  /** 1-based, because it is read by a person standing in a hallway. */
  stepNumber: number;
  instruction: string;
}

/** Everything the panel needs from the world, so a test can hand it a fake. */
export interface TaskStore {
  list(): Promise<DebugTask[]>;
  attach(taskId: string, run: TaskRun & { stepId: string }): Promise<void>;
  setStatus(taskId: string, status: TaskStatus): Promise<void>;
}

export interface TaskRecorder {
  /** Starts a take against this step. Throws if one is already running. */
  start(assignment: TaskAssignment): void;
  stop(): void;
  /** The step a take is currently running for, if any. */
  assignment(): TaskAssignment | null;
}

/** A task as the station's snapshot reports it: enough to drive it, not to read it. */
export interface TaskSummary {
  id: string;
  title: string;
  status: TaskStatus;
  steps: Array<{ id: string; answered: boolean }>;
}

export interface TaskPanelState {
  visible: boolean;
  open: number;
  /** The tasks on screen, in the order they are shown. */
  showing: TaskSummary[];
  recordingFor: { taskId: string; stepId: string } | null;
  error: string | null;
}

/** The localhost store. The endpoint lives in vite.config.ts. */
export function httpTaskStore(): TaskStore {
  return {
    async list() {
      const response = await fetch("/api/tasks", { cache: "no-store" });
      if (!response.ok) throw new Error(`task server returned ${response.status}`);
      const body = (await response.json()) as { tasks?: unknown };
      return Array.isArray(body.tasks) ? (body.tasks as DebugTask[]) : [];
    },
    async attach(taskId, run) {
      await post(`/api/tasks/${encodeURIComponent(taskId)}/runs`, run);
    },
    async setStatus(taskId, status) {
      await post(`/api/tasks/${encodeURIComponent(taskId)}/status`, { status });
    },
  };
}

async function post(url: string, body: unknown): Promise<void> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`task server returned ${response.status}`);
}

/**
 * The list of tasks in the debug view, and the buttons that record them.
 *
 * It polls rather than being pushed to: a task is written by a command line
 * that may be running on the other side of the room, minutes before anyone
 * walks up to the station. Polling only happens while the panel is visible, so
 * a mirror in final mode asks the server for nothing.
 */
export class TaskPanel {
  private readonly root: HTMLElement;
  private readonly list: HTMLElement;
  private readonly empty: HTMLElement;
  private readonly error: HTMLElement;

  private tasks: DebugTask[] = [];
  private visible = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastError: string | null = null;
  private refreshing: Promise<void> | null = null;

  constructor(
    root: ParentNode,
    private readonly store: TaskStore,
    private readonly recorder: TaskRecorder,
  ) {
    this.root = requireElement(root, "#tasks", HTMLElement);
    this.list = requireElement(root, "#tasks-list", HTMLElement);
    this.empty = requireElement(root, "#tasks-empty", HTMLElement);
    this.error = requireElement(root, "#tasks-error", HTMLElement);
    this.setVisible(false);
  }

  get state(): TaskPanelState {
    const assignment = this.recorder.assignment();
    return {
      visible: this.visible,
      open: this.tasks.filter((task) => task.status === "open").length,
      showing: this.tasks.map((task) => ({
        id: task.id,
        title: task.title,
        status: task.status,
        steps: task.steps.map((step) => ({ id: step.id, answered: step.runs.length > 0 })),
      })),
      recordingFor:
        assignment === null ? null : { taskId: assignment.taskId, stepId: assignment.stepId },
      error: this.lastError,
    };
  }

  /** Debug camera mode only, like everything else a developer touches. */
  setVisible(visible: boolean): void {
    this.visible = visible;
    this.root.classList.toggle("tasks--hidden", !visible);
    this.root.setAttribute("aria-hidden", String(!visible));
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    if (!visible) return;
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), CONFIG.tasks.pollMs);
  }

  /** Re-reads the list. Safe to call at any time; overlapping calls collapse. */
  refresh(): Promise<void> {
    this.refreshing ??= this.load().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  /** Files a finished take against the step it was recorded for. */
  async attach(assignment: TaskAssignment, run: Omit<TaskRun, "at">): Promise<void> {
    await this.store.attach(assignment.taskId, {
      stepId: assignment.stepId,
      at: new Date().toISOString(),
      ...run,
    });
    await this.refresh();
  }

  /**
   * Presses a step's button by name, for the station CLI. It goes through the
   * same path a finger does, so what it exercises is what a person exercises.
   */
  recordStep(taskId: string, stepId: string): void {
    const task = this.tasks.find((candidate) => candidate.id === taskId);
    if (task === undefined) throw new Error(`no task "${taskId}"`);
    const index = task.steps.findIndex((step) => step.id === stepId);
    const step = task.steps[index];
    if (step === undefined) throw new Error(`task "${taskId}" has no step "${stepId}"`);
    this.toggle({
      taskId: task.id,
      taskTitle: task.title,
      stepId: step.id,
      stepNumber: index + 1,
      instruction: step.instruction,
    });
  }

  private async load(): Promise<void> {
    try {
      this.tasks = await this.store.list();
      this.lastError = null;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
    }
    this.render();
  }

  private render(): void {
    this.error.textContent = this.lastError === null ? "" : `tasks: ${this.lastError}`;
    this.error.hidden = this.lastError === null;

    const shown = this.tasks.filter((task) => task.status !== "dismissed");
    this.empty.hidden = shown.length > 0;
    this.list.replaceChildren(...shown.map((task) => this.buildTask(task)));
  }

  private buildTask(task: DebugTask): HTMLElement {
    const element = document.createElement("li");
    element.className = "task";
    element.dataset.task = task.id;
    element.dataset.status = task.status;

    const head = document.createElement("div");
    head.className = "task__head";

    const title = document.createElement("strong");
    title.className = "task__title";
    title.textContent = task.title;

    const dismiss = document.createElement("button");
    dismiss.type = "button";
    dismiss.className = "task__dismiss";
    dismiss.textContent = "✕";
    dismiss.title = "Take this task off the mirror";
    dismiss.addEventListener("click", () => void this.dismiss(task));

    head.append(title, dismiss);
    element.append(head);

    if (task.description !== "") {
      const description = document.createElement("p");
      description.className = "task__description";
      description.textContent = task.description;
      element.append(description);
    }

    const steps = document.createElement("ol");
    steps.className = "task__steps";
    for (const [index, step] of task.steps.entries()) {
      steps.append(this.buildStep(task, step, index + 1));
    }
    element.append(steps);
    return element;
  }

  private buildStep(task: DebugTask, step: TaskStep, number: number): HTMLElement {
    const item = document.createElement("li");
    item.className = "task__step";
    item.dataset.step = step.id;

    const assignment = this.recorder.assignment();
    const isRecording = assignment?.taskId === task.id && assignment.stepId === step.id;
    if (isRecording) item.dataset.state = "recording";
    else if (step.runs.length > 0) item.dataset.state = "answered";
    else item.dataset.state = "waiting";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "task__record";
    button.append(marker(number, step.runs.length > 0, isRecording), text(step.instruction));
    button.addEventListener("click", () =>
      this.toggle({
        taskId: task.id,
        taskTitle: task.title,
        stepId: step.id,
        stepNumber: number,
        instruction: step.instruction,
      }),
    );
    item.append(button);

    // What was said first, then where the take is. Both in full: the panel does
    // not scroll and does not truncate, so nothing here hides behind a hover.
    for (const run of step.runs) {
      const said = document.createElement("p");
      said.className = "task__run";
      said.textContent = run.note === "" ? "(no note)" : run.note;

      const where = document.createElement("p");
      where.className = "task__run task__run--file";
      // A run written before provenance was carried has none; it is unknown,
      // which is a thing to say out loud rather than the word "undefined".
      const badge =
        run.perceptionSource === "camera" ? "" : `${run.perceptionSource ?? "unknown"} · `;
      where.textContent = `${badge}${run.recording}.webm`;
      item.append(said, where);
    }
    return item;
  }

  private toggle(assignment: TaskAssignment): void {
    const running = this.recorder.assignment();
    try {
      if (running !== null) {
        // Whatever is running stops. Starting a second take on top of a running
        // one would end the first one silently and lose it.
        this.recorder.stop();
        return;
      }
      this.recorder.start(assignment);
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
    }
    this.render();
  }

  private async dismiss(task: DebugTask): Promise<void> {
    try {
      await this.store.setStatus(task.id, "dismissed");
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
    }
    await this.refresh();
  }
}

function marker(number: number, answered: boolean, recording: boolean): HTMLElement {
  const element = document.createElement("span");
  element.className = "task__marker";
  element.textContent = recording ? "■" : answered ? "✓" : String(number);
  element.setAttribute("aria-hidden", "true");
  return element;
}

function text(value: string): HTMLElement {
  const element = document.createElement("span");
  element.className = "task__instruction";
  element.textContent = value;
  return element;
}
