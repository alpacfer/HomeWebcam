# 0017. Paint mode: pinch to draw, point to choose

## Context

The second tile on the menu was a locked game. It became a paint mode: pinch
thumb and index and a line follows the hand across the mirror; pick colours,
widths and an eraser; wipe the lot. One hand, no depth, no words.

Three questions had to be settled before any of it could be built. Which point
of the hand is the brush. How a pinch is read, given that the recognizer has no
pinch label and the thumb and index tips are the two noisiest landmarks it
produces (ADR 0005 rejected pinch as the *click* for that reason). And how one
hand chooses a tool without a second hand, a voice or a caption.

## Decision

**The pointer is the pinch point**, the midpoint of the two fingertips, and it
is the pointer even while the hand is open. It is the one point that is
continuous through a pinch: the index tip travels several centimetres toward
the thumb as the fingers close, so a line anchored on the index tip would start
beside where the cursor had been. The mode menu is driven by the same point
while paint mode is on, so a visitor has one place they point with.

**A pinch is measured, gated and confirmed.** `src/interaction/pinch.ts` divides
the tip-to-tip gap by the hand's own size - the larger of palm length and palm
width, because one of the two is foreshortened whenever the hand tilts toward
the camera - so the number means the same thing at one metre and three. Two
thresholds give hysteresis; a change must hold for `confirmMs` before it counts;
a hand the tracker drops for less than `lostGraceMs` keeps its stroke. A hand
the model labels `Closed_Fist` is never pinched: with the index curled into the
palm the thumb lands on it, and the gap alone reads as a pinch.

**Pinched over the mirror paints. Open over a chip dwells. Pinched over a chip
picks at once.** The tray of tools is the mode menu again at a third of the
size: same glass, same reveal light, same springs with shorter travel, same
dwell. Pinch-to-pick is an accelerator, not the only way in - by the time a
visitor is over the tray they have already learned what a pinch is, so ADR
0005's objection no longer applies there. A stroke that began on the mirror
keeps painting wherever it goes and picks nothing; a pinch that began on a
control never paints. The bin is the one exception: it responds only to a hold
of `clearDwellMs`, twice the ordinary dwell, pinched or not, because it cannot
be undone.

**The line is smoothed twice.** The pinch point runs through its own 1€ filter
with a lower floor than the cursor's and no prediction, because prediction
overshoots at every reversal and on a line that is a hook drawn at every corner.
Samples closer than `minSegment` are dropped. What remains is drawn as one
quadratic curve per point through the midpoints of successive samples, so a
hand's jitter becomes a gentle wobble instead of a zigzag, and the curve can be
drawn one segment at a time as the points arrive. Strokes are kept in
normalized coordinates; the canvas is redrawn from them on resize, on clear,
and on re-entering the mode.

**The brush cursor teaches the pinch.** A ring the size and colour the ink will
be, with the two fingertips drawn as dots either side of it. Close the fingers
and the dots land on the ring and it fills. The Paint tile carries no gesture
badge: the icon set has no pinch, and a badge would say less than the cursor.

Everything tunable is under `CONFIG.paint`. Every number there was set against
a fixture hand and says so; the tasks below are how they get set against a
real one.

**Every threshold in this record has since been replaced by measurement, and the
release mechanism with it. See
[ADR 0018](0018-paint-releases-on-contact.md).** The fixture's 0.35 and 0.55
were both wrong, and the second of them was wrong in the direction that is not
obvious: lowering it cuts lines.

## Consequences

The painting stays in memory across modes, so a visitor who takes a picture and
comes back finds their drawing; it is not in the photograph, because the paint
layer is only on the glass in paint mode. It also stays for the next visitor.
That is a whiteboard, which is what a hallway wants, and it is what the bin is
for.

The thresholds were retuned within the first hour. The fixture hand suggested
0.35 to close and 0.55 to open; a real hand painted with the fingers still
visibly apart. Measured at the station, fingertips touching read 0.10 and a
relaxed open hand 0.43-0.49, so the gate now closes below 0.20 and opens above
0.32, with the relaxed-open reading safely on the open side. `closeBelow` and
`openAbove` remain the numbers most worth tuning, and the trace digest reports
the ratio's min, median and max over a take for exactly that.

Eleven chips is what one column and a half of 56 px glass fits on the 1080p
station with the hit margins touching. More colours means a second column or
smaller chips, and smaller than 56 px is smaller than a dwelling hand.

The tray hangs on the right. A right hand reaches it without crossing the body;
a left hand crosses. Making the side follow the hand that is up was considered
and rejected for now: a tray that moves when you switch hands is a tray you
cannot find.

`npm run verify` gained ten paint checks and lost the one that guarded the
locked tile, about twenty seconds in all. They read the painting's pixels off
the canvas, not the stroke count the app wrote, for the reason friction 0019
gives.

### What to ask a person at the station

Tasks are local files, so the set that tunes this mode is written down here.
Each step is one take; read `npm run task -- show latest` for the digest.

1. **Pinch thresholds.** Open hand toward the camera, then slowly close thumb
   and index until the ring fills, hold, open. At 1.5 m; at 3 m; with the hand
   turned sideways. The digest's pinch min and max are where the thresholds
   should sit. Then the things that must not paint: a relaxed point with the
   thumb resting on the index, a waved open hand, a dragged fist. Those steps
   should end with zero strokes and a pinched fraction of 0%.
2. **Draw three things.** A big circle in one stroke; a name; a fast zigzag,
   a dot, a very slow line. The video shows lag and smoothing against the hand;
   the digest counts strokes and points.
3. **Pick tools with one hand.** Dwell a colour; pinch a width; erase; hold the
   bin. Says whether 56 px chips are hittable and whether pinch-to-pick lands
   on the chip that was meant.

Three tasks of three steps is what the debug view's task panel holds on the
1080p station without reaching the floor; four did not fit.

## Alternatives

**The index tip as the brush**, like the cursor everywhere else. Rejected: the
start of every stroke would jump by the distance the index travels to meet the
thumb, 50-80 px on the station.

**A pinch label from the recognizer.** It has none. Training one is a project;
measuring the gap is thirty lines and a test.

**Dwell for painting** (hold still to start a line). Rejected outright: a line
is a gesture, and the thing that starts it has to be continuous with the thing
that draws it.

**A gesture to clear** - Open Palm is already the shutter, and anything held for
a second while a hand wanders is something a hand does by accident in front of
a bin with no undo.

**Undo.** Useful, cheap, not asked for. One more chip in a column that is full.
