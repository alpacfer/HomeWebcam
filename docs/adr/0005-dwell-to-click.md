# 0005. Dwell to activate, not pinch or fist

## Context

A hand cursor needs a way to commit. The candidates: hold still over a target
(dwell), pinch thumb to finger, close the fist, or push toward the screen.

The user here is a visitor in a hallway who has never seen the station and will
get no instructions.

## Decision

Dwell. Hold the cursor within `CONFIG.cursor.dwellToleranceNorm` for
`CONFIG.cursor.dwellMs` and the target activates, with a ring that fills to show
progress.

Gestures stay available as shortcuts, not as the click.

## Consequences

Discoverable without instructions: point at something, hold, watch the ring
fill, understand the rule. The ring teaches the interaction while performing it.

The cost is speed. Every activation takes 800 ms, so dwell is wrong for anything
a person would do repeatedly. If the interface grows a keyboard or a list to
scrub, that needs its own mechanism.

Dwell also means the cursor must never be allowed to rest on a target by
accident. Targets need spacing and dead zones.

## Alternatives

**Pinch** - fast and precise, and the standard in headset UIs. Needs to be
taught, and MediaPipe's thumb and index tips are the two noisiest landmarks at
kiosk distance.

**Closed fist** - the recognizer already reports it, but it is coarse, and
closing the hand moves the fingertip the cursor is tracking.

**Push toward the screen** - z from `worldLandmarks` is too noisy at three
metres to threshold reliably.
