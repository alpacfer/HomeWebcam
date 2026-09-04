// Copies the MediaPipe WASM runtime out of node_modules into public/ so the app
// loads it from its own origin instead of a CDN. The station must work offline.
// Runs automatically on `npm install` (postinstall).
import { access, cp, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "node_modules/@mediapipe/tasks-vision/wasm");
const dest = join(root, "public/mediapipe/wasm");

try {
  await access(src);
} catch {
  // Dependencies not installed yet. Nothing to do; install will re-run this.
  process.exit(0);
}

await mkdir(dirname(dest), { recursive: true });
await cp(src, dest, { recursive: true });
console.log(`[sync-wasm] ${src} -> ${dest}`);
