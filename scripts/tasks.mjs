/**
 * Tasks: asking the person at the station to do something in front of the
 * camera, and reading back what came of it.
 *
 *   npm run task -- new "Hand lost when backlit" \
 *     "Stand with the window behind you and raise one hand" \
 *     "Hold a Victory sign until the tile fills" \
 *     --about "The tracker seems to give up when the background is brighter."
 *   npm run task -- list
 *   npm run task -- show latest
 *   npm run task -- show latest --frames 20
 *   npm run task -- done <id> | reopen <id> | rm <id>
 *
 * It writes and reads the files directly rather than going through the station,
 * because writing a task is not asking a running mirror anything and has to
 * work while the station is off. The debug view polls the same directory. The
 * station only ever appends what it produced: a run, or a status.
 *
 * A run's video is real camera footage of whoever was standing there. `show`
 * prints paths and numbers; it never moves an image anywhere.
 */
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const TASKS_DIR = join(root, "tasks");
const RECORDINGS_DIR = join(root, "recordings");

const commands = {
  new: cmdNew,
  list: cmdList,
  show: cmdShow,
  done: (args) => cmdStatus(args, "done"),
  reopen: (args) => cmdStatus(args, "open"),
  dismiss: (args) => cmdStatus(args, "dismissed"),
  rm: cmdRemove,
};

const { positional, flags } = parse(process.argv.slice(2));
const [command = "list", ...rest] = positional;
const run = commands[command];
if (run === undefined) {
  console.error(`Unknown command "${command}". Try: ${Object.keys(commands).join(", ")}`);
  process.exit(1);
}
await run(rest);

// ---------------------------------------------------------------- commands --

/** `new <title> <step...>` - the steps are positional so they read as a list. */
async function cmdNew([title, ...steps]) {
  if (title === undefined) throw new Error('task new needs a title: task new "Title" "step one"');
  if (steps.length === 0) {
    throw new Error("a task needs at least one step; the step is what gets recorded");
  }

  const task = {
    id: `${slugify(title)}-${stamp()}`,
    title,
    description: flags.get("about")?.at(-1) ?? "",
    createdAt: new Date().toISOString(),
    status: "open",
    steps: steps.map((instruction, index) => ({
      id: `s${index + 1}`,
      instruction,
      runs: [],
    })),
  };

  await mkdir(TASKS_DIR, { recursive: true });
  await writeFile(join(TASKS_DIR, `${task.id}.json`), `${JSON.stringify(task, null, 2)}\n`, {
    flag: "wx",
  });
  console.log(`[task] ${task.id}`);
  for (const [index, step] of task.steps.entries()) {
    console.log(`[task]   ${index + 1}. ${step.instruction}`);
  }
  console.log("[task] it is on the station's debug view within a few seconds (press D there)");
}

async function cmdList() {
  const tasks = await readTasks();
  if (tasks.length === 0) {
    console.log("[task] no tasks");
    return;
  }
  for (const task of tasks) {
    const answered = task.steps.filter((step) => step.runs.length > 0).length;
    const invented = task.steps.some((step) =>
      step.runs.some((run) => run.perceptionSource !== "camera"),
    );
    console.log(
      `${statusMark(task.status)} ${task.id}\n` +
        `    ${task.title} · ${answered}/${task.steps.length} steps answered` +
        (invented ? " · ⚠ not all answered by a person" : ""),
    );
  }
}

async function cmdShow([id]) {
  const task = await findTask(id);
  console.log(`${statusMark(task.status)} ${task.title}`);
  console.log(`   ${task.id} · asked ${task.createdAt}`);
  if (task.description !== "") console.log(`   ${task.description}`);

  for (const [index, step] of task.steps.entries()) {
    console.log(`\n  ${index + 1}. ${step.instruction}`);
    if (step.runs.length === 0) {
      console.log("     (not answered yet)");
      continue;
    }
    for (const run of step.runs) {
      console.log(`     recordings/${run.recording}.webm`);
      // ADR 0011: a puppet answer is not evidence about the models, and this is
      // the place a reader is most likely to forget that.
      if (run.perceptionSource !== "camera") {
        console.log(
          `     ⚠ ${String(run.perceptionSource).toUpperCase()} HANDS - not a person in front of` +
            " the camera. Says nothing about detection. See ADR 0011.",
        );
      }
      if (run.note !== "") console.log(`     note: ${run.note}`);
      console.log(`     ${describeDigest(run.digest)}`);
      printPinch(run.digest?.paint);
      const errors = await recordingErrors(run.recording);
      if (errors.length > 0) {
        console.log(`     ⚠ ${errors.length} error(s) while recording:`);
        for (const error of errors.slice(0, 5)) {
          console.log(`       ${error.ms.toFixed(0)} ms  ${error.message}`);
        }
      }
      const frames = Number(flags.get("frames")?.at(-1) ?? 0);
      if (frames > 0) await printFrames(run.recording, frames);
    }
  }
}

