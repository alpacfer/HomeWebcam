# Development workflow

Every change follows the same loop: **discover → scope → change → verify → integrate → learn**.
The loop applies to humans and agents. A task is not complete because code was written; it is
complete when its behavior is verified and every encountered friction has become a durable project
improvement.

## 1. Discover the live state

Run these before starting runtime work:

```bash
git status --short
npm run preflight
npm run station -- state
```

`station state` is the answer to "what is it doing right now", and it is the first thing to reach
for. Do not write a script to find out; if the snapshot does not carry what you need, add it to
`src/debug/bridge.ts`, where it sits next to the code that produces it. See friction 0009.

Run project commands from the repository root. A shell session keeps its working directory between
commands, so inspect paths outside the repository with absolute paths rather than `cd`; a leaked
directory makes the next `npm run` fail on the wrong `package.json`. See friction 0007.

The server already listening at `http://127.0.0.1:5173` is always the active debug server. Reuse it.
Do not start another server, replace its browser, or open another camera owner.

| Debug server | Browser control | Required action |
| --- | --- | --- |
| Running | Ready | Reuse both. `npm run screenshot` attaches to the live page. |
| Running | Unavailable | Reuse the server. Do not silently open a browser. Report that visual capture is blocked until the existing page exposes control. |
| Not running | Unavailable | Start the station with `./start.sh`. |

An isolated browser is an explicit test environment, not a fallback. Use `--new-browser` or
`--fake-camera` only when the user requested isolation or approved it after the limitation was
explained.

## 2. Scope the change

- Read the closest code, tests, ADRs, and hardware notes before editing.
- Preserve unrelated working-tree changes.
- Put thresholds, durations, dimensions, and quality settings in `src/config.ts`.
- Keep all perception consumers behind `PerceptionFrame` and all coordinates in mirrored screen
  space.
- Identify personal-data effects before implementation. Frames and photos never leave the machine.
- Write an ADR when a future maintainer could reasonably ask “why this mechanism?”

## 3. Change the smallest coherent slice

Implement the full user outcome, including failure feedback and local persistence where relevant.
Add a regression test for pure logic. Keep runtime-only concerns observable in the debug HUD or a
safe local diagnostic rather than inventing a network dependency.

## 4. Verify at the right level

Always run:

```bash
npm run fix
npm run check
git diff --check
```

Review the formatter diff before proceeding so it does not absorb unrelated working-tree changes.

Then verify in proportion to the change, cheapest rung first, and stop at the one that actually
covers the claim you intend to make:

| Rung | Command | Licenses a claim about |
| --- | --- | --- |
| 1 | `npm run check` | Pure logic, types, the visitor interface's DOM behaviour (`tests/dom/`). |
| 2 | `npm run verify` | Interaction, rendering and wiring on the live station, with scripted hands. |
| 3 | `npm run station -- shoot --crop <region>` | What it looks like. |
| 4 | A person in front of the camera | Detection, tracking, gesture recognition, real frame cost. |

Rung 2 invents its hands. It cannot say anything about the models, and a screenshot taken under it
carries a badge saying so. Never move a puppet result up to rung 4 in a handoff. See
[ADR 0011](adr/0011-puppet-perception.md).

Performance numbers belong to rung 4 and must name the camera mode, whether a person was in frame,
and that the station window was focused. Chrome throttles a page nobody is looking at, and the
tooling will tell you so. See friction 0011.

- Pure logic: focused unit tests plus the full check.
- Camera or MediaPipe: the live station, negotiated camera readout, and affected gesture/motion.
- Local persistence: create one disposable artifact, inspect its format and dimensions, then remove
  that test artifact without touching user data. Exercising the picture flow writes a real photograph
  of whoever is at the station, so list `captures/picture-*.png` **before** the run and remove only
  the delta. When a test artifact cannot be distinguished from personal data, leave it and hand the
  decision to the user. See friction 0008.
- Rendered UI: capture every affected mode, state, breakpoint, and theme at its target resolution.
  Use the live controlled page. Put the screenshots in `captures/` and show them in the handoff.
  The attached station holds whatever state the last visitor left, so capture the first-run state
  with `--reload`, and capture any state the app reaches on its own schedule with
  `--after "<js expression>"` rather than by sleeping. Prefer
  `npm run station -- shoot F --crop <region> --zoom N`: it clips and scales in the same call, so a
  detail does not cost a capture, a crop and a second look.
- Direction, phase, and progress are not verifiable by eye. An arc at 0% or 100% looks identical
  whichever way it fills. Pin the value, capture, and sample the pixels. See friction 0004.
- A check that reads a value the app also wrote proves the app agrees with itself. For anything
  about what is *on screen* - visibility, direction, position, colour - read what the browser
  computed or the pixels it drew. A control sat on the visitor's mirror while the snapshot, a verify
  check and a DOM test all called it hidden. See friction 0019.

Do not claim live-camera or gesture verification when only a synthetic feed or keyboard test hook
was exercised. State exactly what was and was not verified.

## 5. Integrate and hand off

- Review the final diff and working-tree status.
- Update current-behavior documentation and the roadmap in the same change.
- Do not commit or push unless asked. When asked, run the full check first and use the default branch.
- Lead the handoff with the outcome, then tests, visual evidence, limitations, and changed files.

## 6. Turn every friction into an improvement

Friction is anything that interrupts the expected path or makes future work less reliable: a user
correction, failed tool or command, incorrect assumption, unclear instruction, environment mismatch,
unsafe fallback, repeated manual step, missing capability, false verification claim, privacy risk,
or workflow bottleneck. Friction does not require blame or a production outage.

For every friction encountered during a task:

1. Contain the immediate problem and preserve user data.
2. Add a numbered record under `docs/frictions/` as soon as the facts are known.
3. Mark it `open`, `contained`, or `integrated`; never imply completion with unresolved work.
4. State the root cause, not only the visible symptom.
5. Fix the product, tooling, documentation, or process behavior.
6. Integrate the learning into code, a test, automation, `AGENTS.md`, or this workflow.
7. Run the proof that the integrated change works, then set the status to `integrated`.
8. Mention the friction record in the final handoff.

Before ending any task, explicitly ask: **What friction occurred, and where was its fix integrated?**
“None” is valid only when the work followed the expected path without a correction, failure,
workaround, ambiguity, or repeated manual effort.

A note by itself is not integration. If automation is impossible, add an exact mandatory checkpoint
and document why it cannot be automated. If a fix cannot be completed in the current task, leave the
record `open` or `contained` with a concrete follow-up; the record still must exist.
