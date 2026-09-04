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
Press `Ctrl+C` to stop.

## What works today

A mirror that sees you: hand landmarks and gestures, face detection with a
stable id per person, and a hand cursor you aim with your index finger and
activate by holding still. There is nothing to navigate yet, which is the next
thing to build. See [docs/roadmap.md](docs/roadmap.md).

Face *recognition* (knowing who you are) is deliberately not implemented. The
seam is in place and the reasoning is in
[ADR 0003](docs/adr/0003-face-recognition-deferred.md).

## Working on it

```bash
npm run dev          # dev server on http://127.0.0.1:5173
npm run check        # lint + types + tests, all of it
npm run screenshot   # attach to start.sh's Chrome and capture the live app
```

`start.sh` keeps its station Chrome controllable on localhost port 9222. The
screenshot command detects and reuses that window by default, so it does not
compete with the already-open camera. Use `--fake-camera` when an isolated,
deterministic screenshot is preferable.

[AGENTS.md](AGENTS.md) is the working guide: layout, the one contract, and the
gotchas that are not guessable from the code. It is written for coding agents
and is just as useful to a human. [docs/architecture.md](docs/architecture.md)
explains why the seams are where they are.

Built with [MediaPipe Tasks Vision](https://ai.google.dev/edge/mediapipe),
TypeScript and Vite.