async function cmdStatus([id], status) {
  const task = await findTask(id);
  task.status = status;
  await writeFile(join(TASKS_DIR, `${task.id}.json`), `${JSON.stringify(task, null, 2)}\n`);
  console.log(`[task] ${task.id} is now ${status}`);
}

/**
 * Removes a task. Its recordings are left alone: they are camera footage of a
 * person, and deleting those is their decision, not a side effect of tidying a
 * to-do list. The command says where they are.
 */
async function cmdRemove([id]) {
  const task = await findTask(id);
  await rm(join(TASKS_DIR, `${task.id}.json`));
  const kept = task.steps.flatMap((step) => step.runs.map((run) => run.recording));
  console.log(`[task] removed ${task.id}`);
  if (kept.length > 0) {
    console.log(`[task] ${kept.length} recording(s) left in recordings/, to remove by hand:`);
    for (const stem of kept) console.log(`[task]   recordings/${stem}.webm`);
  }
}

// ----------------------------------------------------------------- reading --

async function readTasks() {
  const files = (await readdir(TASKS_DIR).catch(() => [])).filter((file) => file.endsWith(".json"));
  const tasks = [];
  for (const file of files) {
    try {
      tasks.push(JSON.parse(await readFile(join(TASKS_DIR, file), "utf8")));
    } catch {
      console.error(`[task] skipping unreadable ${file}`);
    }
  }
  return tasks.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}

/** `latest`, a full id, or any unambiguous fragment of one. */
async function findTask(id) {
  const tasks = await readTasks();
  if (tasks.length === 0) throw new Error("there are no tasks");
  if (id === undefined || id === "latest") {
    const last = tasks.at(-1);
    if (last === undefined) throw new Error("there are no tasks");
    return last;
  }
  const matches = tasks.filter((task) => task.id === id || task.id.includes(id));
  if (matches.length === 0) throw new Error(`no task matches "${id}"`);
  if (matches.length > 1) {
    throw new Error(
      `"${id}" matches ${matches.length} tasks: ${matches.map((t) => t.id).join(", ")}`,
    );
  }
  return matches[0];
}

async function readManifest(stem) {
  try {
    return JSON.parse(await readFile(join(RECORDINGS_DIR, `${stem}.json`), "utf8"));
  } catch {
    return null;
  }
}

async function recordingErrors(stem) {
  const manifest = await readManifest(stem);
  return Array.isArray(manifest?.errors) ? manifest.errors : [];
}

/**
 * A sampled walk through the trace. Reading a whole trace is not a thing a
 * person does; seeing twenty rows of "hand here, gesture that, cursor there,
 * tile not hovered" is how a recording gets debugged without watching it.
 */
async function printFrames(stem, wanted) {
  const manifest = await readManifest(stem);
  const trace = manifest?.trace;
  if (!Array.isArray(trace) || trace.length === 0) {
    console.log("     (no trace in that recording)");
    return;
  }
  const step = Math.max(1, Math.floor(trace.length / wanted));
  // The pinch column only appears when the take went through Paint mode.
  const painted = trace.some((sample) => sample.scene.paint != null);
  console.log(
    `     ${"t".padStart(7)}  ${"hand".padEnd(22)} ${"cursor".padEnd(15)} ${painted ? `${"pinch".padEnd(14)} ` : ""}scene`,
  );
  for (let i = 0; i < trace.length; i += step) {
    const sample = trace[i];
    const hand = sample.hands[0];
    const cursor = sample.cursor;
    const paint = sample.scene.paint ?? null;
    const pinch =
      paint === null
        ? "-"
        : `${paint.pinch === null ? "-" : paint.pinch.toFixed(2)} ${paint.painting ? "paint" : paint.pinched ? "pinch" : "open"}`;
    console.log(
      `     ${`${(sample.ms / 1000).toFixed(2)}s`.padStart(7)}  ` +
        `${(hand === undefined ? "-" : `${hand.side} ${hand.gesture}@${hand.confidence.toFixed(2)}`).padEnd(22)} ` +
        `${(cursor.position === null ? "-" : `${cursor.position.x.toFixed(2)},${cursor.position.y.toFixed(2)} d${(cursor.dwell * 100).toFixed(0)}%`).padEnd(15)} ` +
        (painted ? `${pinch.padEnd(14)} ` : "") +
        `${sample.scene.mode}/${sample.scene.phase}` +
        `${sample.scene.menu.hovered === null ? "" : ` over ${sample.scene.menu.hovered}`}` +
        `${paint?.hovered == null ? "" : ` over ${paint.hovered}`}`,
    );
  }
}

// ------------------------------------------------------------------ shared --

/**
 * The same one-liner the browser writes, reimplemented rather than imported:
 * this file is plain Node with no build step, and src/debug/trace.ts is
 * TypeScript. Both are checked against the same digest by npm run check.
 */
