// Copies WASM runtimes out of node_modules into public/ so the app loads them
// from its own origin instead of a CDN. The station must work offline.
// Runs automatically on `npm install` (postinstall).
import { access, copyFile, cp, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

await copyTree(
  join(root, "node_modules/@mediapipe/tasks-vision/wasm"),
  join(root, "public/mediapipe/wasm"),
);

/*
 * ONNX Runtime, for the speech model (ADR 0016).
 *
 * Two of the builds in dist/, not all of them: the whole directory is 125 MB of
 * variants. The plain one is what a straightforward session loads and the
 * asyncify one is what it actually asked for first - the runtime chooses, and
 * choosing wrong is a "Failed to fetch dynamically imported module" with no
 * hint of which file it wanted. The JSEP build (another 26 MB) is for WebGPU,
 * which the station does not ask for.
 */
await copyFiles(join(root, "node_modules/onnxruntime-web/dist"), join(root, "public/onnx"), [
  "ort-wasm-simd-threaded.wasm",
  "ort-wasm-simd-threaded.mjs",
  "ort-wasm-simd-threaded.asyncify.wasm",
  "ort-wasm-simd-threaded.asyncify.mjs",
]);

async function copyTree(src, dest) {
  if (!(await exists(src))) return;
  await mkdir(dirname(dest), { recursive: true });
  await cp(src, dest, { recursive: true });
  console.log(`[sync-wasm] ${src} -> ${dest}`);
}

async function copyFiles(src, dest, files) {
  if (!(await exists(src))) return;
  await mkdir(dest, { recursive: true });
  for (const file of files) {
    if (!(await exists(join(src, file)))) continue;
    await copyFile(join(src, file), join(dest, file));
  }
  console.log(`[sync-wasm] ${files.length} file(s) ${src} -> ${dest}`);
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    // Dependencies not installed yet. Nothing to do; install will re-run this.
    return false;
  }
}
