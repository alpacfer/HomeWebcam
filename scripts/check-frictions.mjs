/** Ensures every friction record is structured, indexed, and has a valid lifecycle state. */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const directory = fileURLToPath(new URL("../docs/frictions/", import.meta.url));
const index = await readFile(join(directory, "README.md"), "utf8");
const files = (await readdir(directory)).filter((file) => /^\d{4}-.+\.md$/.test(file)).sort();
const requiredSections = [
  "## What happened",
  "## Impact",
  "## Root cause",
  "## Correction",
  "## Workflow integration",
  "## Proof",
];
const errors = [];

for (const file of files) {
  const content = await readFile(join(directory, file), "utf8");
  const number = file.slice(0, 4);
  if (!content.startsWith(`# ${number}. `))
    errors.push(`${file}: title must start with "# ${number}. "`);
  if (!/^- Date: \d{4}-\d{2}-\d{2}$/m.test(content)) errors.push(`${file}: missing ISO Date`);
  if (!/^- Status: (open|contained|integrated)$/m.test(content)) {
    errors.push(`${file}: Status must be open, contained, or integrated`);
  }
  if (!/^- Area: .+$/m.test(content)) errors.push(`${file}: missing Area`);
  for (const section of requiredSections) {
    if (!content.includes(section)) errors.push(`${file}: missing ${section}`);
  }
  if (!index.includes(`](${file})`)) errors.push(`${file}: missing from frictions/README.md`);
}

if (files.length === 0) errors.push("No friction records found");
if (errors.length > 0) {
  console.error(
    `[frictions] invalid records:\n${errors.map((error) => `  - ${error}`).join("\n")}`,
  );
  process.exitCode = 1;
} else {
  console.log(`[frictions] ${files.length} structured records indexed`);
}
