/**
 * Stylesheet invariants that a linter has no opinion about.
 *
 * Only one so far, and it exists because of friction 0004: three progress arcs
 * were written as three separate conic gradients, all three of them running
 * backwards, and a ring at 0% or 100% looks identical whichever way it fills.
 * Keeping exactly one gradient means there is exactly one place to get it wrong
 * and exactly one place to check.
 */
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const file = "src/ui/styles.css";
const css = await readFile(join(root, file), "utf8");

const arcs = css.match(/conic-gradient\(/g)?.length ?? 0;
if (arcs > 1) {
  throw new Error(
    `${file}: ${arcs} conic gradients. Every progress arc in this interface is the\n` +
      `shared .ring class, so that its fill direction is defined once. Give the new\n` +
      `one a .ring element and set --progress on it instead. See docs/frictions/0004.`,
  );
}

console.log(`[styles] ${file}: ${arcs} progress arc definition`);
