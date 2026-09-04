# 0008: Debug and final camera modes

## Decision

The station has two exclusive keyboard-selected modes:

- `D` selects Debug: the unstyled 1280x720 at 60 fps camera image, perception
  drawings and the performance HUD.
- `F` selects Final: 1920x1080 at 30 fps, automatic continuous camera controls
  where the driver exposes them, a restrained display correction, and only the
  visitor-facing UI.

Final is the startup mode. Both modes keep perception and interaction running.
A switch serially closes the active stream and opens the selected profile.

## Why

The C922 cannot maximize spatial and temporal detail simultaneously. Its only
60 fps HD format is 1280x720, while its sharpest 16:9 image is 1920x1080 at 30
fps. Debugging hand motion benefits from temporal detail; a visitor looking at
the finished mirror benefits from spatial detail and a clean presentation.

A second stream is not a safe separation between display and perception. Both
would address the same USB camera, which is exclusive on the station and may
either reject the second open or force both consumers onto one negotiated
format. Chrome can reconfigure this C922 from Final down to Debug in place, but
live testing found that it does not reliably reconfigure back up to Final. A
serial reopen negotiates both directions correctly.

## Consequences

Switching mode briefly interrupts the picture while the camera reopens. The app
invalidates the old frame callback before starting a new one; MediaPipe keeps
its monotonic timestamp sequence. If the requested profile fails, the previous
one is reopened. Unknown cameras fall back from exact station constraints to
preferred values so the mirror keeps working when a profile is unavailable.
