# HomeWebcam

An interactive mirror. A webcam, a screen and a PC in the hallway; visitors walk
up and drive the interface with their hands, face and body. No keyboard, no
mouse, no touch. The camera feed is the background of the whole UI.

Browser app: TypeScript + Vite, no UI framework. Perception is MediaPipe Tasks
Vision (WASM + WebGL), running fully on-device.

## Commands

`./start.sh` (or double-clicking `HomeWebcam.desktop`) sets everything up and
opens the mirror. That is the path for running the station. For working on it:

```bash
npm install          # also copies the MediaPipe WASM runtime into public/
npm run models       # downloads model files into public/models/ (required once)
npm run dev          # http://127.0.0.1:5173
npm run preflight    # read-only report of server and browser-control state
npm run check        # biome + tsc + vitest + records. Must pass before you commit.
npm run fix          # auto-fix formatting and lint
npm run station      # ask the live station anything. Start here.
npm run verify       # drive every interaction through the live station, ~30 s
npm run screenshot   # attaches to start.sh's live Chrome when available
```

### Asking the station

`npm run station -- <command>` attaches to the Chrome `./start.sh` already
opened. It never launches a browser: `/dev/video0` allows one owner.

| Command | For |
| --- | --- |
| `state` | One snapshot: camera, detectors, hands, cursor, mode, phase, every panel's travel, lean, glow and progress, and any words on screen. **Run this before writing any script.** |
| `shoot F --crop menu --zoom 3` | Capture, cropped to a named region and scaled, in one call. Regions: `menu`, `tile`, `countdown`, `status`, `hud`, or `x,y,w,h`. |
| `watch ".menu.panels[0].glow"` | Poll a snapshot path or expression; reports min/median/max, and can `--shoot-when` a condition fires. |
| `probe SEL --ring --style a,b` | Geometry, computed styles, and which way a progress arc is *actually* filled, read off the pixels. |
| `perf --glass` | Frame-rate A/B with CSS overrides. Warns when the window is unfocused, because then it is measuring the throttle. |
| `puppet wave\|point\|victory\|palm\|both\|stop` | Drive scripted hands into the running app. |
| `verify` | All thirteen interaction checks, with screenshots. |

Add `--reload` to `state`, `shoot` and `screenshot` to put the station back to
what a visitor sees first; it keeps whatever state the last person left.

Run `./start.sh` for station work. It starts the dev server and a dedicated
Chrome app with a localhost-only control endpoint, so agents can inspect and
capture the live real-camera UI without opening a competing camera process.

## Mandatory work loop

Follow [docs/development-workflow.md](docs/development-workflow.md) for every change: discover,
scope, change, verify, integrate, and learn. Start runtime work with `npm run preflight`.

The server already listening on `127.0.0.1:5173` is always the active debug server. Reuse it. Never
start a replacement server or silently open a fallback browser/camera. An isolated browser is
allowed only when the user explicitly requests or approves one.

Every friction gets an append-only record in [docs/frictions/](docs/frictions/README.md): user
corrections, command/tool failures, wrong assumptions, ambiguity, environment mismatches, unsafe
fallbacks, repeated manual work, capability gaps, privacy concerns, and workflow bottlenecks. Fix or
contain the immediate problem, integrate the improvement into code/tests/automation/guidance, and
verify it. Before every handoff, ask what friction occurred and cite its record; if unresolved, leave
it explicitly `open` or `contained`.

## Verifying a change, in order of cost

1. `npm run check` - types, lint, unit tests, friction records, stylesheet rules.
   The DOM lane in `tests/dom/` covers the visitor interface with no station.
2. `npm run verify` - every interaction, driven by scripted hands, ~30 s.
3. `npm run station -- shoot ... --crop <region>` - the picture for the handoff.
4. A person in front of the camera - and **only** this last one licenses a claim
   about detection, tracking, gesture recognition or real frame cost. See
   [ADR 0011](docs/adr/0011-puppet-perception.md).

## Layout

