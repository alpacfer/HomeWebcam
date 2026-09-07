# 0020. A line starts where the fingers met, and an unmistakable pinch does not wait

## Context

ADR 0019 fixed a threshold that sat below where contact reads. The person went
back to the station, drew nine vertical lines, and filed the take with a note:

> i drew vertical lines. it takes a while to start detecting the line. a lot of
> delay. the start should be instant

Replaying that take says three things the earlier corpus could not, because it
is the first take in it where somebody draws *fast*.

**Every line waited the full confirmation.** All nine began 184-218 ms after the
fingers crossed `closeBelow`. Unlike the earlier takes the threshold is now
irrelevant: this person snaps their fingers shut from 0.41 to 0.11 inside one
100 ms bucket, so the mark is crossed at once and `closeMs` is the entire cost.

**A tenth line was drawn and never appeared.** There are ten deliberate contact
episodes in the take and nine strokes. In the missing one the fingers were shut
for 455 ms and the cursor travelled from y 0.15 to y 0.96 - the whole height of
the screen - and nothing was painted. The ratio popped over 0.18 for a frame
every 100 ms or so, and each pop reset `pendingSince` to zero, so an unbroken
180 ms never happened. The gate had hysteresis and a confirmation in the *out*
direction and nothing at all protecting the *in* direction.

**The wait is not only a wait; it is a piece of missing line.** While painting,
this hand moves 1.32 screen heights per second at the median and 2.65 at the
ninetieth percentile. A 180 ms confirmation is therefore 220 px of line at the
median and 440 px at the ninetieth, gone from the top of every stroke, because
the stroke was begun wherever the hand had got to by the time the gate agreed.
On a 1080p screen that is a quarter to a half of the screen height.

## Decision

**A line is drawn back to where the fingers met.** `PinchState.contactSince`
reports, on the frame a line begins, when the fingers actually crossed
`closeBelow`; `PaintSession` keeps the last `startBackdateMs` of readings and
begins the stroke there, replaying the points in between. The ink still appears
a confirmation late, and it appears whole.

This is the mirror of ADR 0018's release trim and rests on the same argument. A
level-crossing gate cannot help being late, so rather than guess earlier, the
line is corrected afterwards: the end gives ink back, the beginning takes ink
on. Seven of the ten vertical lines now lose nothing at all; the worst in the
corpus loses 89 ms, against a whole confirmation before.

**An unmistakable pinch does not wait for the ambiguous one's clock.**
`deepBelow` is 0.12 and `deepMs` 80 ms, alongside the 0.18 and 180 ms that
remain for a pinch that only grazes the mark. Across both takes where nothing
was meant to be drawn, the ratio dips under 0.12 thirteen times and never stays
there for 50 ms; a deliberate pinch arrives there within a frame or two of
crossing 0.18. Replayed over the corpus, 0.12 draws no false line at any
confirmation from 40 ms upward, so 80 ms is double the shortest value that
passes rather than a value sitting on an edge - 0.14 is on that edge and invents
a line at 40 ms.

The deep path is what recovers the missing tenth line: the fingers never left
0.12 during those 455 ms, so the mark that was being reset was never the one
that mattered. The take goes from 9 lines to 10, its median wait from 206 ms to
121 ms and its worst from 438 ms to 211 ms.

**`startBackdateMs` is a guard, not a shape.** A pending close either fires at
`closeMs` or is reset, so the gate can never be further behind the moment of
contact than one confirmation plus the frame that carries it, and 240 ms never
bites in the ordinary case. Setting it *at* `closeMs` did bite, shaving the last
frame off the head of every line that took the slow way in.

## Consequences

The corpus grew a fourth take and gained the only kind of hand it did not have:
a fast one. Everything above was measured by replaying the real `PinchGate` over
it, and two of the assertions in `tests/pinch-takes.test.ts` exist to fail if
either mechanism is removed - one replays the take with the deep mark disabled
and requires exactly the nine lines the person complained about.

`npm run verify` gained a scenario and a check for the same reason. Every paint
scenario until now held the hand still while the fingers closed, so none of them
could ever have caught this: `dive` closes them *while* travelling, and
`a-line-starts-where-the-fingers-met` reads the canvas where the fingers met and
requires ink there. With `startBackdateMs` set to 0 that check reports alpha 0
and fails, which is how it is known to be a check rather than a decoration.

Two mechanisms are two things to tune, and the ADR 0018 objection to that stands.
They are kept apart deliberately: the deep mark decides *when* a line is
certain, the back-date decides *what is in it*. Neither can be adjusted into
doing the other's job, and the corpus measures them separately - `waitMs` and
`lostMs`.

What is still lost is the two or three frames between plain contact and
`closeBelow`, because the gate's clock has not started then. Recovering it would
mean lowering the mark again, which is what ADR 0019 was about.

## Alternatives

**Shorten `closeMs`.** The obvious reading of "the start should be instant", and
wrong on its own: the take where nothing was meant to be drawn stays under 0.18
for up to 98 ms, so a shorter single confirmation invents lines. Splitting it by
depth gets the speed where it is safe and keeps the caution where it is needed.

**A leaky confirmation** - credit accumulating while the ratio is under the mark
and draining while it is over, so a spike costs a little rather than everything.
Built and measured, and it recovers nothing the deep path does not: the spikes
in the missing episode come in pairs, and a decay slow enough to survive them is
slow enough to accumulate across dips that meant nothing. Two mechanisms where
one will do, so it was dropped.

**Draw the line optimistically from the first frame under the mark and erase it
if the pinch never confirms.** Instant, and it puts ink on the glass that
sometimes has to be taken off, which is the failure ADR 0018 spent a whole
record making rare. Back-dating buys the same geometry and never shows a line
that will not survive.

**Leave it and explain the wait.** A hallway mirror explains nothing; there is
nobody to read it.
