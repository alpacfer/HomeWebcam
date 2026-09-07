@AGENTS.md

## Claude Code

- Read `docs/architecture.md` before your first change in a new session. It is
  short and it explains the seams that `AGENTS.md` only names.
- Run `npm run check` before you commit. It is biome + tsc + vitest + the record
  and stylesheet guards, in one.
- **Ask the station before you write a script.** `npm run station -- state`
  returns one typed snapshot of everything it is doing. Nine throwaway CDP
  scripts in one session is what happened before it existed; see friction 0009.
- **Drive interactions with `npm run verify`, not with a person.** Thirty-four
  checks, about two minutes, scripted hands. It cannot verify perception, and
  it says so loudly - a screenshot taken under it wears a badge. Read
  [ADR 0011](docs/adr/0011-puppet-perception.md) before quoting one as evidence.
- **When you need a body in the room, ask for one.** `npm run task -- new
  "<title>" "<step>" ...` puts the question on the station's debug view; each
  step records itself, and `npm run task -- show latest` gives you the take, the
  note and a digest of what the models made of it. See ADR 0015.
- Screenshots are mandatory for UI changes. `npm run station -- shoot out.png
  --crop menu --zoom 3` crops and scales in the same call. Capture one image per
  state you touched.
- When you make a decision a future reader would question, add a file under
  `docs/adr/`. Follow the numbering and the existing four-heading shape.
