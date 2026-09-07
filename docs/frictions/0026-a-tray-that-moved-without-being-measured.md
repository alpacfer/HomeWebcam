# 0026. A tray that moved without being measured

- Date: 2026-09-07
- Status: integrated
- Area: UI

## What happened

Friction 0024 moved the paint tray 200 px inboard in the debug view, to clear
the task list. The user reported straight away that in debug mode "the menus
move and the interaction with the painting tools is wrong". Measured on the
live station, holding a pointer at the drawn centre of the same chip:

| Camera mode | Chip drawn at x | Chip hovered |
| --- | --- | --- |
| final | 0.965 | color-4 |
| debug | 0.762 | nothing |

Every tool in the debug view was dead, and a hand a tray's width to the right
of the chips was hitting them.

## Impact

Paint mode's tools could not be used in the only camera mode that shows the
task list, which is the mode the person answering a paint task is standing in.
The three tasks written to tune the pinch were unanswerable as written, for the
second time in one afternoon.

## Root cause

The tray's hit rectangles are measured once, with transforms suppressed, and
cached in `MenuPhysics`. Re-measuring is triggered by a `ResizeObserver` and the
window's `resize` event, and both are blind to a change of position: moving the
tray with `right` moves every chip and changes no width, so nothing fired and
the cache still described where the chips had been.

Underneath that: a hand target was moved at all. A mouse target can be moved
freely because the browser hit-tests it; a hand target carries its own cached
geometry, and the two are not interchangeable.

## Correction

The visitor's tray no longer moves. The stylesheet moves the *task list*
instead - an instrument, read with the eyes and pressed with a mouse - so the
tray keeps one position in every mode.

Independently, the cache is no longer allowed to go stale silently:
`ExperienceUi.relayout()` re-measures the tiles and the tray, and `app.ts`
calls it from `presentMode()`, where the camera mode lands on the body and any
rule keyed on it changes the layout.

## Workflow integration

`npm run verify` gained `a-chip-hovers-where-it-is-drawn`: it holds a pointer at
a chip's drawn centre in **both** camera modes and requires the hover to land on
that chip. A cached rectangle that disagrees with the drawn one fails it, in
whichever mode the disagreement is.

`the-tray-clears-the-task-list` no longer asserts which of the two is on the
left, only that they share none of it. Asserting the order pinned 0024's fix in
place and would have failed the better one.

## Proof

`npm run verify`: `a-chip-hovers-where-it-is-drawn` passes with the same chip
hovered in final and debug, and `the-tray-clears-the-task-list` passes with the
list now inboard of the tray. The measurement in the table above, repeated
after the fix, hovers `color-4` in both modes.
