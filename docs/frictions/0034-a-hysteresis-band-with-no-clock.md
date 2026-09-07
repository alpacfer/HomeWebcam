# 0034. A hysteresis band with no clock held a parted pinch for seconds

- Date: 2026-09-07
- Status: integrated
- Area: perception

## What happened

The person at the station recorded a take named "pinch problem" and described
it: separating the fingers slightly should stop the drawing, but the line kept
going until they separated them more; it should only draw while the two fingers
are in contact. The trace confirms it. In three of four pinches the fingertips
touched at a ratio of 0.10-0.16 for one to two seconds, then parted to a steady
0.22-0.29 for 1.6 to 5.5 seconds while the hand kept moving, and the gate held
the line the whole time. The video at those moments shows a visible gap between
the tips. 11.5 s of a 27 s take was ink laid with the fingers apart.

The same complaint had been filed twice before, on the "where is your pinch"
takes ("I need to separate the fingers too much to actually stop painting"),
and answered by ADR 0018 with a release trim.

## Impact

The headline interaction of Paint mode was unusable as a drawing tool for this
person: every line grew a tail as long as they held a natural loose pinch, and
the only way to end one was to open the hand wide. Three rounds of the same
complaint.

## Root cause

The gate closes under 0.18 and opens above 0.32, and the band between them was
hysteresis with no clock. ADR 0018 widened it so that landmark glitches during a
held pinch - excursions of up to nine frames - could not cut a line, and ADR
0019 proved that any lower open mark breaks the twenty-second pinch. Both
assumed a reading in the band was passing through. Fingertips parted by a
centimetre read 0.22-0.29 and stay there, and on this scalar that is the same
level as a held pinch's glitches; only the duration differs, and nothing
measured duration.

The release trim of ADR 0018 could not reach the case because the gate never
released. And the corpus had no take in which a person held a slight parting
for long: three shapes, ten vertical lines, one held pinch, one idle hand. The
digest reported `pinched 68%` on this take and had no way to say that 72% of
that was with the fingers apart.

## Correction

Ink now flows only while the fingers are together: `PinchState.touching` is
read every frame off the nearest-pair reading, and `PaintSession` holds back
every point laid while a line is open and the fingers are apart, laying them
down only if contact returns and dropping them when the gate gives up. Nothing
past a parting reaches the glass, so the trim and its redraw are gone. The band
between the marks has a clock: `CONFIG.paint.pinch.looseMs` is 400 ms, the
shortest limit that cuts no line in the corpus. The brush ring empties the same
frame the ink stops. See [ADR 0023](../adr/0023-ink-waits-for-contact.md).

## Workflow integration

The take is in the corpus as `tests/fixtures/pinch-takes/parted-slightly.json`,
and `tests/pinch-takes.test.ts` asserts that every line in it ends within the
loose limit of the last frame the fingers were together, that without the limit
one ran on for over two seconds, and that the limit changes no other take's
count. The digest reports `loose`, the fraction of pinched frames with the
fingers apart, and prints it beside `pinched`. `npm run verify` gained the
`part` scenario and `a-parted-pinch-ends-the-line`, which requires the line to
end while the hand is still parted. The AGENTS.md gotchas say that `closed` and
`touching` are two questions and that lowering `openAbove` is still the trap.

Two things about the tooling are worth keeping. A recording can be watched
without ffmpeg: the dev server serves `recordings/*.webm` under `/@fs/`, the
in-app browser plays it, and a CSS transform on the video element stands in for
a crop; that is how the parted frames were confirmed. And the distiller's
one-frame-per-line output does not pass the formatter, so `npm run fix` reflows
a new fixture before `npm run check` accepts it.

## Proof

`npm run check` - 244 tests, including fifteen in `tests/pinch-takes.test.ts`
over five takes. `npm run verify` - 34/34, with `a-parted-pinch-ends-the-line`
reporting "ended while still parted · line alpha 255 · past the parting 0 ·
where the hand stopped 0". Replayed over the recording, the shipped gate held
11.5 s of ink with the fingers apart and released 2.6 s late at the median; with
the limit, 5 lines and a formal end within 440 ms. What none of this licenses
is the claim that it feels right to a person; a task at the station asks.
