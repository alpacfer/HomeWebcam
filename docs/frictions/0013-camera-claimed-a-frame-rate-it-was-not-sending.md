# 0013. The camera claimed a frame rate it was not sending

- Date: 2026-09-04
- Status: integrated
- Area: runtime

## What happened

The station was running at 15 fps. Every readout agreed the camera was fine:
`state` printed `1920x1080@30`, the HUD printed `camera 1920x1080@30`, and
`describeStream` did not add its `(below target)` note. The window turned out to
be focused, so the throttle of friction 0011 was ruled out, and the detectors
were using 16 ms of a 66 ms frame - a quarter of the budget.

The camera was sending 15 fps and reporting 30. Two independent measurements
agreed: `requestVideoFrameCallback` presented frames every 66.7 ms with a
spread of 0.2 ms and one dropped frame in 4284, and a `MediaStreamTrackProcessor`
reading the track directly, with no compositor in the path, counted 14.99 frames
a second.

The cause was upstream of the code. `exposureTime` was 278 (27.8 ms) under
`continuous` exposure, and the C922 halves its frame interval to afford a long
exposure. Forcing a short manual exposure and re-negotiating the format
restored 30 fps at 1080p - and a *brighter* picture, mean luma 175 against the
133 it had at the long exposure, because the sensor compensates with gain.

## Impact

Half the station's frame rate was missing for an unknown length of time, and
nothing on screen or on the command line could have revealed it. The
performance review it was found during nearly concluded that the interface had
three quarters of its budget free, which was true of a 15 fps loop and false of
the 30 fps loop the same hardware delivers.

An early hypothesis was also wrongly discarded: forcing a short exposure
mid-stream changed nothing, because the USB frame interval is negotiated when
the stream opens. Exposure looked exonerated for most of the session.

## Root cause

`describeStream` reads `track.getSettings().frameRate`, which is the rate that
was negotiated, not the rate arriving. Its `minFrameRate` guard therefore
compares the claim against itself and can never fire. `docs/hardware.md` said
the HUD prints the negotiated mode "precisely so this is visible", which is the
one thing a negotiated figure cannot make visible.

## Correction

`SkippedFrames` in `src/lib/fps.ts` counts `presentedFrames` gaps from
`requestVideoFrameCallback`, so the loop knows how many camera frames it never
saw. Delivered rate is processed rate times that gap, which separates "the
camera sends 15" from "the camera sends 30 and we keep half" - the two have
opposite fixes. Both numbers are in the HUD, in the debug snapshot as
`camera.capturedFps`, and in `station state`, which names a shortfall rather
than leaving two numbers to compare.

## Workflow integration

`docs/hardware.md` records the exposure trap, that the camera lies about its
frame rate, and that the C922 sits on a USB 2.0 bus while a free USB 3 bus is
available. Its processing-budget section now carries measured detector costs
instead of the claim that the detectors are the constraint.

## Proof

`npm run station -- state` prints
`⚠ camera delivering 24.0 fps of the 30 it claims (loop processes 22.5)`.
`tests/fps.test.ts` asserts that 15 processed fps resolves to 15 delivered when
no frames are skipped and 30 when every other frame is.

## Addendum, 2026-09-04: root cause confirmed at the driver

`v4l-utils` was installed and the control read back directly:

```
exposure_dynamic_framerate 0x009a0903 (bool) : default=0 value=1
```

The camera's own default is **off**. Something had turned it on, which is why
the station was halving its frame rate at all. Setting it to 0 took the camera
straight to 30.0 fps delivered at 1080p.

Two things were checked before trusting `start.sh`'s placement, because both
would have made it useless:

- **Does the app turn it back on?** No. `camera.ts` asks for
  `exposureMode: "continuous"`, which was the obvious suspect, but after a full
  page reload and a fresh `getUserMedia` the control was still 0. Setting it
  before Chrome launches is therefore enough.
- **Does the setting survive?** Not across a replug or a reboot, which is why
  `start.sh` sets it on every launch rather than once.

`power_line_frequency` is 1 (50 Hz), correct for this country, and was left
alone.
