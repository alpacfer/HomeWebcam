// Downloads the MediaPipe model files listed in models.json into public/models.
// Models are large binaries and are gitignored, so a fresh clone needs:
//   npm run models
// Already-present files of the expected size are skipped.
import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(
  await import("node:fs/promises").then((fs) => fs.readFile(join(root, "models.json"), "utf8")),
);

const destDir = join(root, manifest.destDir);
await mkdir(destDir, { recursive: true });

let failed = 0;
for (const [name, model] of Object.entries(manifest.models)) {
  const dest = join(destDir, model.file);
  // Whisper arrives as a small tree, not a single file. See models.json.
  await mkdir(dirname(dest), { recursive: true });
  const existing = await stat(dest).catch(() => null);
  if (existing && existing.size === model.bytes) {
    console.log(`[models] ok       ${name} (cached)`);
    continue;
  }

  process.stdout.write(`[models] fetch    ${name} ... `);
  const res = await fetch(model.url);
  if (!res.ok) {
    console.log(`FAILED ${res.status} ${res.statusText}`);
    failed++;
    continue;
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength !== model.bytes) {
    console.log(`SIZE MISMATCH got ${bytes.byteLength}, expected ${model.bytes}`);
    console.log(`         Google may have published a new revision. Verify the file, then`);
    console.log(`         update "bytes" for "${name}" in models.json.`);
    failed++;
    continue;
  }
  await writeFile(dest, bytes);
  console.log(`${(bytes.byteLength / 1e6).toFixed(1)} MB`);
}

if (failed > 0) {
  console.error(`\n[models] ${failed} model(s) failed. The app will not start without them.`);
  process.exit(1);
}
console.log(`\n[models] all models present in ${manifest.destDir}`);
