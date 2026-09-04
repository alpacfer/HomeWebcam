# 0005. Screenshots could not return the station to its starting state

- Date: 2026-09-04
- Status: integrated
- Area: tooling

## What happened

Capturing the first thing a visitor sees was not possible with `npm run screenshot`. Attached to the
live station, the tool never navigates, and the station had been left in Picture mode by whoever last
stood in front of it, so every attempt to photograph the home menu photographed Picture mode instead.

## Impact

Two capture rounds documented the wrong state, and the mistake was only caught because the gesture
badge on the tile showed an open palm instead of a peace sign.

## Root cause

The tool was built around the rule that an attached station is authoritative and must not be
disturbed. Reloading its own page is not a disturbance of that kind, but there was no way to ask for
it, so the only remaining options were to disturb something that mattered or to accept the wrong
state.

## Correction

`--reload` was added. It issues `Page.reload` on the attached page and waits out the outgoing
document before the existing readiness loop starts asking whether the camera is live again.

## Workflow integration

The flag is documented in the script's usage block and in `docs/development-workflow.md` under the
capture rules, alongside the reason an attached station needs it. It reuses the station's own Chrome
and camera, so it does not weaken the no-competing-browser rule.

## Proof

`npm run screenshot -- --reload --out captures/glass-home.png` produces the home menu with the peace
badge on the Picture tile, repeatably, whatever state the station was left in.
