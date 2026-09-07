# 0027. A puppet leg stopped outlasting the gate it tripped

- Date: 2026-09-07
- Status: integrated
- Area: tooling

## What happened

The pinch gate's release confirmation went from 50 ms to 150 ms (ADR 0018). On
the next `npm run verify`, `the-eraser-cuts-a-hole` failed with
`alpha 255 -> 255`: the eraser did not erase, and the check pointed at the
eraser, which was working.

The `stroke` puppet scenario opens with a 200 ms leg sliding the pinch from
open to closed. Sliding means the ratio is only above the release threshold for
part of the leg - 136 ms of the 200. That had been ample against a 50 ms
confirmation and was 14 ms short of a 150 ms one, so a gate left closed by the
previous check was never seen to let go. The pinch that followed was therefore
still the previous check's, whose role was "picking a chip", and a scenario
built to draw a line painted nothing at all.

## Impact

One failing check on one run, blaming the wrong component. No product defect:
the app was correct throughout and the harness was describing a hand that had
not done what the scenario said.

## Root cause

A scenario duration that was implicitly coupled to a threshold, written as a
literal. ADR 0011 says scenario durations are derived from `CONFIG` so that a
scenario written to outlast a hold still outlasts it after the hold changes -
and `stroke` was written with 200 ms, breaking that rule quietly.

The subtler half: for an *interpolated* leg, "longer than the confirmation" is
not the requirement. Only the fraction of the leg on the far side of the
threshold counts, which for a full-range slide is about a third of it.

## Correction

`stroke` and `overshoot` derive every pinch leg from the gate: `openMs * 3` and
`closeMs * 3`, the factor of three being what an interpolated leg needs to put
a whole confirmation on the far side of a threshold. Both now open before they
close, so a pinch left closed by whatever ran before is always seen to let go.

## Workflow integration

A unit test, `gives the pinch gate room to see every change it is asked to see`,
asserts for every paint scenario that its opening leg is at least three times
`openMs`, its closing leg at least three times `closeMs`, and that it opens
before it closes. Changing either confirmation now fails in `npm run check`,
in milliseconds, instead of in `npm run verify` two minutes later against the
wrong suspect.

The scenario walk in `ships a stroke, an open sweep and a fist for Paint mode`
no longer probes fixed timestamps either; it walks the poses and asserts the
shape, so derived durations cannot break it.

## Proof

`npm run check` fails the new test when `openMs` is raised without touching the
scenarios, and passes as written. `npm run verify` returns
`the-eraser-cuts-a-hole` to `alpha 255 -> 0`, with all 31 checks passing.
