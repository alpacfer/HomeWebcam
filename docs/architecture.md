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
                                     │             │
                                     └─────────────┴──> ui/overlay.ts, ui/hud.ts
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

## Everything runs on-device

No frame, embedding or face ever leaves the machine. Models are served from our
own origin (`public/models/`, `public/mediapipe/`) rather than a CDN, so the
station keeps working when the network does not, and so no third party sees a
request pattern that reveals when someone is standing in the hallway.

`captures/` and `data/faces/` are gitignored. This is a hallway camera pointed
at guests; the privacy posture is part of the design, not a setting.

## Serving the station

`http://127.0.0.1:5173` is a secure context, so `getUserMedia` works with no
TLS. That covers the station itself, where the browser runs on the same machine
as the camera.

Opening the UI from another device on the LAN will fail: a plain-HTTP origin
that is not localhost cannot use `getUserMedia`. That needs real HTTPS with a
certificate the client trusts. Deferred until there is a reason to want it.

## What is not built yet

The interface itself. There is a mirror, a debug overlay, a hand cursor with
dwell activation, and no content to navigate. `docs/roadmap.md` has the order.
