# 0019. The pinch gate is replayed against real hands, not tuned by eye

## Context

ADR 0018 set every number in `CONFIG.paint.pinch` from four takes at the
station, read as digests. The person who sat those takes came back and said the
painting was worse: it did not start when it should, and it kept going after
they had separated their fingers. Their own notes on the takes had said the
same - "the detection seems worse. it does not start when it should or end",
and "it stops sometimes" - under a set of thresholds chosen to fix exactly that.

The digests were not wrong; they were too coarse to decide with. A digest gives
a take's minimum, median and maximum ratio and the ratio each line started at.
It cannot say how long a person had been holding contact before their line
began, and that turned out to be the whole story.

Those takes are recordings, and a recording keeps the landmarks frame by frame.
Replaying the gate over them - and reproducing all three takes' stroke counts
exactly, which is what says the replay is faithful - answers questions the
digest cannot:

| | three shapes | one held pinch | nothing meant |
| --- | --- | --- | --- |
| lines it should draw | 3 | 1 | 0 |
| lines it drew | 3 | **2** | 0 |
| worst wait before a line began | **369 ms** | **826 ms** | - |

Two separate faults, neither visible in a digest.

**The close threshold sat below where contact reads.** `closeBelow` was 0.12,
picked as the midpoint between four deliberate line starts at 0.10 and lower and
one accidental one at 0.13. But a line *starts* at the ratio's low-water mark
and is *held* well above it: this person's fingers, plainly touching, sat at
0.13-0.16 for hundreds of milliseconds at a time. 0.12 called that open, so a
line waited for them to squeeze harder rather than for the gate to be sure.

**A fist label ended a line that was still being drawn.** The recognizer called
the deliberately unbroken twenty-second pinch a `Closed_Fist` at full confidence
for 238 ms straight, and ADR 0017's rule - a fist is never a pinch - cut the
line in half. Across the whole corpus the label lands on 197 frames, every one
of them a hand painting on purpose; the take where nothing was meant to be drawn
contains none at all.

The level was never what separated a deliberate pinch from an accident. The
duration was. In the take where nothing was meant to be drawn the ratio never
stayed under 0.18 for longer than 98 ms; every line that was meant held for
hundreds of milliseconds.

## Decision

**A take becomes a fixture.** Each recording is distilled to the one number the
gate reads - the thumb-to-index gap over the hand's own size - plus the gesture
label, and committed under `tests/fixtures/pinch-takes/` with what the person
was asked to do and how many lines that should be. `tests/pinch-takes.test.ts`
replays the real `PinchGate` over them and asserts the counts, that no line
breaks, and that a line begins within a couple of frames of the confirmation
being up. `scripts/pinch-corpus.mjs` distils a new one.

This is the durable half of this record. Every number below is a consequence of
the corpus and can be re-derived from it; none of them should be moved without
re-running it, and a new way to hold a hand should arrive as a new take.

**`closeBelow` rises to 0.18 and `closeMs` to 180 ms.** The mark only has to sit
above a real contact, because the confirmation time does the discriminating -
180 ms clears the longest accidental dip in the corpus by 82 ms. The worst wait
before a line begins falls from 826 ms to 234 ms and from 369 ms to 212 ms,
which is the confirmation plus a frame or two: the floor.

**A `Closed_Fist` may keep a line from starting. It may never end one.** The
label is worth having on the way in - with the index curled the thumb rests on
it and the gap alone reads as pinched, so a dragged fist would paint. On the way
out its only measured effect is to cut lines.

**`lostGraceMs` rises to 200 ms**, into an empty gap. The detector dropped the
hand 39 times across the six paint takes and the lengths come in two clumps with
nothing between: 28 glitches with a 48 ms median and none over 120 ms, and 11
real departures of 300 ms and up, none of them mid-line.

**The brush ring fills continuously with the measurement, not the decision.**
`PinchState.grip` is how shut the fingers are between the two marks, before any
confirmation, and the ring's disc is drawn to it. A visitor whose pinch is not
quite tight enough can see that instead of guessing, which is the same complaint
answered where it is cheapest to answer. The solid fill still comes from the
gate, so the two say different things on purpose: the measurement is honest
immediately and jitters, the decision is steady and 150 ms late.

## Consequences

The trim of ADR 0018 gets more honest for free, because it walks back to the
last point tighter than `closeBelow`. At 0.12 it took back more than had been
drawn loose - 75 thousandths of a screen height against 40 on the three-shapes
take - so a line ended visibly shorter than it was drawn. At 0.18 it lands
within 7 on every line in the corpus.

What a committed take costs is one privacy judgement, made explicitly. A
recording is video of whoever was standing in the hallway and never leaves this
machine (ADR 0014). A pinch take is not the recording: it is one scalar and a
label per frame, with no image, no position, no face, no identity and nothing
that can reconstruct any of them. That is committable, and committing it is what
turns "verify at the station" from a promise into a test.

The corpus is small and one person's hands. It cannot say what a child's pinch
reads, or a hand at three metres, and the numbers here should be read as this
station's rather than as anyone's. It does now measure that a far hand is a
noisier one: over equal-sized bins the ratio's frame-to-frame jump more than
doubles as the hand shrinks, from a median of 0.021 to 0.048, and spikes past
0.2 go from 6 to 86. Distance therefore belongs in the next set of takes.

ADR 0018's own reasoning survives intact where it was tested. Lowering
`openAbove` still cuts the held line - every value below 0.32 breaks it in the
replay, exactly as that record predicted - and smoothing the ratio still does
not help: a 3, 5 or 7 frame median makes the accidental dips no shorter and the
worst of them longer.

## Alternatives

**Hold back the uncertain ink instead of drawing it and taking it back.** The
release tail would never be seen at all. Rejected on the corpus: the ratio pops
above `closeBelow` in runs longer than 150 ms eight times during the held pinch,
so the ink would visibly lag the hand about once every three and a half seconds
of painting, against one retraction per line. Trading a rare correction for a
frequent stutter.

**Drop the fist veto entirely.** Tempting, since it has never once prevented a
false line in a recorded take. Rejected because no recorded take contains a
genuine dragged fist either: its benefit is unmeasured rather than disproven,
and a fist does measure as pinched. Blocking a start is the half that cannot cut
a line, so that is the half kept, and a fist take is the next thing to ask for.

**A geometric fist test** - the index tip sits near the palm in a fist and out at
the thumb in a pinch. Measured and rejected: index reach falls below 0.55 of the
hand's size on 279 of 493 frames of the three-shapes take, because pinching
curls the index too. The two poses are not separable that way.

**Lower `closeBelow` further still, toward the 0.02 a hard pinch reads.** The
direction the first three takes appeared to ask for and the direction that
caused this record. The mark wants to be above a real contact, not at its floor.
