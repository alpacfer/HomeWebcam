# 0007. Working directory leaked between commands

- Date: 2026-09-04
- Status: integrated
- Area: process

## What happened

A command that changed directory into `node_modules` to inspect an icon package left the shell there.
The next command, `npm run screenshot`, resolved a different `package.json` and failed with
`Missing script: "screenshot"`.

## Impact

One failed capture run and a misleading error that pointed at the project's scripts rather than at
the working directory.

## Root cause

An agent shell session persists its working directory between commands, and the project's own
commands were being run as bare relative invocations that silently depend on it.

## Correction

The directory was restored and the command rerun from the repository root.

## Workflow integration

`docs/development-workflow.md` now states that project commands are run from the repository root and
that inspection of paths outside the repository uses absolute paths rather than `cd`, because the
shell state outlives the command.

## Proof

Every subsequent command in the session ran from the repository root and resolved the project's
scripts.
