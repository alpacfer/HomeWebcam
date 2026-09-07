# Roadmap

Where the project is going, in the order the pieces unblock each other. The end
goal is a hallway station that visitors operate with their hands, face and body:
it shows information, takes pictures, and recognises the people who live here.

## Done

- Mirror: the camera feed as the full-bleed UI background.
- Hands: 21 landmarks per hand plus the eight MediaPipe gestures.
- Faces: detection with a stable track id per person.
- Hand cursor: index fingertip, frame-rate-independent smoothing,
  dwell-to-activate.
- Debug overlay and HUD, toggled with `d`.
- Screenshot harness, so UI changes can be verified without a person present.
- Debug bridge and puppet: one typed snapshot of the running station, scripted
  hands, and `npm run verify` for the whole interaction set in about half a
  minute. See [ADR 0011](adr/0011-puppet-perception.md).
- Top mode menu with mirrored-coordinate dwell targets.
- Picture mode: Victory shortcut, Open Palm countdown, and local JPEG capture.
- Wordless glass interface: icon-only modes, a hand-carried reveal light, and a
  spring-mounted menu that a passing hand can brush. See
  [ADR 0010](adr/0010-reactive-glass-menu.md).
- Paint mode: pinch to draw, a tray of colours, widths, an eraser and a bin,
  all driven by one hand. See [ADR 0017](adr/0017-pinch-to-paint.md).

- Paint's pinch, tuned against real hands over four takes: where contact
  actually reads, why the release is slow on purpose, and why the ink it draws
  while deciding is taken back. See
  [ADR 0018](adr/0018-paint-releases-on-contact.md).

- The pinch's limit measured: pixels, not the gate. Every smarter gate, the
  metric gap off the world landmarks and a learned head were replayed over eight
  takes and none beat what ships. The view and the camera profile were split so
  a take can at last be recorded on the 1080p a visitor gets. See
  [ADR 0021](adr/0021-the-pinch-is-limited-by-pixels.md).

- A line is held on the nearest of three finger pairs, not the two tips, which
  heals every held-pinch break in the corpus without starting a line anywhere
  new; Paint mode runs no face pass; and the tracker's real ceiling was found:
  it wants every camera frame, and the 720p/60 debug profile fed it 34 of 60.
  See [ADR 0022](adr/0022-a-line-is-held-on-more-than-two-landmarks.md).

- Ink waits for contact. Fingertips parted a centimetre read between the gate's
  two marks for seconds, and the line ran on until the hand opened wide. Now
  the ink stops the frame the nearest-pair reading leaves contact, held back
  rather than drawn and trimmed, and the band between the marks has a clock.
  The brush ring drops to the grip the same frame. See
  [ADR 0023](adr/0023-ink-waits-for-contact.md).

- Distance changes which reading starts a line. Contact reads the same ratio
  at every hand size, so no mark moves; what grows with distance is tip noise,
  and a hand under 0.09 of the frame starts on the nearest-pair reading
  instead: 7 of 8 lines at two metres, from 4. The idle take at two metres that
  would test the false side is still to be recorded. See
  [ADR 0024](adr/0024-a-far-hand-starts-on-the-joints.md).

## Next: the distance take on the visitor's camera, then the tray

Every pinch take so far was 720p at a frame rate the loop could not keep up
with, which halved the tracker's accuracy on them. One task asks for the
two-metre lines again on the 1080p profile (`R` from the debug view, or
`station camera final`), where every frame is processed; its digest, and
`scripts/pinch-rulers.mjs` over it, decide whether the visitor's camera has
the problem at all and whether the corpus needs a 1080p half. The first tuning
candidate after that is `closeBelow` 0.24, on the corpus test. The lighter
legacy landmark model would lift the debug profile too if it lets the loop
process all 60 frames: its pinch is the full model's equal offline, but its
weaker `Closed_Fist` label starts one line nobody meant, so it needs a
geometric fist rule first, then a cost measurement with a hand in frame.

Still untested by a real hand: whether 56 px tray chips are hittable, whether
pinch-to-pick lands on the chip that was meant, and whether the bin's longer
ring reads as deliberate.

Then: an idle timer that wipes a painting nobody has touched for a while, and
undo, if a column of eleven chips can take a twelfth.

## Then: recognise us

The hardest part, and the one with real privacy weight. See
[ADR 0003](adr/0003-face-recognition-deferred.md) for the candidate models.

- Pick an embedding model and write the ADR that records why.
- Enrolment: a deliberate, consented flow. Never silent capture.
- Template storage, local only, with a way to see and delete what is stored.
- Implement `IdentityDetector`. `FaceObservation.identity` is already plumbed
  through to the UI, so this is the only new surface.

## Later

- Pose: reach and lean as input. The model is already downloaded.
- Multi-person: whose hand is whose. Needs pose to associate hands with bodies.
- Kiosk deployment: autostart, full screen, screen blanking, recovery from a
  camera unplug.
- Idle and attract states. A dark hallway should not run detectors at 60 fps.
