# 0014. Closing the mirror window stranded the station

- Date: 2026-09-04
- Status: integrated
- Area: tooling

## What happened

The webcam was moved to a different USB port while the mirror was running. The
picture went black. Nothing on screen said why, and `npm run station -- state`
reported `final · 25 fps · 1920x1080@30` with detector timings, as though the
loop were healthy.

The track had ended when the device was unplugged. `currentTime` was frozen at
0, mean luma was 0, and `is-live` was still on the body. Both frame-rate meters
hold rolling averages that never decay, so a loop that had stopped ticking kept
reporting the rate it managed before it died.

Closing the window and double-clicking `HomeWebcam.desktop` then failed with
`Something is already listening on port 5173. Close it and try again.` The
window is the part a person closes; the dev server outlives it, and `start.sh`
treated its own surviving server as a hostile squatter.

## Impact

A black mirror with no message, contradicted by a command line insisting on
25 fps. The documented way to restart the station refused to run, and the way
out - kill the dev server, then start both again - is not discoverable from the
error. Recovery needed an agent to relaunch Chrome by hand against the running
server.

## Root cause

Two separate optimism bugs. `App` never subscribed to the video track's `ended`
event, so camera loss was not an event in the app's world, only an absence of
callbacks. And `start.sh` conflated "a server is on the port" with "something is
wrong", when the overwhelmingly common case is its own server from a minute ago.

The stale frame rate is the same class of defect as friction 0013: a number
reported without the condition that makes it meaningful.

## Correction

`App.watchStream` listens for `ended` on the video track and calls
`onCameraLost`, which stops the loop, drops `is-live`, and shows an error
through the HUD - `showError` un-hides it, so a visitor in final mode sees it
too, not just a developer in debug. A mode change swaps the stream deliberately,
so the handler ignores a track that is no longer the current one.

`loop()` reports 0 fps once `running` is false rather than the last average it
happened to be holding.

`start.sh` curls the URL: a server that answers as this app is reused and left
running on exit, and only a stranger on the port is fatal. The Chrome control
port in use now reports that the mirror is already open.

## Workflow integration

`start.sh` is the documented way to run the station and is now safe to run when
only the window has gone, which is the usual case. `docs/hardware.md` records
that moving the camera between ports ends the track and resets the exposure
latch of friction 0013.

## Proof

Unplugging the camera now blacks the mirror *and* prints "The camera stopped."
with a hint, and `station state` reports 0 fps instead of a stale average.
Running `./start.sh` against an already-running dev server prints
`Reusing the dev server already running at http://127.0.0.1:5173`.
