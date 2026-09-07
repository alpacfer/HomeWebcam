# 0032. Every take was recorded on the camera profile visitors never see

- Date: 2026-09-07
- Status: integrated
- Area: tooling

## What happened

Reviewing the paint takes for why lines fail at two metres, the pooled numbers
said the thumb-to-index gap at contact was 3 px when the hand was under 70 px
tall in the frame, against a landmark jitter of 2-3 px. Every one of the twelve
takes carried `"source": "1280x720@60"`. The visitor's profile is 1920x1080@30
(`CONFIG.camera.modes.final`), and no take had ever been made on it.

## Impact

Every number in `CONFIG.paint.pinch`, the whole committed corpus in
`tests/fixtures/pinch-takes/`, and ADRs 0018 to 0020 were tuned on a camera
profile with two thirds of the linear resolution a visitor gets. The failure
being chased - a pinch that does not register at distance - is a pixel failure,
and it was being measured on the profile with the fewest pixels. Whether the
visitor's profile has the same problem was unknown, and unknowable with the
tools as they were.

## Root cause

`App` had one variable, `mode`, meaning both the camera profile and what was on
the glass. `D` set both to debug (720p/60 and the instruments), `F` both to final
(1080p/30 and the bare mirror). The recorder and the task panel are instruments,
so `presentMode()` showed them only in debug, and debug was the 720p profile.
ADR 0014 documented the recorder as "debug camera mode only" and the coupling
was never questioned, because the two words were one word.

## Correction

The view and the camera profile are two settings (`StationView` and
`CameraMode` in `src/camera/camera.ts`). `D` and `F` still set both; `R` swaps
the camera profile on its own, and the bridge exposes `camera.use(mode)` and
`view.set(view)`, which `npm run station -- camera final` and `view` drive. The
stylesheet is keyed on `data-view`; nothing reads `data-camera-mode` but the
CLI. The manifest, the snapshot and the corpus carry both the profile and the
view, so a take says which camera it was made on. `station record` switches the
view rather than pressing D, so it no longer drops the camera to 720p to record.

## Workflow integration

`npm run verify` gained a check that switches the camera profile from the debug
view, records a take, and requires its manifest to say `mode: "final", view:
"debug"` with a 1920x1080 source. A task asks the person at the station to
repeat the distance take on the visitor's profile; that recording is the first
one that can say whether the visitor's camera has the problem at all.

## Proof

`npm run check` (236 tests). `npm run verify`, 33/33, whose new check reported
`camera final 1920x1080@30 under the debug view · recorder display flex ·
manifest final/debug 1920x1080@30, video 1920x1080`. `npm run station -- state`
now opens with `final view · camera final 1920x1080@30`.
