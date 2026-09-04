# 0009. Every question needed a new throwaway script

- Date: 2026-09-04
- Status: integrated
- Area: tooling

## What happened

Answering any question about the running station meant writing a script. Nine of
them in one afternoon: sample the tile transforms, catch a wave, A/B the frame
rate, poll the status element, pin the countdown ring, compare two conic
gradients, press keys and shoot, watch for three states, dump a computed style.
Each one reopened a CDP WebSocket from scratch and scraped the page with its own
regex over inline styles.

## Impact

Roughly a third of the session went into plumbing rather than into the work. The
scripts were untyped, unreviewed, invisible to `npm run check`, and thrown away,
so the next session would have written them again. Worse, each one encoded its
own guess about the markup: a renamed class would have broken them silently, and
they would have reported zero rather than an error.

## Root cause

The station had no debug surface. The only way in was the DOM, and the only tool
was whatever could be typed into an evaluate call, so every question became a
new program and every program made its own assumptions.

## Correction

The nine were replaced by one command with subcommands: `npm run station --
state | shoot | watch | probe | perf | puppet | verify`, on a single CDP client
in `scripts/lib/cdp.mjs`. `npm run screenshot` was moved onto the same client so
there is one WebSocket implementation, not two.

## Workflow integration

`src/debug/bridge.ts` publishes one typed snapshot - camera, detectors, hands,
cursor, mode, phase, every panel's travel, lean, glow and progress, and the list
of words currently on screen - and it lives next to the code that produces those
values, so a renderer change breaks it in the same commit. `AGENTS.md` and
`docs/development-workflow.md` now name `station state` as the first thing to run
when the question is "what is it doing", ahead of writing anything.

## Proof

`npm run station -- state` answers in one call what previously took three
scripts. `npm run verify` drives all thirteen interaction checks in about thirty
seconds against the live station, with no person in front of the camera.
