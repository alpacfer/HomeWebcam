# 0023. Ink waits for contact, and the band between the marks has a clock

## Context

The person at the station recorded a take and wrote on it: "when I start
pinching, then I separate the fingers slightly and that should stop the
drawing, but the pinching seems sticky ... the line keeps going until I
separate the fingers more. It needs to be more responsive. Only drawing when my
2 fingers are in contact."

The trace says exactly what happened. Four pinches; in three of them the
fingertips touched for one to two seconds at a ratio of 0.10-0.16, then parted
to a steady 0.22-0.29 for 1.6 to 5.5 seconds while the hand kept moving, then
opened wide. The video at those moments shows a clear gap between the tips. The
gate held every one of those lines the whole time: 11.5 s of ink with the
fingers apart in a 27 s take, and a release 2.6 s late at the median. The
fourth pinch opened wide at once and released in 150 ms, as designed.

The reason is structural, not a number. The gate closes under 0.18 and opens
above 0.32, and the band between the two is hysteresis with no clock: a reading
that settled anywhere inside it was held indefinitely. ADR 0018 chose the wide
band so that landmark glitches during a held pinch - excursions to 0.24-0.80 for
up to nine frames - could not cut a line, and ADR 0019 confirmed that every
lower open mark breaks the twenty-second pinch. Both records assumed a hand in
the band was on its way somewhere. A hand parted by a centimetre is not; it
lives there. On this scalar the two are the same number: the loose-band
excursions of a genuinely held pinch sit at 0.22-0.27, the same level as these
parted fingertips. Only duration separates them.

ADR 0018's answer to the release complaint was the trim: draw for the 150 ms
the gate needs and take the ink back afterwards, capped at 300 ms. It never
reached this case, because the gate never released. And the trim was a
correction of ink already on the glass, which is the thing the person was
watching.

## Decision

**Ink flows only while the fingers are together; the line ends later.**
`PinchState.touching` says, every frame and before any confirmation, whether
the hold reading (the nearest of three pairs, ADR 0022) is under `closeBelow`.
`PaintSession` lays a point only while the gate is closed *and* `touching`.
While a line is open and the fingers are apart, the points the hand travels
through are held back. Contact again before the gate gives up and they are laid
down in order, so a glitch the gate rode out leaves the line whole and following
the hand's path. The gate giving up and they are dropped. Nothing past a
parting ever reaches the glass, so there is nothing to trim: `Painting.trim`,
`releaseTrimMs` and the redraw a trimmed line needed are gone.

**The band between the marks has a clock.** `looseMs` is 400 ms. A closed gate
whose hold reading has been at or above `closeBelow` continuously for that long
opens, whatever the reading. Contact resets it. The wide-open path - above
`openAbove` for `openMs` - is unchanged and still faster.

400 ms is the shortest limit that cuts no line in the corpus. The nearest-pair
reading strays above contact during genuinely held pinches for up to 178 ms in
the twenty-second take and 173 ms in the other continuous one; two takes have
one excursion each of 351 and 387 ms, at which 300 ms breaks a line. The one
take 400 ms does shorten is a fast, close, motion-blurred continuous take, at
two points where the reading sat above contact for 550-750 ms; the video there
is too blurred to say whether the fingers had parted, and the person's note
says the drawing had already stopped at points during it. Because the ink is
held back rather than drawn, the limit costs nothing visible: it decides when a
*line* ends and when a re-touch starts a new one rather than continuing, not
when the ink stops.

**The brush ring says what the glass says.** `pressed` is now the gate closed
and the fingers together, so the disc drops back to the grip the frame the ink
stops, rather than 150 ms later. The roadmap had this down as a known lie.

**The take is in the corpus, and the digest can see the problem.**
`tests/fixtures/pinch-takes/parted-slightly.json` carries the recording, with
the fifth line explained: a 200 ms near-touch at 7.0 s that reads 0.16-0.17 and
is contact by the ruler. `tests/pinch-takes.test.ts` asserts that every line in
it ends within `looseMs` of the last frame the fingers were together, that
without the limit one ran on for over two seconds, and that the limit changes
no other take's count. The digest reports `loose`, the fraction of pinched
frames with the fingers apart; this take would have read 0.72 there, next to a
`pinched` of 0.68 that showed nothing wrong.

**A scenario and a check drive it.** `part` draws a line, parts the fingers to a
reading of about 0.22 and keeps travelling for twice the limit, and never opens
wide. `a-parted-pinch-ends-the-line` requires the line to end while the hand is
still parted and finds no ink past the parting.

## Consequences

The visible behaviour on a release is now: the ink stops where the fingers
parted, the same frame; the cursor ring empties the same frame; and the line is
formally over 150 ms later if the hand opens wide, 400 ms later if it stays
half-open. Nothing is ever retracted from the glass.

What it costs is a stutter on a glitch. During a held pinch, when the reading
pops above 0.18 for a few frames, the ink pauses and then catches up in one
frame when contact returns. On the hold reading these pauses run to 178 ms in
the corpus's continuous takes and happen about once every five seconds of
painting; at 1.32 screen heights a second the catch-up is up to 240 px. ADR 0019
rejected holding ink back for exactly this reason, measured on the tip-to-tip
ratio, where the pauses were longer and more frequent. On the nearest-pair
reading they are rarer and shorter, and the alternative - ink on the glass the
person did not mean, for as long as they hold that pose - is the complaint that
was recorded.

A pinch parted and re-touched inside 400 ms is one line, bridged through the
parting. A dashed line therefore needs gaps longer than that. A pinch parted
for longer starts a new line on re-contact, after the ordinary confirmation.

The corpus test's independent contact ruler, 0.22, is now known to be too
generous for this person: the video shows their fingertips visibly apart at
0.21, and the head-loss assertion that uses it is scoped to the takes it was
set on. A per-person contact level is the next thing a bigger corpus would
have to carry.

Everything here was measured on the 720p/60 debug profile, like every take
before it (friction 0033). The limit is a duration, not a level, so it should
carry to the visitor's profile; the corpus needs a 1080p take to say so.

## Alternatives

**Lower `openAbove`.** The obvious reading, forbidden twice already (ADR 0018,
ADR 0019), and now measured to be pointless as well: the parted fingertips and
the held pinch's excursions read the same level.

**Draw the loose ink and trim it when the limit fires.** The mechanism ADR 0018
built, extended to the new release path. It works on the replay, and it puts up
to 400 ms of unmeant ink on the glass on every single release and then pulls it
back, which is the thing being complained about made shorter. Holding the ink
back costs a rare stutter instead of a retraction on every line.

**A shorter limit, 250-300 ms.** Better latency for the line's formal end, which
nothing visible depends on any more, and it breaks two lines in the corpus that
the person meant as one.

**Judge a parting by the tips and a glitch by the joints.** Attractive: a glitch
usually moves one landmark, a parting moves them all. Not separable in the data:
the long excursions in the continuous takes moved all three pairs together, at
the same level as a real parting, with tracking confidence at 0.97-1.00.

**Judge by the metric gap.** It read 51-69 mm during contact in one episode of
this take and 5-13 mm in another. ADR 0021 stands.
