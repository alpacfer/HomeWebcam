/// <reference types="vitest/config" />
import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type Connect, defineConfig, type Plugin } from "vite";

const CAPTURES_DIR = fileURLToPath(new URL("./captures/", import.meta.url));
const RECORDINGS_DIR = fileURLToPath(new URL("./recordings/", import.meta.url));
const TASKS_DIR = fileURLToPath(new URL("./tasks/", import.meta.url));
/** A noisy lossless 1080p frame stays below this; it only rejects malformed local requests. */
const MAX_CAPTURE_BYTES = 20 * 1024 * 1024;
/** 30 s at CONFIG.recording.videoBitsPerSecond is ~30 MB. This leaves headroom. */
const MAX_RECORDING_BYTES = 96 * 1024 * 1024;
/** The trace is the big half of a manifest: 30 s of hands at 60 fps is ~1 MB. */
const MAX_MANIFEST_BYTES = 32 * 1024 * 1024;
/** A task update is a run entry or a status. Anything larger is malformed. */
const MAX_TASK_BYTES = 256 * 1024;
/**
 * What recordingStem() produces: a slug, then an ISO timestamp with its colons
 * and dots swapped out, so the T and the Z are why this is not lowercase-only.
 * The pattern shipped lowercase-only once and rejected every stem the same file
 * had just generated; recordingFile() no longer trusts it alone.
 */
const STEM = /^[a-z0-9][A-Za-z0-9-]{0,120}$/;

function localFilesPlugin(): Plugin {
  const captures = captureMiddleware();
  const recordings = recordingMiddleware();
  const tasks = taskMiddleware();
  const mount = (server: { middlewares: Connect.Server }): void => {
    server.middlewares.use(localAssets());
    server.middlewares.use("/api/missing", (_request, response) => {
      sendJson(response, 200, { missing: [...missingAssets] });
    });
    server.middlewares.use("/api/captures", captures);
    server.middlewares.use("/api/recordings", recordings);
    server.middlewares.use("/api/tasks", tasks);
  };
  return {
    name: "homewebcam-local-files",
    configureServer: mount,
    configurePreviewServer: mount,
  };
}

/**
 * Serves the model files and the ONNX runtime as the bytes they are.
 *
 * Two problems, both of which reach the app as an error about the wrong thing.
 *
 * The speech worker's runtime `import()`s its own glue module out of
 * public/onnx/. Vite sees a dynamic import, appends `?import`, and refuses the
 * request with "This file is in /public ... should not be imported from source
 * code" - a 500 the app reports as "no available backend found".
 *
 * And a model file that is not there does not 404: Vite answers with index.html
 * and a 200, so a missing 30 MB weight file arrives as HTML and the runtime
 * says "protobuf parsing failed", naming neither the file nor the reason.
 *
 * Dropping the query and answering a real 404 turns both back into what they
 * are. It runs ahead of Vite's own middlewares because it is registered
 * directly rather than from the closure Vite calls afterwards. See friction 0021.
 */
/**
 * Local asset paths that were asked for and are not there. Readable at
 * /api/missing, because the thing that asked is a WASM runtime inside a worker
 * and its own account of the problem names no file.
 */
const missingAssets = new Set<string>();

function localAssets(): Connect.NextHandleFunction {
  const roots = ["/onnx/", "/models/", "/mediapipe/"];
  return (request, response, next) => {
    const url = request.url ?? "";
    if (!roots.some((root) => url.startsWith(root))) {
      next();
      return;
    }
    const path = url.split("?")[0] ?? url;
    request.url = path;
    void stat(fileURLToPath(new URL(`./public${path}`, import.meta.url)))
      .then(() => next())
      .catch(() => {
        // Not index.html with a 200. A missing model is a missing model, and
        // it is named here as well, because the runtime that asked for it will
        // only say "protobuf parsing failed". See friction 0021.
        missingAssets.add(path);
        console.warn(`[HomeWebcam] missing local asset: ${path}`);
        sendJson(response, 404, { error: `No such local asset: ${path}` });
      });
  };
}

