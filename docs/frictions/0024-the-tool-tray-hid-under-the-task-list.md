# 0024. The tool tray hid under the task list

- Date: 2026-09-07
- Status: integrated
- Area: UI

## What happened

Paint mode's tool tray was hung down the right-hand edge of the mirror, where a
right hand reaches it without crossing the body. The debug view hangs the
recorder and the task list down the same edge. With four paint tasks written,
the list grew past the bottom of the screen and covered the tray completely, so
the person asked to "pick a colour from the tray" had no tray to pick from, in
the one camera mode where tasks are shown.

Four tasks of three steps also did not fit the panel at all: the third task was
cut off at the floor, as ADR 0015 said would happen and as nobody had yet
tried.

## Impact

The tasks written to tune paint mode could not have been done as written. A
first afternoon's tray screenshot showed the tray only because the list was
empty at the time.

## Root cause

Two instruments were placed on the same edge without a check that they both
fit there together with the thing they exist to test. The visitor layout was
right; the operator layout was never looked at with a task on it.

## Correction

In debug camera mode the tray steps inboard of the list (`body[data-camera-mode
="debug"] .tray-anchor`); the visitor layout is unchanged. The task set is three
tasks of three steps, which the panel holds on the 1080p station, and ADR 0017
says so beside the list of tasks.

**Superseded by [friction 0026](0026-a-tray-that-moved-without-being-measured.md).**
Moving the tray was the wrong half to move: its hit rectangles are cached from a
measurement, nothing re-measured them, and every tool in the debug view landed a
tray's width from where it was drawn. The task list moves now; the tray does not.

## Workflow integration

`npm run verify` has a check, `the-tray-clears-the-task-list`, that opens Paint
mode in the debug view with a task on the list and reads both rectangles off
the browser: the tray must end before the list starts, and the list must end
above the floor. A future instrument added to that edge fails it.

## Proof

The check passes with the tray's right edge left of the list's left edge and
the list's bottom inside the viewport; the numbers are in its detail line in
`npm run verify`'s output.