```
src/
  config.ts              Every tunable. Nothing else hardcodes a threshold.
  app.ts                 Frame loop. Wires camera -> perception -> UI.
  camera/camera.ts        getUserMedia, readiness, negotiated-settings readout.
  perception/
    types.ts             THE CONTRACT. Read this first.
    engine.ts            Runs the detectors, assembles a PerceptionFrame.
    detectors/hands.ts    Hand landmarks + gestures (one MediaPipe pass).
    detectors/faces.ts    Face boxes + stable track ids.
    mirror.ts            The camera-to-screen x flip. The ONLY place it happens.
    detectors/identity.ts "Who is this?" - deliberately a no-op. See ADR 0003.
    tracker.ts           Centroid tracker that assigns face track ids.
    landmarks.ts         Named hand-landmark indices. Never write raw 8 or 12.
  interaction/cursor.ts   Raised hand -> pointer with dwell-to-click.
  interaction/soft-mount.ts  Springs and the brush force. No DOM, unit-tested.
  interaction/hand-motion.ts Palm velocity, low-passed, per hand.
  interaction/menu-physics.ts Where the menu is, how lit, and what it has picked.
  ui/                    mirror.ts (video bg), overlay.ts (debug canvas), hud.ts
  ui/experience.ts       The wordless mode menu and the Picture-mode flow.
  ui/glass.ts            Rim refraction: canvas displacement map -> SVG filter.
  ui/icons.ts            Phosphor icons, inlined at build time. No network.
  debug/bridge.ts        window.__station: one typed snapshot. Dev builds only.
  debug/puppet.ts        Scripted hands. Replaces the detectors when armed.
  debug/hand-fixtures.ts 21 landmarks per gesture, shaped like MediaPipe's.
scripts/station.mjs       The debug CLI. Everything asks the station through it.
scripts/lib/cdp.mjs       The one CDP client. Do not write a second one.
  lib/                   smoothing, fps, assert helpers
docs/architecture.md      How the pieces fit and why.
docs/development-workflow.md Mandatory change and verification loop.
docs/hardware.md          Real measured camera capabilities. Read before
                          touching CONFIG.camera.
docs/adr/                 Decisions and their rationale. Add one when you make
                          a choice a future reader would question.
docs/frictions/           Obstacles, root causes, corrections and integrated improvements.
```

## The one contract

Everything above the perception layer consumes `PerceptionFrame` from
[src/perception/types.ts](src/perception/types.ts). To add a UI feature you need
that type and nothing else. To add a sense you produce it and nothing else.

**All coordinates are normalized 0..1 in mirrored screen space.** The x flip
happens once, inside the detectors. Never mirror a coordinate anywhere else:
that bug looks like "it works but left and right are swapped" and it is the most
common way to break this codebase. See [ADR 0004](docs/adr/0004-mirrored-screen-space.md).

## Adding a detector

Implement `Detector<T>`, then register it in `PerceptionEngine`. Nothing else
changes:

```ts
// src/perception/detectors/pose.ts
export class PoseDetector implements Detector<PoseObservation[]> {
  readonly name = "pose";
  private landmarker: PoseLandmarker | null = null;

  async init(): Promise<void> {
    const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);
    this.landmarker = await PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_URL.poseLandmarker, delegate: "GPU" },
      runningMode: "VIDEO",
    });
  }

  detect(video: HTMLVideoElement, timestampMs: number): PoseObservation[] {
    if (this.landmarker === null) return [];
    const result = this.landmarker.detectForVideo(video, timestampMs);
    // Flip x here, once. Mirrored screen space from this point on.
    return result.landmarks.map((lm) => lm.map((p) => ({ x: 1 - p.x, y: p.y })));
  }

  close(): void {
    this.landmarker?.close();
    this.landmarker = null;
  }
}
```

The `poseLandmarker` model is already downloaded and wired into `MODEL_URL`.

## Gotchas

These are the traps that cost real time. None are guessable from the code.

- **MediaPipe timestamps must strictly increase.** `recognizeForVideo` and
  `detectForVideo` throw on a timestamp equal to or lower than the last one.
  `PerceptionEngine.step()` returns `null` for a repeated frame instead of
  calling the detectors. Keep it that way.
- **The `*ForVideo` methods are synchronous.** They block and return a result;
  they are not promises. Do not `await` them and do not interleave async work
  between them, or timestamps go backwards.