function captureMiddleware(): Connect.NextHandleFunction {
  return (request, response, next) => {
    if (request.method !== "POST") {
      next();
      return;
    }
    if (!request.headers["content-type"]?.startsWith("image/png")) {
      sendJson(response, 415, { error: "Expected an image/png body" });
      return;
    }

    void readBody(request, response, MAX_CAPTURE_BYTES, "Capture").then((png) => {
      if (png === null) return;
      if (!hasSignature(png, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
        sendJson(response, 400, { error: "Capture is not a PNG" });
        return;
      }

      const filename = `picture-${stamp()}-${randomUUID().slice(0, 8)}.png`;
      void mkdir(CAPTURES_DIR, { recursive: true })
        .then(() => writeFile(resolve(CAPTURES_DIR, filename), png, { flag: "wx" }))
        .then(() => sendJson(response, 201, { filename }))
        .catch((error: unknown) => {
          console.error("[HomeWebcam] failed to save capture", error);
          sendJson(response, 500, { error: "Capture could not be saved" });
        });
    });
  };
}

/**
 * Debug recordings: a WebM of what the perception models were given, and a JSON
 * manifest describing it. See docs/adr/0014-debug-recordings.md.
 *
 * Two posts, manifest first. The manifest names the take, so the server can
 * derive the filename from words a person typed rather than from a UUID, and so
 * a video upload that dies still leaves a labelled record of what was being
 * recorded. The browser never supplies a path: it gets a stem back and quotes
 * it, and this checks that stem against its own pattern and against a manifest
 * it wrote itself before touching the disk again.
 */
function recordingMiddleware(): Connect.NextHandleFunction {
  return (request, response, next) => {
    if (request.method !== "POST") {
      next();
      return;
    }
    const contentType = request.headers["content-type"] ?? "";

    if (contentType.startsWith("application/json")) {
      void readBody(request, response, MAX_MANIFEST_BYTES, "Manifest").then((body) => {
        if (body === null) return;
        void saveManifest(body, response);
      });
      return;
    }

    if (contentType.startsWith("video/webm")) {
      const stem = String(request.headers["x-recording-stem"] ?? "");
      if (recordingFile(stem, ".webm") === null) {
        sendJson(response, 400, { error: "Missing or malformed X-Recording-Stem" });
        return;
      }
      void readBody(request, response, MAX_RECORDING_BYTES, "Recording").then((video) => {
        if (video === null) return;
        // EBML, which is what a WebM file starts with.
        if (!hasSignature(video, [0x1a, 0x45, 0xdf, 0xa3])) {
          sendJson(response, 400, { error: "Recording is not a WebM file" });
          return;
        }
        void saveVideo(stem, video, response);
      });
      return;
    }

    sendJson(response, 415, { error: "Expected an application/json or video/webm body" });
  };
}

async function saveManifest(body: Buffer, response: ServerResponse): Promise<void> {
  let manifest: { name?: unknown; description?: unknown };
  try {
    manifest = JSON.parse(body.toString("utf8")) as typeof manifest;
  } catch {
    sendJson(response, 400, { error: "Manifest is not valid JSON" });
    return;
  }
  if (typeof manifest.name !== "string" || manifest.name.trim() === "") {
    sendJson(response, 400, { error: "A recording needs a name" });
    return;
  }

  const stem = recordingStem(manifest.name);
  const file = recordingFile(stem, ".json");
  if (file === null) {
    // Unreachable unless recordingStem and STEM have drifted apart, which is
    // exactly the bug this pair of functions exists to make impossible.
    sendJson(response, 500, { error: "Could not name that recording" });
    return;
  }
  try {
    await mkdir(RECORDINGS_DIR, { recursive: true });
    await writeFile(file, body, { flag: "wx" });
    sendJson(response, 201, { stem });
  } catch (error) {
    console.error("[HomeWebcam] failed to save recording manifest", error);
    sendJson(response, 500, { error: "Manifest could not be saved" });
  }
}

async function saveVideo(stem: string, video: Buffer, response: ServerResponse): Promise<void> {
  const manifest = recordingFile(stem, ".json");
  const file = recordingFile(stem, ".webm");
  if (manifest === null || file === null) {
    sendJson(response, 400, { error: "Missing or malformed X-Recording-Stem" });
    return;
  }
  try {
    // The stem has to name a manifest this server just wrote. A video with no
    // manifest is an unlabelled film of whoever was standing in the hallway.
    await stat(manifest);
  } catch {
    sendJson(response, 409, { error: "No manifest was posted for that recording" });
    return;
  }
  try {
    await writeFile(file, video, { flag: "wx" });
    sendJson(response, 201, { filename: `${stem}.webm` });
  } catch (error) {
    console.error("[HomeWebcam] failed to save recording", error);
    sendJson(response, 500, { error: "Recording could not be saved" });
  }
}

/**
 * Tasks: things to go and do in front of the camera, written from a keyboard.
 * See docs/adr/0015-camera-tasks.md and scripts/tasks.mjs.
 *
 * The files are the source of truth and the command line writes them directly,
 * so this only reads the directory and appends what the station produces: a run
 * against a step, or a status. Everything the browser can change is a small,
 * shaped value; it can never write a task's text.
 */
function taskMiddleware(): Connect.NextHandleFunction {
  return (request, response, next) => {
    const path = (request.url ?? "/").split("?")[0] ?? "/";

    if (request.method === "GET" && (path === "/" || path === "")) {
      void listTasks(response);
      return;
    }

    const match = /^\/([^/]+)\/(runs|status)$/.exec(path);
    if (request.method === "POST" && match !== null) {
      const id = decodeURIComponent(match[1] ?? "");
      const what = match[2] ?? "";
      void readBody(request, response, MAX_TASK_BYTES, "Task update").then((body) => {
        if (body === null) return;
        void updateTask(id, what, body, response);
      });
      return;
    }

    next();
  };
}

async function listTasks(response: ServerResponse): Promise<void> {
  try {
    const files = (await readdir(TASKS_DIR).catch(() => [])).filter((file) =>
      file.endsWith(".json"),
    );
    const tasks = [];
    for (const file of files) {
      const task = await readTask(file.replace(/\.json$/, ""));
      if (task !== null) tasks.push(task);
    }
    // Oldest first: the list is a queue, and the person works down it.
    tasks.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    sendJson(response, 200, { tasks });
  } catch (error) {
    console.error("[HomeWebcam] failed to list tasks", error);
    sendJson(response, 500, { error: "Tasks could not be listed" });
  }
}

async function updateTask(
  id: string,
  what: string,
  body: Buffer,
  response: ServerResponse,
): Promise<void> {
  const file = taskFile(id);
  if (file === null) {
    sendJson(response, 400, { error: "Malformed task id" });
    return;
  }
  const task = await readTask(id);
  if (task === null) {
    sendJson(response, 404, { error: "No such task" });
    return;
  }

  let update: Record<string, unknown>;
  try {
    update = JSON.parse(body.toString("utf8")) as Record<string, unknown>;
  } catch {
    sendJson(response, 400, { error: "Update is not valid JSON" });
    return;
  }

  const applied = what === "status" ? applyStatus(task, update) : applyRun(task, update);
  if (applied !== null) {
    sendJson(response, applied.code, { error: applied.error });
    return;
  }

  try {
    await writeFile(file, `${JSON.stringify(task, null, 2)}\n`);
    sendJson(response, 200, { status: String(task.status) });
  } catch (error) {
    console.error("[HomeWebcam] failed to update task", error);
    sendJson(response, 500, { error: "Task could not be updated" });
  }
}

/** Why an update was refused, or null when it was applied to `task` in place. */
interface Refusal {
  code: number;
  error: string;
}

export function applyStatus(
  task: Record<string, unknown>,
  update: Record<string, unknown>,
): Refusal | null {
  const status = update.status;
  if (status !== "open" && status !== "done" && status !== "dismissed") {
    return { code: 400, error: "Status must be open, done or dismissed" };
  }
  task.status = status;
  return null;
}

/**
 * Files a take against the step it answers.
 *
 * The shape is copied field by field rather than spread, because a task file is
 * read back by a command line months later and should hold what this server
 * understands. That has a cost, paid once already: `perceptionSource` was added
 * to the browser and not here, so every run was written with its provenance
 * missing and a puppet's numbers read like a person's. See friction 0020.
 */
export function applyRun(
  task: Record<string, unknown>,
  update: Record<string, unknown>,
): Refusal | null {
  const steps = Array.isArray(task.steps) ? (task.steps as Array<Record<string, unknown>>) : [];
  const step = steps.find((candidate) => candidate.id === update.stepId);
  if (step === undefined) return { code: 404, error: "No such step" };
  if (typeof update.recording !== "string") {
    return { code: 400, error: "A run names its recording" };
  }

  const runs = Array.isArray(step.runs) ? step.runs : [];
  runs.push({
    recording: update.recording,
    at: typeof update.at === "string" ? update.at : new Date().toISOString(),
    note: typeof update.note === "string" ? update.note : "",
    // Anything but a clear "camera" is stored as unknown rather than as camera.
    // A run whose provenance was lost must not read as evidence about the
    // models; the safe default is the suspicious one. See ADR 0011.
    perceptionSource:
      update.perceptionSource === "camera" || update.perceptionSource === "puppet"
        ? update.perceptionSource
        : "unknown",
    digest: update.digest ?? null,
  });
  step.runs = runs;

  // A task answers itself: every step with a take on it is a task finished, and
  // nothing has to remember to say so.
  const answered = steps.every((candidate) => (candidate.runs as unknown[] | undefined)?.length);
  if (task.status === "open" && answered) task.status = "done";
  return null;
}

async function readTask(id: string): Promise<Record<string, unknown> | null> {
  const file = taskFile(id);
  if (file === null) return null;
  try {
    return JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Where a task id is allowed to read and write, or null. Same two gates as a
 * recording's stem: the pattern, then containment. See friction 0017. */
export function taskFile(id: string): string | null {
  if (!STEM.test(id)) return null;
  const file = resolve(TASKS_DIR, `${id}.json`);
  return file.startsWith(TASKS_DIR) ? file : null;
}

/**
 * Collects a request body, or answers the request itself and resolves null.
 * The size limit is what stops a malformed local request from being read into
 * memory until the station falls over.
 */
function readBody(
  request: IncomingMessage,
  response: ServerResponse,
  limit: number,
  what: string,
): Promise<Buffer | null> {
  return new Promise((done) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    let settled = false;
    const finish = (value: Buffer | null): void => {
      if (settled) return;
      settled = true;
      done(value);
    };

    request.on("data", (chunk: Buffer) => {
      if (settled) return;
      bytes += chunk.byteLength;
      if (bytes > limit) {
        sendJson(response, 413, { error: `${what} is too large` });
        finish(null);
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => finish(Buffer.concat(chunks)));
    request.on("error", (error) => {
      console.error(`[HomeWebcam] ${what.toLowerCase()} request failed`, error);
      if (!response.headersSent) sendJson(response, 400, { error: `${what} upload failed` });
      finish(null);
    });
  });
}

function hasSignature(body: Buffer, signature: number[]): boolean {
  return body.length >= signature.length && signature.every((byte, i) => body.at(i) === byte);
}

/**
 * The name of a recording's pair of files, without the extension.
 * Exported so a test can check it against the pattern that guards it: the two
 * disagreed once, and a stem the server had just built was rejected as unsafe.
 */
export function recordingStem(name: string): string {
  return `${slugify(name)}-${stamp()}`;
}

/**
 * Where a stem is allowed to write, or null if it is not allowed to.
 *
 * Two gates, because the cheap one has already been wrong: the pattern, and
 * then a containment check on the resolved path, which holds whatever the
 * pattern lets through.
 */
export function recordingFile(stem: string, extension: string): string | null {
  if (!STEM.test(stem)) return null;
  const file = resolve(RECORDINGS_DIR, `${stem}${extension}`);
  return file.startsWith(RECORDINGS_DIR) ? file : null;
}

/** Filesystem-safe, still readable: the name is how a recording is found later. */
function slugify(name: string): string {
  const slug = name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
  return slug === "" ? "recording" : slug;
}

function stamp(): string {
  return new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
}

function sendJson(response: ServerResponse, status: number, body: Record<string, unknown>): void {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(body));
}

export default defineConfig({
  plugins: [localFilesPlugin()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    // getUserMedia needs a secure context. 127.0.0.1 and localhost count as
    // secure, so no TLS is needed locally. Serving the kiosk to another machine
    // does need HTTPS - see docs/architecture.md.
  },
  build: {
    target: "es2022",
    sourcemap: true,
  },
  test: {
    // Node, not jsdom: only framework-free logic is unit tested. Anything that
    // touches the camera or MediaPipe is verified by running it.
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
