# 0011. Frame rate was measured through a throttle

- Date: 2026-09-04
- Status: integrated
- Area: tooling

## What happened

An A/B of the glass against the frame rate returned an identical 15.0 fps for
every condition, including one with the entire menu removed from the page. The
station window was visible but not focused, and Chrome throttles a page nobody
is looking at.

## Impact

Two wrong conclusions were nearly published: first that the glass costs nothing,
then that the loop was detector-bound at a figure that was really the throttle.
The earlier, honest measurement of the same thing had been taken with a person
at the station and the window in front, and the two disagreed for a reason that
had nothing to do with the code.

## Root cause

The tool reported a number without reporting the conditions that make the number
mean anything, and an unfocused window is invisible from the command line.

## Correction

`document.visibilityState` and `document.hasFocus()` are part of the debug
snapshot. `npm run station -- state` prints a warning beside the frame rate when
either is wrong, and `npm run station -- perf` prints it before its results and
says outright not to believe them.

## Workflow integration

`docs/development-workflow.md` requires performance claims to name the camera
mode, whether a person was in frame, and that the window was focused. A frame
rate measured otherwise is a measurement of the throttle.

## Proof

`npm run station -- perf --glass` now leads with
`⚠ window visible, unfocused - frame rate is throttled` when it applies, and the
flat 15.0 fps rows underneath are correctly readable as meaningless.