- **Models and WASM are gitignored.** A fresh clone has no `public/models/`.
  If the app dies with a missing-model error, run `npm run models`.
- **One process at a time owns the camera.** `/dev/video0` is exclusive. A
  leaked Chrome from a killed screenshot run will make the next run fail with
  "Could not start video source". Check with `fuser -v /dev/video0`.
- **`CONFIG.camera` is load-bearing.** 1280x720@60 is the only 60 fps mode this
  camera has, and only over MJPG. Asking for 1080p silently halves the frame
  rate; landing on YUYV at 720p drops it to 10. See docs/hardware.md.
- **Never write `!` (non-null assertion).** The linter rejects it. Use `at()`,
  `assert()` or `requireElement()` from [src/lib/assert.ts](src/lib/assert.ts).
  `noUncheckedIndexedAccess` is on, so `arr[0]` is `T | undefined`.
- **A conic gradient already starts at twelve o'clock.** `from -90deg` starts it
  at nine, which fills a progress ring backwards, and a ring at 0% or 100% looks
  the same either way. Every arc in the interface is the one shared `.ring`
  class; `npm run check` rejects a second one. See friction 0004.
- **A puppet run is not camera evidence.** `npm run verify` invents its hands, so
  it can prove that a held Victory opens Picture mode and can never prove that
  the model recognises a Victory. The station wears a badge while it drives and
  the snapshot says `perceptionSource: "puppet"`. Never describe a puppet result
  as though a person did it.
- **An unfocused window is throttled.** Chrome caps a page nobody is looking at,
  and every frame rate measured then is a measurement of the cap. `station state`
  and `station perf` say so; a performance claim must name the camera mode,
  whether a person was in frame, and that the window was focused.
- **Faces and photos are personal data.** `captures/` and `data/faces/` are
  gitignored. Never commit an image, never send a frame off the machine, never
  add a network call to a detector. On-device is a requirement, not a default.

## Conventions

Only what differs from ordinary TypeScript defaults:

- Strict TS with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.
- Biome for format and lint, 100 columns, 2 spaces. `npm run fix` settles it.
- Relative imports carry the `.js` extension (`verbatimModuleSyntax`).
- Comments explain *why*, never *what*. If a comment restates the code, delete
  it. Every non-obvious constant gets a sentence saying where it came from.
- Values that were never measured against the real station say so, in the
  comment, with the words "verify at the station".

## Verifying a change

Unit tests cover pure logic only (`tests/`): the tracker and the smoothing
filter. Anything touching the camera or MediaPipe is verified by running it.

Run `npm run fix`, review the formatter diff, then run `npm run check` and
`git diff --check`. The full check also validates that every friction record is
structured and present in the friction register.

Any change that alters what is on screen must be confirmed with a screenshot:

```bash
npm run screenshot -- --out captures/my-change.png
```

When `./start.sh` is running, the command attaches to its live Chrome by default,
waits for the app to go live, and prints the HUD text alongside the image path.
This is the normal station verification path: reuse the existing camera owner
instead of launching another browser. If the debug server exists but the page is
not controllable, the command fails closed instead of launching a competing
browser. `--new-browser` and `--fake-camera` are explicit isolation modes, never
fallbacks. Use `--keys d` or `--keys f` to select a mode.

Two flags exist because guessing does not work. `--reload` puts the attached
station back to its starting state, which is the only way to photograph what a
visitor sees first. `--after "<js expression>"` waits for a state the app
reaches on its own schedule instead of padding `--keys` with sleeps, and it
reads progress as readily as flags:

```bash
npm run screenshot -- --reload --keys p,c \
  --after "+document.getElementById('countdown-ring').style.getPropertyValue('--progress') > 0.45" \
  --out captures/countdown.png
```

Two things about headless captures are expected and are not bugs. Processed fps
reads 3-6, because Chrome falls back to a software rasterizer. And the overlay
can look offset from the person: the video element keeps running at 60 fps while
the canvas only redraws at the processed rate, so the drawing is up to a third of
a second behind the picture. On the station both effects disappear.
