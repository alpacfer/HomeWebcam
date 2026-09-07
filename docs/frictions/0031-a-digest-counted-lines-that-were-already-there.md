# 0031. A digest counted lines that were already on the glass

- Date: 2026-09-07
- Status: integrated
- Area: tooling

## What happened

The person at the station held one pinch for thirty seconds without letting go,
as a task step asked. `npm run task -- show latest` printed the run as
`7 stroke(s)`, and the assessment that followed read that as six unwanted line
breaks in one continuous pinch - a severe failure of the gate, and the headline
of the review for several minutes.

The trace said otherwise. The stroke count began the take at 5 and rose twice.
The take drew two lines and broke once; the other five were the previous take's
painting, still on the glass.

## Impact

A wrong diagnosis at the top of a review, corrected only because the trace was
replayed frame by frame. On a take whose whole question was "does the line
break", the one number the digest printed answered a different question.

## Root cause

`TraceDigest.paint.strokes` was the *most strokes on the glass during the take*,
and its one-line description printed it as `N stroke(s)`. A painting survives
from one take to the next, so the count includes every earlier take's lines.
The digest already knew how many lines this take began - it collected the ratio
at each rise in the count as `strokeStarts` - but only when the ratio was
non-null, and it never printed the count of them.

## Correction

`strokesDrawn` counts every rise in the stroke count during the take, and the
description prints `2 line(s) drawn, 7 on the glass` when the two differ, both
in `src/debug/trace.ts` and in the mirror of it in `scripts/tasks.mjs`. Digests
written before the field existed print as `N stroke(s) on the glass`, which is
what they always meant.

## Workflow integration

A unit test replays the exact take shape - five on the glass, two rises - and
asserts both numbers and the printed line. The digest's doc comment now says
what `strokes` is and is not, and names this record.

## Proof

`npm run check`: `tests/trace.test.ts` "tells lines this take drew apart from
lines already on the glass". `npm run task -- show latest` on the held-pinch run
now reads `2 line(s) drawn, 7 on the glass`.
