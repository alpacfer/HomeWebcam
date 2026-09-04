@AGENTS.md

## Claude Code

- Read `docs/architecture.md` before your first change in a new session. It is
  short and it explains the seams that `AGENTS.md` only names.
- Run `npm run check` before you commit. It is biome + tsc + vitest in one.
- Screenshots are mandatory for UI changes, and `npm run screenshot` exists so
  there is no excuse to skip one. Capture one image per state you touched.
- When you make a decision a future reader would question, add a file under
  `docs/adr/`. Follow the numbering and the existing four-heading shape.
