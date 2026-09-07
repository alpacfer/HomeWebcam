# 0029. A done task pushed the open one off the screen

- Date: 2026-09-07
- Status: integrated
- Area: tooling

## What happened

A four-step task was filed for the station with `npm run task -- new`, and the
screenshot of the debug view taken to confirm it had arrived showed it starting
three quarters of the way down the panel with step 1 clipped by the bottom edge
and steps 2 to 4 off screen entirely.

## Impact

The task could not be performed. Every step is a button that records while it is
being pressed, so a step that is off the screen is a question that cannot be
answered - and the whole point of ADR 0015 is that some questions need a body in
the room.

## Root cause

The panel rendered a task the same way whatever its status, and the task above
was `done`: title, description, all three steps, and under each one the note the
person left plus the recording's filename. That is around 700 px of a 1080p
panel spent on work nobody has to do.

ADR 0017 sized this budget - "three tasks of three steps is what the debug
view's task panel holds on the 1080p station without reaching the floor" - and
measured it with three open tasks. Nothing said what an answered one costs, and
an answered one costs more than an open one, because it has grown run lines.

## Correction

A task whose status is `done` renders its head and one line saying how to read
it back: `answered · N step(s) · npm run task -- show <id>`. It stays on the
list, so it is visible that it was answered and can still be dismissed or
reopened, and it gives its space to the tasks that still need someone in front
of the camera. Its notes and digests are unchanged on disk.

## Workflow integration

`tests/dom/tasks.test.ts` gains a case with one done task above one open task
that asserts every step button on screen belongs to the open one. The panel's
size budget is now a property of the tasks that need doing rather than of every
task ever filed, so the ADR 0017 figure holds without an ageing correction.

## Proof

`npm run check` - 217 tests, 12 of them in `tests/dom/tasks.test.ts`.
`npm run verify` - 31/31, `a-task-reaches-the-mirror` and
`the-tray-clears-the-task-list` among them. A screenshot of the debug view with
one done task and one open four-step task shows all four steps on screen.
