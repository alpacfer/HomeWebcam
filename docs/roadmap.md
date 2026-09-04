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

## Next: game mode

The second top-level mode is visible but deliberately unavailable until there is a real game behind
it. Add its interaction without changing the Picture-mode gesture shortcuts. It needs a gesture
badge of its own, and the interface is wordless, so the gesture has to be one an icon can say.

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
