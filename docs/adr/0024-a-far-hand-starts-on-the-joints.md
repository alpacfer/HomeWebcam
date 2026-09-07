# 0024. Distance changes which reading starts a line, not where the marks are

## Context

The person at the station asked for the pinch threshold to depend on distance
from the camera, and on the hand's position. The request rests on a premise
that was worth checking before anything moved: that a pinch reads differently
far away than near.

It does not, in the sense that matters for a mark. The ratio is the tip-to-tip
gap divided by the hand's own size (ADR 0017), and across 3,683 contact frames
in twelve takes a touching pinch reads a median of 0.10-0.11 in every hand-size
bin from 70 px up, and 0.11 under 55 px. Orientation moves it no more: binned
by the palm's width-to-length ratio, from a hand seen edge-on to one pointing
at the camera, contact sits at 0.10-0.12 and an open hand at 0.36-0.42. The
one take with world landmarks hints that a palm tilted 40-60° to the camera
reads contact higher, on 26 frames, resting on depth values ADR 0021 showed to
be wrong by centimetres. There is no pose-dependent mark to be had from this
data.

What distance does change is the noise, as ADR 0021 measured: the share of a
closed pinch spent above the 0.18 mark rises from 21% for a big hand to 60-66%
under 70 px. In the two-metre take - eight lines meant, four drawn, a palm
0.05-0.08 of the frame high - the missed pinches are visible in the trace: the
tip ratio pops over 0.18 every few frames so no confirmation completes, while
the nearest-pair reading (ADR 0022) sits at 0.00-0.09 the whole time. The tips
are the noise there and the joints are the signal.

Raising the mark instead recovers one line at 180 ms and needs a 120 ms
confirmation at 0.26 to recover them all, at which point a near idle hand
invents one to two lines. The mark is not the lever.

## Decision

**A far hand starts a line on the nearest-pair reading; a near hand on the
tips.** `PinchGate.update` takes the hand's size, and when it is under
`CONFIG.paint.pinch.farBelow` the reading a line may start on is the hold
reading. Every mark and every confirmation time is unchanged. Replayed over the
corpus, the two-metre take goes from 4 lines to 7 of 8, and no near take
changes by a single line.

**The rule is gated by size because ungated it lies.** Starting on the joints at
every size invents two lines in a near idle take, exactly as ADR 0022 recorded:
a thumb resting on the side of a pointing index puts the thumb tip 0.07 from
the index's middle joint while the tips are plainly apart. Near hands keep the
tips.

**`farBelow` is 0.09, the middle of an empty gap.** The far take's palm never
exceeds 0.080 of the frame height; no near take's drops under 0.101. It is a
fraction of the frame rather than a pixel size so it means the same distance on
both camera profiles; the pixel count behind it is half again on the visitor's
1080p, and the corpus is 720p.

**The corpus carries the size.** Every fixture was regenerated with a `size`
column and two takes joined it: `eight-lines-at-two-metres`, which records the
eight lines meant and is asserted at the seven the gate gets, and
`nothing-meant-near`, the idle take at arm's length that draws two lines on the
joints and none on the tips, which is what holds the size gate in place. The
puppet's default hand measures 0.117, so no scripted scenario is far; `station
puppet hold --scale 0.12` makes one that is, and the HUD reads `far`.

## Consequences

Seven of eight lines at two metres, where the station drew four. The eighth,
at 13.1 s, pops on every pair and is lost to pixels (ADR 0021).

The other half of the evidence does not exist. A far hand that means nothing
has never been recorded, so whether the joints start lines an idle person did
not mean at two metres is unmeasured; the near idle take says they would if the
rule were not gated, and a far hand is noisier still. A task asks for that take,
and until it is filed this rule is a hypothesis the corpus supports on one
side. Friction 0035 holds it open.

The gate now has a third input. `size` defaults to a hand that is not far, so
a caller that passes nothing gets the near rule and the old behaviour.

Position in the frame was not examined separately from size. A hand at the
edge of a wide lens is seen more obliquely, but every take so far has the hand
near the middle of the frame, and orientation - which is what obliqueness would
change - showed nothing.

## Alternatives

**A lower or higher close mark for a far hand.** Contact reads the same ratio at
every size, so there is nothing to move it toward; a higher mark only tolerates
more pops, and buys one line before the confirmation has to shrink and idle
hands start drawing.

**A shorter confirmation for a far hand.** Eight of eight at 0.26 and 120 ms,
and one to two invented lines in near idle takes at the same setting. At
distance, with more noise, the false side can only be worse.

**Start on the joints at every size.** Seven of eight at two metres, and two
lines nobody meant at arm's length. ADR 0022 rejected this on one false start;
the corpus now has two more.

**A pose-dependent mark.** The measurement above found no pose effect to
compensate. The world landmarks that would describe the pose in three
dimensions are the ones ADR 0021 found biased by centimetres.

**A continuous blend of the two readings by size.** A weighted mean of the tips
and the nearest pair, sliding with the hand's size. Nothing in the corpus
occupies the 0.080-0.101 gap the switch sits in, so a blend would be a shape
fitted to no data.
