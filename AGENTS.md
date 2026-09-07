# HomeWebcam

An interactive mirror. A webcam, a screen and a PC in the hallway; visitors walk
up and drive the interface with their hands, face and body. No keyboard, no
mouse, no touch. The camera feed is the background of the whole UI.

Browser app: TypeScript + Vite, no UI framework. Perception is MediaPipe Tasks
Vision (WASM + WebGL) for hands and faces, and Whisper tiny.en through
transformers.js for speech. All of it runs on-device.

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
npm run station -- focus  # required before believing any frame rate
npm run task         # ask the person at the station to do something on camera
npm run verify       # drive every interaction through the live station, ~1 min
npm run screenshot   # attaches to start.sh's live Chrome when available
```

### Asking a person

Some questions need a body in the room: a hand at an angle, a face against a
bright window, a gesture the model only fails on when a real arm makes it.
`npm run task` writes one down; it appears in the debug view, and each step is a
button that records while it is being performed.

```bash
npm run task -- new "Victory sometimes does not open Picture" \
  "Stand two metres back and hold a Victory sign until the badge fills" \
  "Do it again with your hand half a metre from the camera" \
  --about "Two people reported holding Victory and nothing happening."
npm run task -- list
npm run task -- show latest            # digest, notes, errors, file paths
npm run task -- show latest --frames 20  # a sampled walk through the trace
npm run task -- done <id> | reopen <id> | rm <id>
```

The answer is a recording plus a digest - how much of the take had a hand in it,
which gestures came back, which tile the cursor was over, what the frame rate
was. Read the digest first; open the video when it says something interesting.
See [ADR 0015](docs/adr/0015-camera-tasks.md).

### Asking the station

`npm run station -- <command>` attaches to the Chrome `./start.sh` already
opened. It never launches a browser: `/dev/video0` allows one owner.

| Command | For |
| --- | --- |
| `state` | One snapshot: view and camera profile, camera (claimed *and* delivered rate), detectors, hands, cursor, mode, phase, every panel's travel, lean, glow and progress, and any words on screen. **Run this before writing any script.** |
| `camera debug\|final` | Switch the camera profile (720p/60 or the visitor's 1080p/30) without touching what is on the glass. `camera final` from the debug view is how a take is recorded on the camera visitors get; every take before ADR 0021 was 720p. |
| `view debug\|final` | Put the instruments on the glass or take them off, leaving the camera as it is. |
| `focus` | Bring the station window to the front, and say whether it took. **Run this before reading any frame rate**: an unfocused window is throttled. |
| `shoot F --crop menu --zoom 3` | Capture, cropped to a named region and scaled, in one call. Regions: `menu`, `tile`, `countdown`, `status`, `hud`, or `x,y,w,h`. |
| `watch ".menu.panels[0].glow"` | Poll a snapshot path or expression; reports min/median/max, and can `--shoot-when` a condition fires. |
| `probe SEL --ring --style a,b` | Geometry, computed styles, and which way a progress arc is *actually* filled, read off the pixels. |
| `perf --glass` | Frame-rate A/B with CSS overrides. Warns when the window is unfocused, because then it is measuring the throttle. |
| `puppet wave\|point\|victory\|palm\|both\|stroke\|sweep\|fist\|overshoot\|part\|dive\|stop` | Drive scripted hands into the running app. `stroke` pinches and draws a line; `sweep` and `fist` cross the same path and must leave nothing; `overshoot` keeps moving while the fingers open wide, so nothing past the parting may be inked; `part` opens them a little and never wide, so the line has to end from the loose limit alone; `dive` closes the fingers *while* travelling, so the head of the line has to be drawn back to where they met. |
| `record 6 --task latest [--note "..."]` | Answer a task step with scripted hands. Without `--note` the dialog is left for a person. |
| `say "stop"` | Put words in the station's ear without a microphone. They arrive marked `injected`. |
| `record 8 [--name "..." --note "..."]` | Record what the models are being given, on whichever camera profile is up. Without `--name` it leaves the dialog at the station for a person to fill in; `record save --name "..."` and `record discard` finish one that is waiting. |
| `verify` | All thirty-four interaction checks, with screenshots. |

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
2. `npm run verify` - every interaction, driven by scripted hands, ~1 min.
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
    types.ts             THE CONTRACT. Read this first. HandObservation.world
                         is the hand in metres; see ADR 0021 before reading it.
    engine.ts            Runs the detectors, assembles a PerceptionFrame.
    detectors/hands.ts    Hand landmarks + gestures (one MediaPipe pass).
    detectors/faces.ts    Face boxes + stable track ids.
    mirror.ts            The camera-to-screen x flip. The ONLY place it happens.
    detectors/identity.ts "Who is this?" - deliberately a no-op. See ADR 0003.
    voice.ts             The ear: microphone, loudness gate, utterances.
    voice-worker.ts      Whisper tiny.en, on its own thread. See ADR 0016.
    tracker.ts           Centroid tracker that assigns face track ids.
    landmarks.ts         Named hand-landmark indices. Never write raw 8 or 12.
  interaction/cursor.ts   Raised hand -> pointer with dwell-to-click.
  interaction/pinch.ts    Thumb-to-index gap, gated with hysteresis. The paint brush.
  interaction/painting.ts Strokes as data, and the smooth path through them.
  interaction/paint-session.ts What a pinch means: paint, pick a chip, or nothing.
  interaction/voice-commands.ts What a sentence means. One command: "stop".
  interaction/soft-mount.ts  Springs and the brush force. No DOM, unit-tested.
  interaction/hand-motion.ts Palm velocity, low-passed, per hand.
  interaction/menu-physics.ts Where the menu is, how lit, and what it has picked.
  ui/                    mirror.ts (video bg), overlay.ts (debug canvas), hud.ts
  ui/experience.ts       The wordless mode menu and the Picture-mode flow.
  ui/paint-mode.ts       Paint mode on the glass: tray + canvas, driven by the session.
  ui/paint-tray.ts       The tool chips. The menu again, a third of the size.
  ui/paint-layer.ts      The canvas the ink lands on. Draws strokes as they grow.
  ui/glass.ts            Rim refraction: canvas displacement map -> SVG filter.
  ui/icons.ts            Phosphor icons, inlined at build time. No network.
  debug/bridge.ts        window.__station: one typed snapshot. Dev builds only.
  debug/puppet.ts        Scripted hands. Replaces the detectors when armed.
  debug/hand-fixtures.ts 21 landmarks per gesture, shaped like MediaPipe's.
  debug/recorder.ts      Records the frames the models get, plus a perception
                         trace, for a bug report. Debug camera mode only.
  debug/tasks.ts         Things to go and do in front of the camera. Each step
                         is a button that records itself.
  debug/trace.ts         What a take remembers per frame, and the digest a run
                         is read by. Pure; unit-tested.
scripts/tasks.mjs         Writes and reads tasks. Needs no running station.
scripts/pinch-corpus.mjs  Distils a recording into a committed pinch take: the
                          one scalar the gate reads, no image and no identity.
scripts/pinch-rulers.mjs  Replays the gate on the ratio and on the metric gap
                          over one take. The tool behind ADR 0021.
scripts/recover-world.py  Re-runs the hand model over an old recording to get
                          the world landmarks it did not keep. Needs a Python
                          venv; the header says which.
scripts/station.mjs       The debug CLI. Everything asks the station through it.
scripts/lib/cdp.mjs       The one CDP client. Do not write a second one.
  lib/                   smoothing, fps, assert helpers
tests/fixtures/pinch-takes/ Real hands, as numbers. What CONFIG.paint.pinch is
                          answerable to; see ADR 0019 before moving one.
docs/architecture.md      How the pieces fit and why.
docs/development-workflow.md Mandatory change and verification loop.
docs/hardware.md          Real measured camera capabilities. Read before
                          touching CONFIG.camera.
docs/adr/                 Decisions and their rationale. Add one when you make
                          a choice a future reader would question.
docs/frictions/           Obstacles, root causes, corrections and integrated improvements.
recordings/               Debug recordings. Personal data, gitignored, local.
tasks/                    Open questions and the runs that answered them.
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
- **The ear is a second model on the same machine.** Whisper runs in a worker,
  takes 0.3-1.5 s per utterance, and answers a quiet room with "you" or "thank
  you" - it transcribes, it does not detect. `CONFIG.voice.activationLevel` is
  the gate and `CONFIG.voice.hallucinations` is the denylist for whole
  utterances. See ADR 0016.
- **A still picture with a plausible frame rate is a window nobody is painting.**
  Chrome stops compositing a covered window, `requestVideoFrameCallback` stops
  with it, and every rate holds its last value while `visibilityState` still
  says "visible". `station state` now says so; see friction 0022.
- **A local file that is missing does not 404 by default.** Vite answers with
  index.html and a 200, so a missing model reaches the runtime as a web page and
  comes back as "protobuf parsing failed". The dev server now 404s under
  `/models/`, `/onnx/` and `/mediapipe/` and lists misses at `/api/missing`.
  See friction 0021.
- **A puppet run is not camera evidence.** `npm run verify` invents its hands, so
  it can prove that a held Victory opens Picture mode and can never prove that
  the model recognises a Victory. The station wears a badge while it drives and
  the snapshot says `perceptionSource: "puppet"`. Never describe a puppet result
  as though a person did it.
- **An unfocused window is throttled.** Chrome caps a page nobody is looking at,
  and every frame rate measured then is a measurement of the cap. `station state`
  and `station perf` say so; a performance claim must name the camera mode,
  whether a person was in frame, and that the window was focused.
- **Voice is personal data too.** No recording contains audio, no transcript is
  written to disk, and nothing leaves the machine. See ADR 0016.
- **Faces and photos are personal data.** `captures/`, `recordings/`, `tasks/`
  and `data/faces/` are gitignored. Never commit an image, never send a frame off
  the machine, never add a network call to a detector. On-device is a
  requirement, not a default.
- **A debug recording is the unmirrored camera image.** It is what the detectors
  are handed, one layer before the x flip, so a landmark in the trace does not
  line up with the video until you mirror it back. The manifest says
  `"mirrored": false` for exactly this reason. See ADR 0014.
- **`hidden` loses the cascade to any display rule.** The stylesheet forces
  `[hidden] { display: none !important }` because a class that sets a display
  outranks the attribute and leaves the element on screen. Twice. See friction
  0019.
- **A task run says where its hands came from.** `perceptionSource` travels with
  every run, and anything that is not plainly `camera` reads as `unknown` rather
  than as a person. The server keeps that field on purpose; see friction 0020.
- **A text field steals the station's shortcuts.** `D`, `F`, `P`, `B`, `X` and
  `C` are letters, so `app.ts` ignores them while focus is in an input. Any new
  field must give focus back when it goes away, or the station stops answering
  its own keyboard. See friction 0018.
- **An `--after` expression does not survive a second shell.** Chaining two
  `npm run station` calls in one shell string mangles an expression carrying
  `>` and an arrow function: the wait gets legal JavaScript that is not what was
  typed, and times out on a condition `state` can read a moment later. Run one
  station command per shell invocation. See friction 0025.
- **A hand target cannot be moved by CSS alone.** Hit rectangles for the menu
  and the paint tray are measured once and cached, and the observers that
  refresh them see size, never position - so a rule that moves one with `right`
  or `top` leaves every target where the control used to be. `presentMode()`
  calls `ExperienceUi.relayout()` because the camera mode is on the body and
  any rule keyed on it can move things. Move an instrument freely; the browser
  hit-tests those. See friction 0026.
- **A pinch is measured, not recognised.** The recognizer has no pinch label;
  `src/interaction/pinch.ts` divides the thumb-to-index gap by the hand's size
  and gates it with two thresholds. Every number in `CONFIG.paint.pinch` came
  off takes at the station and none of it is guessable: contact reads 0.01-0.10
  and never a stable zero, a relaxed open hand 0.43-0.49, and during a pinch the
  fingers never left the ratio still ran above 0.24 in runs of up to nine
  frames. So the two confirmations are different sizes - 180 ms to close, 150 ms
  to open - and the ink drawn during that long release is taken back afterwards
  rather than prevented. Lowering `openAbove` to make releasing feel quicker is
  the trap; it cuts lines.
- **Those takes are committed, so the gate can be replayed over them.**
  `tests/fixtures/pinch-takes/` holds one scalar per frame from a real hand,
  with what the person was asked to do and how many lines that should be, and
  `npm run check` runs the real gate against them. Do not move a threshold in
  `CONFIG.paint.pinch` on a reading of a digest: a digest cannot show how long a
  line waited, which is how `closeBelow` ended up *below* where a real contact
  reads and lines stopped starting. Read ADR 0019, then run the corpus.
  `scripts/pinch-corpus.mjs` turns a new recording into a take, and it keeps the
  trace's own precision because rounding a confidence of 0.6997 to 0.70 crosses
  a threshold and invents a gesture. See friction 0030.
- **A line is drawn back to where the fingers met.** The gate cannot confirm a
  pinch until it has held, and a hand paints at 1.32 screen heights a second, so
  the head of every line - 220 px at the median, 440 at the ninetieth
  percentile - used to be missing. `PinchState.contactSince` says when contact
  began and `PaintSession` replays the points from there. The mirror of the
  release trim: the end gives ink back, the beginning takes ink on. A pinch that
  plunges past `deepBelow` also skips most of the wait, which is what stops a
  one-frame spike over `closeBelow` from resetting the clock forever - that cost
  a whole line in the vertical-lines take. See ADR 0020.
- **A line starts on the fingertips and is held on the nearest of three pairs.**
  `pinchRatio` (thumb tip to index tip) is the only reading that may start a
  line, because a thumb resting on the side of a pointing index puts the thumb
  tip 0.07 from the index's middle joint while the tips are 0.21-0.24 apart,
  and any reading past the tips starts a line there. `pinchHoldRatio` (the
  closest of tip-tip, tip-DIP and IP-tip) is what keeps one going, because the
  two tips are the noisiest landmarks the model has and they jumped a held
  pinch open twice in nine takes; the joints behind them rarely jump at the
  same time. `PinchGate.update` takes both. The corpus takes carry `hold` for
  this; a take without it is held on the ratio. See ADR 0022.
- **Paint mode runs no face pass.** Nothing in it reads a face and the pinch
  wants the milliseconds; `CONFIG.faces.offWhilePainting` turns the pass off
  while the glass is a canvas and the HUD reads `faces 0.0ms` there. Face track
  ids start over when the mode is left. See ADR 0022.
- **A `Closed_Fist` may keep a line from starting; it never ends one.** With the
  index curled the thumb rests on it and the gap alone reads as pinched, so the
  label earns its place on the way in. On the way out it only cuts lines: the
  recognizer called one deliberately unbroken pinch a fist at full confidence
  for 238 ms, and every fist label in the corpus is on a hand that was painting
  on purpose. See ADR 0019.
- **The pinch ratio glitches hardest while the fingers are shut.** The thumb and
  index tips are the two noisiest landmarks the model produces. One held pinch
  jumped from 0.09 to 0.80 for two frames at tracking confidence 1.00, and
  confidence is no warning: the worse of two line breaks happened at 1.00. Any
  new reading off those two landmarks needs a confirmation time, not a
  threshold. See ADR 0018.
- **The view and the camera profile are two settings.** `D` and `F` set both,
  `R` swaps the profile alone, and `station camera final` does the same from
  the CLI. Until ADR 0021 they were one word, so the recorder - an instrument,
  shown only on the debug view - could only ever record 720p, and every pinch
  number in `CONFIG` was tuned on a camera visitors never see. A take's manifest
  says `camera.mode` (the profile) and `camera.view`; read the first before
  trusting a pixel measurement. The stylesheet is keyed on `data-view`; nothing
  in it may read `data-camera-mode`.
- **The pinch's limit is pixels, and every smarter gate was tried.** At two
  metres a real contact is a 3 px gap against 2-3 px of landmark jitter; median
  filters, evidence integrators and every threshold pair were replayed over
  eight takes and none beat the shipped gate without inventing lines. The
  metric gap off the world landmarks is quieter but biased - 27-30 mm at the
  median for touching fingertips - and a learned head over all 21 landmarks
  scored worse still. Before proposing an algorithm, read ADR 0021 and run
  `scripts/pinch-rulers.mjs` over the take in question.
- **A digest's `strokes` is the count on the glass, not what the take drew.**
  The painting survives between takes. `strokesDrawn` is the take's own count
  and the digest prints both when they differ. See friction 0031.
- **In Paint mode the pointer is the pinch point, not the index tip.** The menu
  is driven by it too while the mode is on. A puppet scenario that means "put
  the ink here" says `anchor: "pinch"`; one that says nothing anchors the index
  tip, and its pinch point lands a twentieth of the screen lower.

- **Ink flows only while the fingers touch; the line ends later.** `closed` and
  `touching` on `PinchState` are two different questions. The gate keeps a line
  open through a landmark glitch on purpose, but `PaintSession` lays no point
  while `touching` is false: those points are held back and laid only if
  contact returns, so nothing past a parting reaches the glass and nothing is
  ever trimmed. And the band between `closeBelow` and `openAbove` has a clock,
  `looseMs`: fingertips parted a centimetre read 0.22-0.29 for seconds, above
  contact and below the open mark, and a gate with no clock there held a line
  for 11 s of a 27 s take. Lowering `openAbove` to fix that is still the trap
  from ADR 0018. See ADR 0023, and the `loose` fraction in a digest.
- **Distance changes which reading starts a line, never where the marks are.**
  Contact reads a ratio of 0.10-0.11 at every hand size, because the ratio is
  already divided by the hand's size; do not add a distance-scaled threshold.
  What grows with distance is tip-landmark noise, so a hand smaller than
  `CONFIG.paint.pinch.farBelow` (a fraction of the frame height, 0.09) starts
  on the nearest-pair reading instead: 7 of 8 lines at two metres, from 4. Near
  hands must not, or a thumb resting on a pointing index paints. The corpus
  carries `size` per frame for this; a fixture without it replays as a near
  hand. The false side at distance is unmeasured until an idle far take exists.
  See ADR 0024 and friction 0035.

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
