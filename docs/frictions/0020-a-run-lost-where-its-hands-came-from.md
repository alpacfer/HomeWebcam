# 0020. A run lost where its hands came from

- Date: 2026-09-05
- Status: integrated
- Area: tooling

## What happened

A task run carries `perceptionSource`, so a step answered by scripted hands can
never be read as a person answering it. The browser sent it. The server, which
copies a run field by field into the task file, had never been told about it, so
every run was written without it. `npm run task -- show` then printed a puppet's
numbers with no badge at all - and after the field was added to the printer but
before the cause was found, it printed the word "undefined" where the provenance
should have been.

## Impact

For a few minutes the tool did the one thing this project has an ADR against: it
presented invented hands as though a person had stood in front of the camera.
Two task files were written with the provenance missing and cannot get it back.

## Root cause

A whitelist that has to be updated in two places and enforces nothing. The
browser could add a field to a run and the server would silently drop it, with
no type shared between them and no test comparing the two.

## Correction

`applyRun` keeps the field, and anything that is not exactly "camera" or
"puppet" is stored as `"unknown"` rather than defaulting to camera: a run whose
provenance was lost must not read as evidence. Both readers - the panel on the
mirror and `npm run task -- show` - say "unknown" out loud.

## Workflow integration

`applyRun` and `applyStatus` are exported from `vite.config.ts` and
`tests/recording-names.test.ts` pins what a run must keep, including that a
missing or malformed source becomes `unknown` and never `camera`. The
`a-step-records-and-files-itself` check in `npm run verify` fails unless the run
that lands on disk names where its hands came from.

## Proof

`npm run check` - 136 tests. `npm run verify` - 17/17, the task check reporting
`camera · 21 frames · task done`. On the station, a puppet-driven step now reads
`⚠ PUPPET HANDS` in `npm run task -- show` and `puppet ·` on the mirror.
