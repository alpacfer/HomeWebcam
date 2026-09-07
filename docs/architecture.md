# Architecture

## The shape of it

```
  webcam ──> camera/camera.ts ──> <video> (mirrored in CSS, the UI background)
                                     │
                                     ├──> perception/engine.ts
                                     │      ├── detectors/hands.ts    (MediaPipe)
                                     │      ├── detectors/faces.ts    (MediaPipe)
                                     │      └── detectors/identity.ts (no-op)
                                     │             │
                                     │             ▼
                                     │      PerceptionFrame  ◄── the only contract
                                     │             │
                                     │             ├──> interaction/cursor.ts ──> CursorState
                                     │             ├──> interaction/menu-physics.ts
                                     │             │        ──> MenuMotion
                                     │             │
                                     └─────────────┴──> ui/overlay.ts, ui/hud.ts,
                                                        ui/experience.ts
```

```
  microphone ──> perception/voice.ts ──> voice-worker.ts (Whisper, own thread)
                                              │
                                              └──> PerceptionFrame.heard
```

`app.ts` owns the loop and is the only file that knows about all four layers.

## Why the layers are cut here

**Perception is replaceable, interaction is not.** MediaPipe will not be the
last model we run. Anything that reaches into a MediaPipe result type from
outside `perception/` would have to be rewritten when that changes, so nothing
does: `PerceptionFrame` is plain data with no library types in it.

**Interaction is where the product lives.** "A raised hand is a pointer",
"holding still for 800 ms is a click", "the higher hand wins" - those are design
decisions about how the station feels, and they are testable without a camera
because they consume plain data.

**The UI is a renderer.** `overlay.ts` and `hud.ts` read state and draw. They
hold no state of their own, so a rendering bug can never be a logic bug.

## The frame loop

Driven by `requestVideoFrameCallback`, not `requestAnimationFrame`. The camera
runs at 60 fps and the screen may refresh at 144: the callback fires once per
*camera* frame, so detectors never run twice on the same image.

Detectors are synchronous by design. MediaPipe's `*ForVideo` methods block and
require strictly increasing timestamps; making the pipeline async invites
out-of-order timestamps, which MediaPipe rejects outright. `engine.step()`
returns `null` for a duplicate timestamp rather than risk it.

## Coordinate space

One flip, in the detectors. Everything above them is in mirrored screen space:
normalized 0..1, x already flipped, so `x = 0.1` is near the left of the screen
and reaching left moves it left. See [ADR 0004](adr/0004-mirrored-screen-space.md).

The overlay canvas therefore needs no CSS transform. Its pixels line up with the
mirrored video underneath it because the numbers arrive pre-flipped.

## The debug layer

`src/debug/` is the only part of the codebase that exists for us rather than for a visitor.
`bridge.ts` publishes one typed snapshot on `window.__station` and `puppet.ts` produces
`PerceptionFrame`s from a script; both are gated behind `import.meta.env.DEV`, and `app.ts` takes its
frame from the puppet instead of the detectors while one is armed.

That seam is the perception contract doing its job: a puppet is just another source of the only type
anything above it consumes. It is also why the station marks itself while one is driving - the layers
above genuinely cannot tell, so a person looking at a screenshot must be able to. See
[ADR 0011](adr/0011-puppet-perception.md).

`tasks.ts` sits on top of the recorder: a question written from a keyboard, shown in the debug view,
and answered by a take against one of its steps. What comes back is filed with a digest of the
trace, so a run can be read without opening the video. The files are the interface between the two
halves - `scripts/tasks.mjs` writes them with no station running, the station appends only what it
produced. See [ADR 0015](adr/0015-camera-tasks.md).

`recorder.ts` is the exception to the gate. It records the camera stream the detectors are reading,
alongside a per-frame trace of what they made of it, and it is reachable from the debug view in any
build the station runs - the same position the picture flow is in, and for the same reason: both
write through a localhost endpoint that exists wherever the station's own server does. It is the one
piece of `src/debug/` a person operates by hand, which is why the debug view is also the one view
with a mouse pointer. See [ADR 0014](adr/0014-debug-recordings.md).

The view and the camera profile are separate settings (`StationView` and `CameraMode` in
`src/camera/camera.ts`). They used to be one, which meant the recorder could only ever see the
720p/60 profile and the 1080p/30 a visitor gets was never recorded. `D` and `F` still set both; `R`
and `station camera` change the profile alone. See [ADR 0021](adr/0021-the-pinch-is-limited-by-pixels.md).

## The ear

Speech is a sense, so it arrives the way every other sense does: as part of
`PerceptionFrame`. `voice.ts` opens the camera's microphone, gates it on
loudness, and hands each stretch of speech to a worker running Whisper tiny.en;
what comes back is an `Utterance` on the next frame, and
`interaction/voice-commands.ts` decides whether it is a command or a
description being dictated. It is a worker because transcribing a sentence takes
about a second and the frame loop has 16.7 ms. See
[ADR 0016](adr/0016-on-device-speech.md).

