# 0018. A pinch starts on contact, ends slowly, and gives its tail back

## Context

ADR 0017 shipped paint mode with a pinch gate whose thresholds came from a
fixture hand. Three takes at the station replaced every one of those guesses,
and two of the readings pointed in opposite directions.

Asked to draw three shapes, one spiral, and then to move about without meaning
to paint, one person produced exactly 3, 1 and 1 lines. The four lines they
meant began at ratios 0.10, 0.09, 0.06 and 0.02; the one they did not mean began
at 0.13. They reported the opposite problem too, twice: "I need to separate the
fingers too much to actually stop painting", and "it continued painting when I
had already separated my fingers". Measured over the last 150 ms of every line,
the ratio was already a median 0.28.

That reads as "lower both thresholds", and a fourth take proved it wrong. Asked
to hold **one** pinch for thirty seconds without ever letting go, they got three
lines: it broke twice. Neither break was a finger.

| Break | Ratio | Tracking confidence |
| --- | --- | --- |
| 14.62 s | drifted 0.15 to 0.31, then 0.63 for two frames | fell to 0.52 |
| 19.14 s | steady at 0.09, then 0.80 for two frames | 1.00 throughout |

In that take the ratio ran above 0.24 in runs of up to nine frames while the
fingers never parted. The thumb and index tips are the two noisiest landmarks
the model produces, and they are noisiest while the fingers are shut.

## Decision

**Start on contact.** `closeBelow` is 0.12, the middle of the only gap the data
offers between the four deliberate starts (≤0.10) and the accidental one (0.13).
Erring low is deliberate: a line that will not start is fixed by squeezing
harder, a line that starts by itself has to be erased.

**Do not lower the release.** `openAbove` stays at 0.32. Nine-frame excursions
past 0.24 during a held pinch mean a lower mark cuts lines, and a cut line is
worse than a late one.

**Confirm asymmetrically.** `closeMs` is 80 ms, about three frames, enough to
reject the one- and two-frame dips a still hand produces. `openMs` is 150 ms,
which rides out every glitch in the continuous take while leaving its two
genuine releases, at 13 and 25 frames, intact.

**Give the tail back.** A gate that waits 150 ms to be certain draws for 150 ms
after the fingers have parted, and no threshold can fix that. So when a line
ends, the points laid down after the pinch last left contact are removed, back
to the last point tighter than `closeBelow`, capped at `releaseTrimMs` of 300 ms.
The canvas is redrawn once. The trim is what buys the long `openMs`: the gate
can afford to be slow and certain because nothing it draws while deciding
survives.

## Consequences

The two complaints are answered by different mechanisms, which is why neither
could be fixed by moving a number. Stickiness is now bounded by the trim rather
than by the threshold, and line continuity is bought with the threshold rather
than paid for in stickiness.

The trim only ever removes a run at the very **end** of a line, stopping at the
first point where the pinch was tight. A pinch that wandered loose mid-line and
came back was drawing, and that ink is kept.

A pinch held loose - between 0.12 and 0.32 - for its whole final third of a
second loses that third of a second. That is the intended reading of "it shall
only paint when the fingers are in contact", and it is capped so it can never
eat a line.

`openMs` costs 150 ms before the brush cursor stops looking pressed. The ink is
correct; the cursor is briefly a liar. Worth watching at the station.

None of these numbers came from a person's opinion about how it feels, including
the person's own: they came from four takes and their traces. The instrument
that made that possible is the digest's pinch histogram and its per-line start
ratios, added for exactly this. Re-run it after any change here.

## Alternatives

**Lower `openAbove` and keep one confirmation time.** What the first three takes
appeared to ask for, and what the fourth forbids. It would have cut the
continuous line far more often than it did.

**Trust the tracking confidence.** It does not help: the worse of the two breaks
happened at confidence 1.00.

**Smooth the ratio.** A low-pass over the ratio would blunt the two-frame spikes,
and would also delay a real release by the same amount, which is the confirmation
time again with less control over it. The gate already has hysteresis; adding a
filter underneath makes two things to tune where one will do.

**Require the fingers to touch (ratio near zero).** Contact reads 0.01 to 0.10
depending on the angle, never a stable zero, because the landmarks sit on the
finger pads rather than the skin surface. There is no "touching" to detect.
