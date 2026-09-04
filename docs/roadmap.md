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

## Next: something to navigate

The cursor points at nothing. This is the blocking gap.

- A `Target` concept: a rectangle plus a callback, in mirrored screen space.
- Hit-testing the cursor against targets; dwell activates the one under it.
- One real panel to prove it end to end. A clock and the weather is enough.
- Hover and activation feedback that reads from three metres away.

## Then: take a picture

The first feature with an outcome the visitor keeps.

- A gesture or a dwell target starts a countdown.
- Full-resolution grab from the video element, not the display canvas.
- Where does it go, and who can see it? Decide before building. Writes land in
  `captures/`, which is gitignored.

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
