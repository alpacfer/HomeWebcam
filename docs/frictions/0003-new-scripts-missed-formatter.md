# 0003. New scripts missed the formatter pass

- Date: 2026-09-04
- Status: integrated
- Area: process

## What happened

The first full check after adding the preflight and friction-validation scripts stopped because
Biome found formatting differences in both new files.

## Impact

No product behavior was affected, but the verification flow was interrupted and required another
edit-and-check cycle.

## Root cause

The workflow named the non-mutating full check as mandatory but did not explicitly put the project's
formatter before it in the verification sequence.

## Correction

The formatter was run on the new scripts before repeating the full validation.

## Workflow integration

`docs/development-workflow.md` and `AGENTS.md` now require `npm run fix` followed by a review of its
diff before `npm run check` and `git diff --check`.

## Proof

The subsequent `npm run check` completes Biome, TypeScript, Vitest, and the friction-record validator
without formatting errors.
