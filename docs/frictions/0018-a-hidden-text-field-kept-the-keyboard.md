# 0018. A hidden text field kept the keyboard

- Date: 2026-09-05
- Status: integrated
- Area: UI

## What happened

The recorder's naming dialog is the first text input this station has ever had,
so `app.ts` learned to ignore its single-key shortcuts while a text field has
focus - otherwise naming a recording "debug flicker" switches the camera mode
twice and fires the shutter. The dialog then closed with focus still inside the
name field. `document.activeElement` stayed on a field that was no longer on
screen, so the guard kept swallowing keys: after saving a recording, `D`, `F`,
`P` and `C` did nothing at all.

It surfaced as `npm run station -- record` timing out for twenty seconds waiting
for the station to go back to the mode it had been in, while the same keystroke
sent by hand a minute later worked.

## Impact

The station silently stopped answering its own keyboard after every saved
recording. Nothing failed, nothing was logged, and the camera mode a visitor
should have been left in was not restored. Two verification runs were spent
suspecting the camera, which had nothing to do with it.

## Root cause

A guard was added for the new state (a field has focus) without the matching
transition (the field stops being reachable). Hiding an element does not take
its focus away synchronously, so "is the target a text field" answered a
question about a field that no longer existed.

## Correction

`closeDialog()` blurs both fields before hiding the dialog, so focus is back on
the document by the time the next key arrives.

## Workflow integration

`tests/dom/recorder.test.ts` asserts that focus is inside the name field while
the dialog is up and out of it once the dialog closes, and drives the save and
discard buttons through real DOM events rather than only through the bridge.
`npm run verify` gained two checks that switch camera mode around a recording,
so a station that stops answering `F` fails the run.

## Proof

`npx vitest run tests/dom/recorder.test.ts` - 14 passing. On the station,
`npm run station -- record 3 --name "blur fix check"` completed and left the
station back in final mode; the same command timed out on the restore before
the fix.
