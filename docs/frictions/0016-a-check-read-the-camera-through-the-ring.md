# 0016. A check read the camera picture through the middle of the ring

- Date: 2026-09-04
- Status: integrated
- Area: tooling

## What happened

`npm run verify` failed on `the-ring-fills-clockwise`, reporting
`filled 345 -> 185 degrees clockwise from 12 o'clock (56%)`. The check requires
the arc to start within 12 degrees of twelve o'clock, and 345 is 15 degrees
early.

The ring was correct. The screenshot the check itself saved shows the accent
starting at twelve o'clock and sweeping clockwise to the lower left, exactly as
intended. What had changed was the scene: someone was sitting close to the
camera wearing glasses, where previous runs had looked at a hallway wall.

## Impact

A false failure on a check whose entire job is to catch one specific, expensive
bug. A guard that cries wolf against the furniture is a guard that gets ignored,
and this one had just been used to sign off a change - the failure was initially
read as a possible regression from that change.

## Root cause

`sampleRing` buckets **every** pixel in the crop by its angle from the centre,
with no radius filter. The crop is the ring's own bounding box, so most of it is
the live camera picture seen through the middle of the ring.

The accent test is a hue test - green and blue both above red - which correctly
ignores a wall or a face, and correctly accepts a pale bluish highlight off a
pair of glasses. With `hit` set at more than two pixels, three such pixels at one
angle invent an arc.

This is friction 0004's guard inheriting friction 0004's real difficulty: the
ring is translucent and drawn over whatever is in the room.

## Correction

`sampleRing` now counts only pixels in the outer 25% of the distance from the
centre to the edge of the crop, measured along each ray rather than as a fixed
radius, because the dial is a rounded square whose corners sit much further out
than its edge midpoints. Everything inside - the countdown digit, the face, the
room - is excluded by geometry rather than by colour.

## Workflow integration

The guard was re-tested against the bug it exists for, not just against a
passing case. With the ring mirrored (`transform: scaleX(-1)`, filling
anticlockwise) `station probe .countdown__ring --ring` reports
`filled 100 -> 0 degrees`, which fails the check's `startDeg <= 12` condition.
A tightened measurement that no longer catches its bug is worse than a flaky
one, so that check is now part of changing this sampler.

## Proof

Three consecutive runs against the same close-up scene that failed:
`filled 0 -> 180`, `filled 0 -> 180`, `filled 0 -> 185`. Mirrored, it fails.
Note that `npm run verify` reloads the page before each check, so a CSS override
must be applied through `station probe` rather than through `verify` to test
this at all - which is why the first attempt at the mirrored test wrongly
reported `ok`.
