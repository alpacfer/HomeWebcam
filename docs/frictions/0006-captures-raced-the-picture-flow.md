# 0006. Captures raced the picture state machine

- Date: 2026-09-04
- Status: integrated
- Area: tooling

## What happened

Photographing the saved-picture confirmation meant pressing `c` and guessing how long to wait, by
padding `--keys` with inert keystrokes for their half-second sleeps. Two of those runs captured
nothing: one fired too early, and one fired while the previous run's flow was still in its `saved`
phase, where `requestCapture` correctly ignores the key.

## Impact

Three wasted capture runs, and two screenshots that appeared to show a broken confirmation. The state
machine was working correctly the whole time; only the capture harness was wrong.

## Root cause

`npm run screenshot` could wait for a condition before pressing keys but only for a fixed sleep
afterwards. Any state that takes a variable amount of time to arrive - a countdown, an encode, a
local write - could therefore only be captured by guessing.

## Correction

The runs were redone once the flow had returned to idle, and the state machine was verified directly
by polling the status element over a full cycle, which showed `status--visible` present from 3.5 s to
5.9 s after the keypress.

## Workflow integration

`--after` was added to `npm run screenshot`: a JavaScript expression polled after the keystrokes and
before the capture. It reads progress as readily as flags, so a mid-countdown frame is
`--after "+document.getElementById('countdown-ring').style.getPropertyValue('--progress') > 0.45"`
rather than a sleep. It fails loudly on timeout instead of capturing the wrong moment.
`docs/development-workflow.md` now requires it for any state the app reaches on its own schedule.

## Proof

`npm run screenshot -- --keys p,c --after "..."` captures the countdown mid-fill and the saved
confirmation deterministically, on repeated runs, with no padding keystrokes.