## Everything runs on-device

No frame, embedding, face or word ever leaves the machine. Models are served from our
own origin (`public/models/`, `public/mediapipe/`) rather than a CDN, so the
station keeps working when the network does not, and so no third party sees a
request pattern that reveals when someone is standing in the hallway.

`captures/`, `recordings/`, `tasks/` and `data/faces/` are gitignored. This is a hallway
camera pointed at guests; the privacy posture is part of the design, not a
setting. A debug recording is the strongest form of that data the station can
produce - seconds of video of whoever was standing there - so it is written
locally, named by hand, and never leaves the machine.

## Serving the station

`http://127.0.0.1:5173` is a secure context, so `getUserMedia` works with no
TLS. That covers the station itself, where the browser runs on the same machine
as the camera.

Opening the UI from another device on the LAN will fail: a plain-HTTP origin
that is not localhost cannot use `getUserMedia`. That needs real HTTPS with a
certificate the client trusts. Deferred until there is a reason to want it.

## Visitor interface

`ui/experience.ts` builds the menu from one list of modes and the icon set, and owns the
Picture-mode state machine. Victory opens Picture mode; Open Palm starts its countdown. The final
frame is encoded from the native video element and written locally through the server endpoint
described in ADR 0009.

Where the menu *is* on any given frame is not the renderer's business.
`interaction/menu-physics.ts` owns that: the UI measures the panels once at rest, with their
transforms suppressed, and hands those rectangles over; the physics returns travel, lean, the
position of the light on each panel, and which one the cursor has dwelled on long enough to pick.
Hit rectangles therefore move with the panels they belong to, which they must, because the panels
move. Springs and the brush force live in `interaction/soft-mount.ts` and are unit-tested without a
camera. See [ADR 0010](adr/0010-reactive-glass-menu.md).

Panel measurements are in *isotropic screen units*: y normalized over the viewport height and x over
it as well, so a radius is round rather than an ellipse on a 16:9 screen. `PerceptionFrame`
coordinates are converted on the way in and offsets are multiplied back out by the viewport height
on the way to CSS. This is the only place in the codebase that uses anything but the normalized
mirrored space of [ADR 0004](adr/0004-mirrored-screen-space.md), and it never leaves the menu.

## Paint mode

The second mode. A pinch is a sense built out of the perception contract the way the cursor is:
`interaction/pinch.ts` measures the thumb-to-index gap against the hand's own size and gates it, and
`interaction/paint-session.ts` decides what a pinch means - paint, pick the chip under it, or
nothing - given what the menus say the pointer is over. Strokes are data in `interaction/painting.ts`,
normalized, with the smooth path through them as a pure function.

Ink flows only while the fingers are together. The gate takes its time to call
a line over, because a landmark glitch must not cut one, but nothing it is
unsure about reaches the glass: the points a hand travels through while the
fingers are apart are held back by the session, laid down only if contact
returns inside the gate's patience, and dropped otherwise. The band between the
gate's two marks has a clock of its own, so fingertips parted a centimetre
cannot hold a line open. See [ADR 0023](adr/0023-ink-waits-for-contact.md).
Distance changes which reading a line may *start* on, and nothing else: the
tips for a hand at arm's length, the nearest of three pairs for one small
enough to be far, because at two metres the tips are the noise and the joints
are the signal. See [ADR 0024](adr/0024-a-far-hand-starts-on-the-joints.md).

A line is still corrected at its start, because a level-crossing gate is late
there: the start replays the ink from when the fingers met, which the gate only
knows in retrospect. See [ADR 0020](adr/0020-a-line-starts-where-the-fingers-met.md).

Every threshold in that gate is held by a corpus rather than by a memory of a
take. `tests/fixtures/pinch-takes/` is real hands reduced to the one scalar the
gate reads - committable because it carries no image, position or identity - and
`tests/pinch-takes.test.ts` replays `PinchGate` over it and asserts what each
take meant: three lines, one line, none. It is the only test here that can say a
number is *right* rather than that the code does what it says.
See [ADR 0019](adr/0019-a-pinch-measured-against-real-hands.md). `ui/paint-mode.ts` reads all of
that and draws: the tray (`ui/paint-tray.ts`, a second `MenuPhysics` with shorter springs) and the
canvas (`ui/paint-layer.ts`, which draws a stroke one curve at a time as it grows). While the mode is
on, the pointer for everything - menu included - is the pinch point. See
[ADR 0017](adr/0017-pinch-to-paint.md).

Two things the pinch taught about the frame loop. The face pass does not run in Paint mode
(`CONFIG.faces.offWhilePainting`): nothing there reads a face, and the pinch wants the milliseconds.
And MediaPipe's hand tracker wants every camera frame: fed the 60 fps debug profile, the loop
processes about 34 of them and the tracker's accuracy on a fast hand roughly halves, while the
1080p/30 visitor profile is processed in full. A paint take belongs on the visitor's profile. See
[ADR 0022](adr/0022-a-line-is-held-on-more-than-two-landmarks.md) and friction 0033.
