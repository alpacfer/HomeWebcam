# Friction log

This directory records everything that interrupts the expected development or station workflow so
the project improves instead of rediscovering the same obstacle. Records are numbered and
append-only. A later discovery may add a dated addendum or superseding record; do not rewrite the
original friction out of history.

Log every user correction, failed tool or command, incorrect assumption, ambiguous instruction,
environment mismatch, unsafe fallback, repeated manual step, missing capability, privacy concern,
or workflow bottleneck. Small does not mean unworthy of recording; it may reveal the cheapest useful
automation.

## Lifecycle

- `open`: understood but not yet contained.
- `contained`: immediate impact stopped, durable integration still pending.
- `integrated`: correction, workflow improvement, and proof are complete.

`npm run check` validates the structure and index entry of every record. It cannot detect an omitted
friction; the mandatory end-of-task review in `docs/development-workflow.md` is the human checkpoint.

## Register

| Record | Status | Integrated improvement |
| --- | --- | --- |
| [0001. Active debug server bypassed](0001-active-debug-server-bypassed.md) | integrated | Preflight separates server and browser state; screenshots fail closed. |
| [0002. Learning workflow scoped too narrowly](0002-learning-workflow-scoped-too-narrowly.md) | integrated | All friction is logged; `npm run check` validates the register. |
| [0003. New scripts missed the formatter pass](0003-new-scripts-missed-formatter.md) | integrated | Formatting is now an explicit first verification step. |
| [0004. Progress rings filled backwards](0004-progress-rings-filled-backwards.md) | integrated | One shared `.ring` class; `npm run check` rejects a second conic gradient. |
| [0005. Screenshots could not reset the station](0005-screenshots-could-not-reset-the-station.md) | integrated | `npm run screenshot -- --reload` restarts the attached page. |
| [0006. Captures raced the picture flow](0006-captures-raced-the-picture-flow.md) | integrated | `--after` waits for an app state instead of sleeping. |
| [0007. Working directory leaked between commands](0007-working-directory-leaked-between-commands.md) | integrated | Commands run from the repository root; inspection uses absolute paths. |
| [0008. Test pictures indistinguishable from real ones](0008-test-pictures-indistinguishable-from-real-ones.md) | integrated | `npm run verify` removes exactly the photographs its own run took. |
| [0009. Every question needed a new throwaway script](0009-no-debug-surface-on-the-station.md) | integrated | One typed debug snapshot and one `npm run station` command. |
| [0010. Page code mangled by escaping](0010-page-code-mangled-by-escaping.md) | integrated | Values cross into the page as JSON data, never as interpolated code. |
| [0011. Frame rate measured through a throttle](0011-frame-rate-measured-through-a-throttle.md) | integrated | Window visibility is in the snapshot; `perf` refuses to be believed without it. |

## Record template

```markdown
# NNNN. Short friction name

- Date: YYYY-MM-DD
- Status: open | contained | integrated
- Area: runtime | tooling | UI | perception | privacy | documentation | process

## What happened

Observable facts. Do not minimize or assign blame.

## Impact

What became wrong, risky, slow, ambiguous, or misleading.

## Root cause

The system or process condition that allowed the friction.

## Correction

The immediate repair and any user-data cleanup.

## Workflow integration

The code, test, command, documentation, or mandatory checkpoint that improves future work.

## Proof

Commands, tests, or artifacts that demonstrate the correction.
```

A record reaches `integrated` only when correction, workflow improvement, and proof are all present.
