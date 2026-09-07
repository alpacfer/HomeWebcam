# 0028. Thresholds tuned by eye from a digest, and the person had to say so twice

- Date: 2026-09-07
- Status: integrated
- Area: perception

## What happened

ADR 0018 retuned every number in `CONFIG.paint.pinch` from four station takes,
read as digests, and shipped. The person who sat the takes ran the result and
reported that painting "does not start when it should and continues after I
separated" - the same two complaints the retune was for.

Their notes on the takes had already said it. Step 1: "the detection seems worse.
it does not start when it should or end". Step 2: "it stops sometimes". Both
were filed with the runs and both were read as confirmation that the numbers
needed one more nudge, rather than as evidence that the instrument could not see
the problem.

## Impact

One shipped regression in the feature's headline interaction, and a second round
of the same complaint from the same person. Replaying the gate over those takes
afterwards showed a line waiting up to 826 ms after the fingers had met, and the
twenty-second held pinch breaking in two.

## Root cause

The digest was the only instrument, and it reports a take's ratio distribution
and the ratio each line started at. Neither number can express "how long had
this person been holding contact before their line began", which is what both
complaints were about, so the tuning optimised what could be seen: line starts,
which happen at the ratio's low-water mark. That put `closeBelow` at 0.12, below
the 0.13-0.16 the same fingers read while plainly touching and holding.

The second fault was invisible for a different reason: ADR 0017's "a fist is
never a pinch" was a rule nothing measured. The recognizer labels a real pinch
`Closed_Fist` for hundreds of milliseconds at a time, so the rule cut lines; no
recorded take contains a genuine fist, so it has never once prevented one.

Underneath both: the recordings already held every frame's landmarks, so the
gate could have been replayed over them at any point. Nothing existed to do it,
so nobody did, and four takes' worth of ground truth was read through a summary.

## Correction

`closeBelow` 0.12 to 0.18 and `closeMs` 80 to 180 ms; a fist label may block a
line from starting and may never end one; `lostGraceMs` 120 to 200 ms. The worst
wait before a line starts falls to 234 ms and the held pinch stays one line. See
[ADR 0019](../adr/0019-a-pinch-measured-against-real-hands.md).

## Workflow integration

The takes are now a corpus rather than a memory. `scripts/pinch-corpus.mjs`
distils a recording into the one scalar the gate reads - no image, no position,
no face, so it can be committed - and `tests/pinch-takes.test.ts` replays the
real `PinchGate` over `tests/fixtures/pinch-takes/` in `npm run check`, asserting
what each take *meant*: three lines, one line, none, no breaks, and a line that
begins within two frames of the confirmation being up. Two of its cases exist
only to fail if the old numbers come back.

A threshold in `CONFIG.paint.pinch` is therefore no longer something an agent can
move on a reading of a digest. Moving one runs a person's hands against it.

## Proof

`npm run check` - 216 tests including the eight in `tests/pinch-takes.test.ts`.
`npm run verify` - 31/31, including `a-pinch-paints-a-line`, `a-fist-paints-nothing`
and `a-released-pinch-leaves-no-tail`. Task `paint-is-the-pinch-fixed` is open at
the station for the one claim none of that licenses: whether it feels right to a
person. See [ADR 0011](../adr/0011-puppet-perception.md).
