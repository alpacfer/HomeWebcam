# 0004. Progress rings filled backwards

- Date: 2026-09-04
- Status: integrated
- Area: UI

## What happened

The dwell ring, the gesture-hold ring and the shutter countdown were all written as
`conic-gradient(from -90deg, ...)`, on the assumption that a conic gradient starts at three o'clock
and needs rotating a quarter turn to start at twelve. It already starts at twelve. `from -90deg`
moved the start to nine o'clock, so every arc in the new interface filled anticlockwise.

## Impact

Three separate indicators ran backwards on the live station. None of it was obvious in review: a ring
at 0% or 100% looks identical whichever way it fills, and the only capture that showed a partial arc
was read as a lighting artefact of the camera behind it.

## Root cause

The canvas and SVG convention, where angles start at three o'clock, was carried into CSS, where they
do not. The same gradient had then been copy-pasted into three rules, so one wrong assumption became
three wrong indicators with no single place to correct.

## Correction

`from -90deg` was removed. The direction was then confirmed by measurement rather than by eye: the
countdown was pinned at `--progress: 0.25` through the debug endpoint and the ring's pixels were
sampled every 30 degrees, which put the filled quadrant between twelve and three o'clock.

## Workflow integration

The three copies were replaced by one `.ring` class, parameterised by inset, radius, width and track
colour, so the interface has exactly one progress arc and exactly one place to get its direction
wrong. `scripts/check-styles.mjs` fails `npm run check` if a second `conic-gradient` appears in the
stylesheet, and names the shared class in the error. The comment on `.ring` states the trap outright.

## Proof

`npm run check` reports `[styles] src/ui/styles.css: 1 progress arc definition`. The countdown
capture in `captures/glass-countdown.png` shows the arc running clockwise from twelve o'clock at
`--progress: 0.476`.
