# 0001. Run the station in a browser

## Context

The station is a PC, a screen and a webcam in a hallway. It needs camera access,
GPU-accelerated inference, and a UI that can fill a screen. Native (Python +
OpenCV, or Electron) and browser were both viable.

## Decision

A plain browser page: TypeScript, Vite, no UI framework.

## Consequences

Camera access needs a secure context, which means `127.0.0.1` or real HTTPS.
Serving the UI to another machine on the LAN is therefore not free.

The browser sandbox also means no filesystem writes without a download prompt,
so saving captures will need a decision of its own when we get there.

In exchange: the fastest possible iteration loop, WebGL inference for free, and
layout and animation tools that are far ahead of any native alternative for
something that is mostly a screen with graphics on it.

No framework because the app is one render loop over a canvas and a video
element. React's model buys nothing here and its reconciler runs on every frame
we care about.

## Alternatives

**Python + OpenCV** - the natural fit for MediaPipe and for direct V4L2 control,
but building a hallway-quality interface in Qt or Tk is far more work than in
CSS, and this project is mostly interface.

**Electron** - the browser plus filesystem access and kiosk control. Worth
revisiting for deployment. It would wrap this code unchanged, so choosing the
browser now does not close the door.
