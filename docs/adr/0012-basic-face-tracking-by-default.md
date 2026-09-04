# 0012. The face pass is presence-only by default

## Context

`CONFIG.faces.features` chose between two face detectors: `FacesDetector`
(BlazeFace - a box, a confidence and a stable track id) and
`FaceFeaturesDetector` (FaceLandmarker - a 478-point mesh, 52 blendshapes and a
facial transformation matrix). ADR 0007 added the second one and made it the
default.

A performance review measured what that default costs on the station GPU, at
1080p, window focused, with a person and a raised hand in frame:

| Pass | Empty room | One face, one hand |
| --- | --- | --- |
| hands | 13-16 ms | 26-30 ms |
| faces, FaceLandmarker | 3.5 ms | 13-15 ms |
| faces, BlazeFace | 3.5 ms | ~3.5 ms |

At 30 fps a frame is 33.3 ms. Loaded, the hand pass every frame plus the mesh
every second frame came to about 37 ms, and the loop fell to 24 fps with a
visitor in front of it. Disabling the face pass outright measured 24.3 -> 29.5
fps.

Then the more uncomfortable finding: every consumer of `frame.faces` is
`drawOverlay` inside its `if (showDebug)` branch, `hud.render` - which `app.ts`
calls only when `showDebug` - or the debug bridge, which counts them.
`cursor.ts`, `experience.ts` and `menu-physics.ts` read `frame.hands` and
`frame.t` and nothing else. `defaultCameraMode` is `final`. So in the mode a
visitor actually stands in front of, the mesh, the expression and the head pose
were computed every other frame and read by nobody, along with 478 `Vec2`
allocations per face per pass.

## Decision

`CONFIG.faces.features` defaults to `false`. The face pass is BlazeFace:
presence, a box and a track id.

The mesh is not deleted and `FaceFeaturesDetector` is not deprecated. ADR 0007's
reasoning still holds for the moment features are wanted, and flipping one flag
brings it back.

## Consequences

The face pass costs ~3.5 ms instead of 13-15, and `face.features` is `null`, so
the debug overlay draws the box without the mesh and the HUD prints
`no features` in place of smile, mouth-open, brow and yaw. That readout was the
only thing reading the mesh, so nothing else changes.

Anything that wants expression, gaze or head pose - a mirror that notices it is
being looked at, a greeting that waits for a smile - turns `features` back on
and pays the 10 ms again. That is a real product decision now rather than a
default nobody priced.

`docs/hardware.md` carries the measured costs so the next person deciding this
has the numbers instead of an intuition.

## Alternatives

**Keep the mesh and gate it on debug mode.** Rejected as the default because it
makes `PerceptionFrame` mean different things in different modes, which is
exactly what the one-contract rule in `AGENTS.md` exists to prevent. A detector
that runs everywhere and costs little is easier to reason about than one whose
output depends on which key was last pressed.

**Raise `faces.everyNFrames` instead.** Measured 25.7 fps at N=4 against 24.3
at N=2 - real, but a sixth of what switching detectors gives, and it degrades
the very tracking it is trying to afford.

**Drop the face pass entirely.** It is the cheapest option and the wrong one:
presence and a track id are what a mirror needs to know somebody is there, and
at 3.5 ms they are close to free.
