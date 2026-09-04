# 0012. No way to focus the station from the command line

- Date: 2026-09-04
- Status: integrated
- Area: tooling

## What happened

A performance review opened with `npm run station -- state`, which reported
15 fps. Friction 0011 had established that an unfocused window is throttled and
that a frame rate measured then is a measurement of the throttle, so the first
question was whether this window was focused. The snapshot said
`focused: false`.

There was no command to fix that. The machine has neither `xdotool` nor
`wmctrl`. Deciding whether the headline number was real took an ad-hoc CDP
script calling `Page.bringToFront` - exactly the throwaway script friction 0009
was raised to eliminate.

Eight more throwaway scripts followed over the session for the same reason:
each new question needed a one-off file because the station could not be asked
to change its own conditions, only to describe them.

## Impact

The single most important number in the review could not be trusted or
dismissed without writing code first. The throttle guard could say "this
measurement is worthless" but never "here, I fixed it".

Worse, `printState` did not call `throttleWarning` at all, though friction 0011
records that it does. `state` printed `15 fps` next to an unfocused window in
silence. The guard existed, was tested by hand once, and was wired into `perf`
only.

## Root cause

Friction 0011 added a diagnosis without a remedy, and its integration was
verified against `perf` while its own record claimed `state` too. A guard that
is only wired into one of two call sites reads, from the outside, exactly like a
guard that works.

## Correction

`npm run station -- focus` brings the window to the front and says whether it
took, then prints the state. `perf` now calls `Page.bringToFront` itself before
measuring instead of only complaining. `printState` calls `throttleWarning`, so
the promise friction 0011 made is now kept by the code.

## Workflow integration

Any station command that reports a frame rate either fixes the focus or names
the throttle. `focus` is the documented first step of a performance question in
`AGENTS.md` and `docs/development-workflow.md`.

## Proof

`npm run station -- focus` prints
`[focus] window visible, focused - frame rates are now worth reading`, and
`npm run station -- state` on an unfocused window now prints the throttle
warning underneath the frame rate instead of nothing.