function describeDigest(digest) {
  if (digest === null || digest === undefined) return "no digest";
  const percent = (value) => `${Math.round(value * 100)}%`;
  const gestures = (digest.gestures ?? [])
    .slice(0, 3)
    .map((entry) => `${entry.gesture} ${percent(entry.frames / Math.max(digest.frames, 1))}`)
    .join(", ");
  return (
    `${(digest.durationMs / 1000).toFixed(1)} s · ${digest.frames} frames at ` +
    `${digest.fps.median.toFixed(0)} fps · hands ${percent(digest.handsSeen)} · ` +
    `faces ${percent(digest.facesSeen)} · cursor ${percent(digest.cursorSeen)}` +
    (gestures === "" ? "" : ` · ${gestures}`) +
    (digest.activations > 0 ? ` · ${digest.activations} activation(s)` : "") +
    (digest.maxDwell > 0 ? ` · dwell peaked ${percent(digest.maxDwell)}` : "") +
    (digest.paint === null || digest.paint === undefined
      ? ""
      : ` · pinched ${percent(digest.paint.pinched)} · ${describeStrokes(digest.paint)}` +
        ` · pinch ${digest.paint.pinch.min.toFixed(2)}-${digest.paint.pinch.max.toFixed(2)}` +
        (digest.paint.metres == null
          ? ""
          : ` · ${(digest.paint.metres.min * 1000).toFixed(0)}-${(digest.paint.metres.max * 1000).toFixed(0)} mm`) +
        (digest.paint.tools.length > 1 ? ` · ${digest.paint.tools.length} tools` : ""))
  );
}

/** Mirrors describeStrokes in src/debug/trace.ts. Old digests have no strokesDrawn. */
function describeStrokes(paint) {
  if (paint.strokesDrawn === undefined) return `${paint.strokes} stroke(s) on the glass`;
  return paint.strokesDrawn === paint.strokes
    ? `${paint.strokesDrawn} line(s) drawn`
    : `${paint.strokesDrawn} line(s) drawn, ${paint.strokes} on the glass`;
}

/**
 * Where this person's pinch actually sits, as a picture.
 *
 * The whole point of the histogram is the *valley*: a hand meaning to paint and
 * the same hand merely moving are two clusters, and the threshold belongs
 * between them. Min and max cannot show that and a median hides it. Each row
 * says what a hand at that ratio would do under the gate the take was made
 * with, so the reading is "the cluster I meant is on the wrong side of this".
 */
function printPinch(paint) {
  const hist = paint?.histogram ?? [];
  if (hist.length === 0) return;
  const gate = paint.gate ?? { closeBelow: 0, openAbove: 0 };
  const frames = hist.reduce((sum, bucket) => sum + bucket.frames, 0);
  const widest = Math.max(...hist.map((bucket) => bucket.frames));
  console.log(
    `     pinch over ${frames} frames with a hand · gate: starts a line below ` +
      `${gate.closeBelow}, ends one above ${gate.openAbove}`,
  );

  // Every bucket from the lowest to the highest, empty ones included: a gap in
  // the middle is the answer, so it has to be drawn rather than skipped.
  const step = 0.05;
  const first = hist[0].at;
  const last = hist[hist.length - 1].at;
  for (let at = first; at <= last + 1e-9; at += step) {
    const bucket = hist.find((b) => Math.abs(b.at - at) < 1e-9);
    const n = bucket?.frames ?? 0;
    const would = at < gate.closeBelow ? "starts" : at >= gate.openAbove ? "ends" : "holds";
    const bar = "█".repeat(Math.round((n / widest) * 34));
    console.log(`     ${at.toFixed(2)}  ${would.padEnd(6)} ${bar}${n === 0 ? "" : ` ${n}`}`);
  }

  // The sharpest number in the file: what the gate let through to begin a line.
  // A line the person did not mean to draw names the threshold that allowed it.
  if (Array.isArray(paint.strokeStarts) && paint.strokeStarts.length > 0) {
    console.log(
      `     ${paint.strokeStarts.length} line(s) began at ${paint.strokeStarts.join(", ")}`,
    );
  }
}

function statusMark(status) {
  if (status === "done") return "[done]     ";
  if (status === "dismissed") return "[dismissed]";
  return "[open]     ";
}

function slugify(name) {
  const slug = name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
  return slug === "" ? "task" : slug;
}

function stamp() {
  return new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
}

/** Like scripts/lib/cdp.mjs's args(), but a flag may be given more than once. */
function parse(argv) {
  const positional = [];
  const flags = new Map();
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }
    const name = token.slice(2);
    const next = argv[i + 1];
    const value = next === undefined || next.startsWith("--") ? "true" : next;
    if (value !== "true") i++;
    flags.set(name, [...(flags.get(name) ?? []), value]);
  }
  return { positional, flags };
}
