# 0019. The snapshot said hidden while it was on screen

- Date: 2026-09-05
- Status: integrated
- Area: UI

## What happened

The debug recorder's control is hidden outside debug camera mode by adding a
`recorder--hidden` class that sets `display: none`. The rule that lays the
control out is `#recorder`, an id selector, so it outranked the class and the
control stayed on screen in final mode - on the visitor's mirror, over their
reflection.

Nothing reported it. `station state` said `visible: false`, the new
`the-recorder-is-debug-only` check in `npm run verify` passed, and the DOM test
passed, because all three read the flag the app sets rather than what the
browser computed. It was caught by looking at a screenshot.

## Impact

A developer control sat on the finished interface in the one mode that is
supposed to have nothing but the mirror and the menu in it, while every
automated check said it was gone.

## Root cause

Two failures that only matter together: a class fighting an id in the cascade,
and a verification chain that asked the application what it believed instead of
asking the browser what it drew. The project has recorded this second half twice
before, about progress arcs (0004) and about reading a ring through its own
middle (0016), and the rule was still only written down for arcs.

## Correction

The hiding rule is qualified as `#recorder.recorder--hidden`, so it wins.

## Workflow integration

`the-recorder-is-debug-only` now switches to final mode and reads
`getComputedStyle(#recorder).display` in both modes, so the flag and the pixels
have to agree. `docs/development-workflow.md` states the rule in general terms
rather than only for progress arcs: a check that reads a value the app also
wrote proves the app is consistent with itself, not that anything is on screen.

## Proof

`npm run verify` - 15/15, with `final display none · debug display flex`. The
same check reported `final hidden · debug shown` while the control was visible,
which is the reading that made this record necessary.

## Addendum, 2026-09-05

It happened again the same day, by the other mechanism. The recorder's dialog
hides its name field with the `hidden` attribute when a take already has a name
from a task. `hidden` is a UA rule at the weakest specificity, so
`.recorder__row { display: grid }` outranked it and the field stayed on the
dialog. Caught, again, by looking at a screenshot.

`src/ui/styles.css` now opens with `[hidden] { display: none !important }`,
which ends the family: an element with the attribute is hidden whatever else the
sheet says. `tests/dom/recorder.test.ts` checks the attribute; the rule that
makes the attribute mean something is checked by the eye and by the capture in
the handoff.
