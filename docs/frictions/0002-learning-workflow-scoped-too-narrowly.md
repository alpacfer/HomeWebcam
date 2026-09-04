# 0002. Learning workflow scoped too narrowly

- Date: 2026-09-04
- Status: integrated
- Area: process

## What happened

The first learning workflow treated user-corrected mistakes and incidents as the only events worth
recording. The user clarified that every future friction should be captured and its fix integrated,
including blockers, ambiguity, tool limitations, and workflow inefficiency that are not mistakes.

## Impact

The narrower system would have lost useful lessons from non-incident work and allowed recurring
manual workarounds or unclear guidance to remain outside the improvement loop.

## Root cause

The requirement was interpreted as fault handling rather than continuous workflow improvement. The
recording trigger was based on severity and blame instead of any deviation from the expected path.

## Correction

The project now uses a general friction log with `open`, `contained`, and `integrated` lifecycle
states. Its inclusion criteria explicitly cover every interruption to expected work.

## Workflow integration

- `docs/development-workflow.md` requires an end-of-task friction review and integration step.
- `AGENTS.md` makes the friction loop mandatory for future agents and contributors.
- `scripts/check-frictions.mjs` validates that every record is structured and indexed.
- `npm run check` runs that validation with lint, types, and tests.

## Proof

This clarification is itself record 0002 and appears in the friction register. Running
`npm run check` validates both records and their required sections.
