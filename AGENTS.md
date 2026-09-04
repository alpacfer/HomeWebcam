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
npm run check        # biome + tsc + vitest. Must pass before you commit.
npm run fix          # auto-fix formatting and lint
npm run screenshot   # captures captures/app.png from a real Chrome (see below)
```

`npm run dev` must be running in another terminal before `npm run screenshot`.

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
  ui/                    mirror.ts (video bg), overlay.ts (debug canvas), hud.ts
  lib/                   smoothing, fps, assert helpers
docs/architecture.md      How the pieces fit and why.
docs/hardware.md          Real measured camera capabilities. Read before
                          touching CONFIG.camera.
docs/adr/                 Decisions and their rationale. Add one when you make
                          a choice a future reader would question.
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

Any change that alters what is on screen must be confirmed with a screenshot:

```bash
npm run screenshot -- --out captures/my-change.png
```

It launches a real headless Chrome against the real webcam, waits for the app to
go live, and prints the HUD text alongside the image path. Add `--fake-camera`
for a deterministic synthetic feed, or `--keys d` to toggle the debug overlay
off before capturing.

Two things about headless captures are expected and are not bugs. Processed fps
reads 3-6, because Chrome falls back to a software rasterizer. And the overlay
can look offset from the person: the video element keeps running at 60 fps while
the canvas only redraws at the processed rate, so the drawing is up to a third of
a second behind the picture. On the station both effects disappear.
