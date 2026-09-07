# 0030. A fixture that rounded through a threshold

- Date: 2026-09-07
- Status: integrated
- Area: tooling

## What happened

A fourth take was distilled into `tests/fixtures/pinch-takes/` and the replay
disagreed with the station: the corpus said the take drew 9 lines where the live
app had drawn 9 too, but under the new gate it said 9 where the station said 10,
and the missing line was a different one each time. Chasing it frame by frame
found a single frame, at 11074.8 ms, where the replay saw a `Closed_Fist` and
the live app had not.

## Impact

Half an hour, and very nearly worse: the discrepancy first looked like a bug in
the gate change being made at the time, and the obvious response would have been
to weaken the fist rule to make the replay agree with the station.

## Root cause

`scripts/pinch-corpus.mjs` rounded gesture confidence to two decimal places. The
frame's real confidence was 0.6997, which rounds to 0.70, and the rule it feeds
is `>= CONFIG.interaction.minGestureConfidence`, which is 0.7. So the fixture
turned "not confident enough to be a fist" into "a fist", the fist blocked the
line from starting, and the corpus reported a failure the station did not have.

A fixture is only worth what its fidelity is worth. Rounding is normally free
and is not free at all next to a threshold: the values that matter most are
exactly the ones sitting on one.

## Correction

Confidence is kept to four places, the same as the trace it comes from, and the
distiller says why in a comment naming this record. All four takes were rebuilt;
the vertical take then reproduced the station exactly, and the disagreement that
looked like a gate bug disappeared.

## Workflow integration

The distiller now carries the rule where the rounding happens, and the ADR 0019
corpus already had the habit that caught this: every take records what the
person meant, and the replay is checked against what the *station* did before
any threshold is moved on its word. That comparison is what surfaced a
one-frame discrepancy at all.

## Proof

`npm run check` - 225 tests, `tests/pinch-takes.test.ts` replaying four takes.
The vertical take's ten closes match the station's, frame for frame, and
`grep '"t":11074.8' tests/fixtures/pinch-takes/vertical-lines.json` shows
`"confidence":0.6997`.
