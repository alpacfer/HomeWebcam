# HomeWebcam

An interactive mirror for the hallway. A webcam, a screen and a PC: walk up and
drive the interface with your hands, face and body. No keyboard, no mouse, no
touch. The camera feed is the background of everything.

Everything runs on-device, in the browser. No frame ever leaves the machine.

## Start it

Double-click **HomeWebcam.desktop**, or from a terminal:

```bash
./start.sh
```

First run installs dependencies and downloads ~18 MB of detection models; after
that it goes straight to the final visitor view. Press `D` for the raw 720p/60
processing view and debug overlay, or `F` for the clean 1080p/30 visitor view.
`R` swaps the camera profile on its own, so the debug view can look at, and
record, the 1080p a visitor gets. `P` and `B` open Picture and Paint mode from
the keyboard; `X` wipes a painting.
Press `Ctrl+C` to stop.

## What works today

A mirror that sees you: hand landmarks and gestures, face detection with a
stable id per person, and a hand cursor you aim with your index finger and
activate by holding still. The top menu opens Picture mode by dwell or a held
victory gesture. In Picture mode, hold an open palm to start a three-second
countdown; the full camera frame is saved locally in `captures/`.
The file is a lossless PNG at the camera's native negotiated resolution.

Paint mode turns the mirror into a whiteboard: bring your thumb and index finger
together and a line follows your hand. It draws only while they are in contact:
the ink stops the frame they part, and the line itself ends a moment later,
because the fingertips are the noisiest thing the hand model tracks and a
glitch must not cut a line in half. See
[ADR 0023](docs/adr/0023-ink-waits-for-contact.md). A tray of glass chips down the side holds
six colours, three widths, an eraser and a bin; point at one and hold to pick
it, or pinch on it to pick it at once. The bin wants a longer hold, because
there is no undo. Everything is one hand. See
[ADR 0017](docs/adr/0017-pinch-to-paint.md).

The interface has no words in it. Modes are glass tiles carrying one icon each,
and the gesture that opens a mode is drawn on the tile as a badge that fills
while you hold it. The menu is hung on springs rather than fixed to the screen,
so a hand sweeping past brushes it and it swings back, and the light on the
glass follows your fingertip. See
[ADR 0010](docs/adr/0010-reactive-glass-menu.md).

Face *recognition* (knowing who you are) is deliberately not implemented. The
seam is in place and the reasoning is in
[ADR 0003](docs/adr/0003-face-recognition-deferred.md).

## Working on it

```bash
npm run preflight    # inspect the active server/browser before runtime work
npm run dev          # dev server on http://127.0.0.1:5173
npm run check        # lint + types + tests, all of it
npm run station      # ask the running station anything: state, shoot, probe, perf
npm run verify       # drive every interaction with scripted hands, ~2 min
npm run screenshot   # attach to start.sh's Chrome and capture the live app
```

`npm run station -- state` prints one snapshot of what the mirror is doing:
camera and detector timings, hands and gestures, cursor, mode, and every menu
panel's travel, lean and glow. `npm run verify` then drives the whole interface
through scripted hands and checks what came out - dwell, gesture holds, the
wave physics, the shutter - without anyone standing in the hallway. Those hands
are invented, so a run says nothing about whether the models recognise a real
one; the station wears a badge while it happens. See
[ADR 0011](docs/adr/0011-puppet-perception.md).

The mandatory change, verification, and continuous-improvement process is documented in
[docs/development-workflow.md](docs/development-workflow.md). User corrections and workflow
frictions are preserved in an append-only [friction log](docs/frictions/README.md), and every fix is
integrated into the workflow rather than left as a retrospective note.

`start.sh` keeps its station Chrome controllable on localhost port 9222. The
screenshot command detects and reuses that window by default, so it does not
compete with the already-open camera. `--reload` puts that page back to its
starting state, and `--after "<js>"` waits for an application state instead of
sleeping, so a countdown or a save confirmation can be captured on purpose. Use
`--fake-camera` when an isolated, deterministic screenshot is preferable.

[AGENTS.md](AGENTS.md) is the working guide: layout, the one contract, and the
gotchas that are not guessable from the code. It is written for coding agents
and is just as useful to a human. [docs/architecture.md](docs/architecture.md)
explains why the seams are where they are.

Built with [MediaPipe Tasks Vision](https://ai.google.dev/edge/mediapipe),
TypeScript and Vite.
