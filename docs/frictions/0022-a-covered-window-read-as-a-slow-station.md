# 0022. A covered window read as a slow station

- Date: 2026-09-05
- Status: integrated
- Area: tooling

## What happened

Every frame rate on the station fell to zero, in the middle of wiring up the
microphone. The obvious suspect was the new thing: the C922's audio interface
being opened on the same USB device as its video. Turning the ear off did not
help, which pointed at the camera being wedged.

It was neither. The video element was playing - `currentTime` advancing,
`readyState` 4, `paused` false - and `requestVideoFrameCallback` was not firing
at all, for the app or for a counter written by hand next to it. Chrome had
stopped compositing the station window because another window covered it, and
that stops the frame callback while leaving the media pipeline running.

`visibilityState` was "visible" and `document.hasFocus()` was true throughout,
so `station state` reported a healthy window, and every rate in the snapshot is
a rolling average that holds its last value - so the readout said "8 fps",
steady, for a loop that had not run in minutes.

## Impact

Twenty minutes spent on the wrong subsystem, and a stretch of voice testing
whose results meant nothing: "0 perception frames" was the window being covered,
not the feature failing.

## Root cause

Nothing in the readout distinguished "slow" from "stopped". Two separate
measures of health - is the window in a state where it paints, and has the loop
actually run - were both approximated by one that answers neither.

## Correction

`sinceLastFrameMs` is in the snapshot, and `npm run station -- state` says, in
words, that the loop has processed nothing for N seconds, that every rate below
it is stale, and that a covered window is the usual cause.

## Workflow integration

The check is in `printState`, beside the throttle warning friction 0011 added,
so it fires for anyone who runs `state` for any reason. `AGENTS.md` names the
symptom under its gotchas: a still picture with a plausible frame rate is a
window nobody is painting.

## Proof

With the window covered: `⚠ the loop has not processed a single frame - every
rate below is stale.` The same command with the window in front reports the real
rate, and the counter written by hand goes up.
