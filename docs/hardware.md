# Station hardware

## Camera: Logitech C922 Pro Stream

Enumerated from V4L2 on 2026-09-04 (`/dev/video0`). These are the real modes,
not the spec sheet.

### The one that matters

**1280x720 @ 60 fps, MJPG.** It is the only 60 fps mode the camera has and is
used by Debug. Final uses the camera's sharpest native 16:9 mode,
**1920x1080 @ 30 fps, MJPG**. A keyboard switch closes the current stream before
opening the other profile; two simultaneous streams would contend for the same
physical device.

`CONFIG.camera.modes` records both deliberate profiles. Changing either has a
quality or frame-rate cost:

| Request | What you get |
| --- | --- |
| MJPG 1280x720 | **60 fps** |
| MJPG 1920x1080 | 30 fps |
| MJPG 1600x896 | 30 fps |
| YUYV 1280x720 | **10 fps** |
| YUYV 1920x1080 | 5 fps |
| YUYV 960x720 | 15 fps |

The YUYV rows are the trap. Uncompressed 720p needs ~1.3 Gbit/s, well past what
USB 2.0 carries, so the driver offers it at 10 fps. If the browser ever
negotiates YUYV the mirror drops to 10 fps with no error. The HUD prints the
negotiated mode (`camera 1280x720@60`) precisely so this is visible.

Verified: Chrome negotiates MJPG 1280x720@60 for the constraints in
`CONFIG.camera`.

### Full enumeration

MJPG: 640x480, 160x90, 160x120, 176x144, 320x180, 320x240, 352x288, 432x240,
640x360, 800x448, 800x600, 864x480, 960x720, 1024x576, 1600x896, 1920x1080 all
at up to 30 fps; **1280x720 at up to 60 fps**.

YUYV: up to 30 fps through 800x448; 24 fps at 800x600 and 864x480; 15 fps at
960x720 and 1024x576; 10 fps at 1280x720; 7.5 at 1600x896; 5 at 1920x1080;
2 fps at 2304x1296 and 2304x1536.

### Device nodes

`/dev/video0` is the capture node (V4L2 index 0). `/dev/video1` is the same
physical camera's second node and is not what you want. Both are readable by
`alejandro` through a filesystem ACL, not through the `video` group.

Reproduce the enumeration with `v4l2-ctl --list-formats-ext -d /dev/video0`
(package `v4l-utils`, not currently installed).

## The camera lies about its frame rate

`track.getSettings().frameRate` reports what was *negotiated*, not what is
arriving, so it read 30 through an entire session in which the camera sent 15.
`describeStream`'s `minFrameRate` guard compares the claim against itself and
cannot catch this. Trust `capturedFps` - measured from skipped
`requestVideoFrameCallback` frames, printed by the HUD and by
`npm run station -- state`. See friction 0013.

**Auto-exposure halves the frame rate.** In ordinary indoor hallway light the
C922 chose a 27.8 ms exposure and dropped to 15 fps to afford it, at both
1080p30 and 720p60. Forcing a short exposure restored 30 fps *and* a brighter
picture (mean luma 175 against 133), because the sensor compensates with gain.

The frame interval is negotiated when the stream opens, so changing exposure on
a live track does nothing. Re-negotiate - `applyConstraints` with a different
size, or reopen the stream - or the change appears to have no effect.

The control that permits this is UVC's `exposure_dynamic_framerate`
(`V4L2_CID_EXPOSURE_AUTO_PRIORITY`). Turning it off keeps auto-exposure - the
hallway still gets darker at night without the picture going black - and takes
away the camera's licence to pay for exposure with frame rate. **There is no
MediaTrack constraint for it**, which is why `start.sh` sets it rather than
`camera.ts`:

```bash
v4l2-ctl -d /dev/video0 -c exposure_dynamic_framerate=0
```

Setting a control needs no root, because `/dev/video0` is reachable through a
filesystem ACL. Installing the tool does, once:

```bash
sudo apt install v4l-utils
```

Read it back with `v4l2-ctl -d /dev/video0 -l`. On this camera:

```
exposure_dynamic_framerate 0x009a0903 (bool) : default=0 value=1
```

The camera's own default is **off** - a value of 1 is something having turned it
on, and is the whole reason the station ran at half rate. Setting it to 0 took
delivery to 30.0 fps at 1080p.

The control does **not** survive a replug or a reboot, so `start.sh` sets it on
every launch instead of once. It is safe to set there: `camera.ts` asks for
`exposureMode: "continuous"`, which looks like it ought to re-enable dynamic
framerate, and verifying showed it does not - the control is still 0 after a
fresh `getUserMedia`. Until `v4l-utils` is installed `start.sh` prints a warning
and carries on; the HUD's `CAMERA SHORT of 30` line catches the consequence
either way.

**The camera is on a USB 2.0 bus.** `lsusb -t` puts the C922 on a 480M root hub
alongside its own audio interfaces, while a 20000M USB 3 bus sits empty. Even
with a short exposure, 1080p tops out near 26 fps and 720p60 never exceeds ~27.
Moving the plug to the USB 3 port is the cheapest available headroom and needs
no code.

## Processing budget

Measured on the station GPU (Intel UHD 770, ADL-S GT1) at 1080p, window
focused, with one person and one raised hand in frame:

| Pass | Empty room | One face, one hand |
| --- | --- | --- |
| hands (gesture recognizer) | 13-16 ms | 26-30 ms |
| faces (FaceLandmarker, mesh + blendshapes) | 3.5 ms | 13-15 ms |

The second stage is what costs: MediaPipe resizes internally, so *input
resolution barely matters* - 1080p and 640x360 both cost ~16 ms with no hand in
frame. What doubles the hand pass is a hand actually being there, because the
landmark and gesture models then run per hand.

At 30 fps the budget is 33.3 ms. Loaded, `hands` every frame plus `faces` every
second frame comes to ~37 ms, which is why the loop falls to 24 fps with a
visitor in front of it. Disabling the face pass measured 24.3 -> 29.5 fps.

The interface is not the constraint. With detector work removed the full glass
UI, `backdrop-filter` and SVG rim filter included, renders at a flat 60 Hz.

Headless screenshots report 3-6 fps processed. That is Chrome's software
rasterizer, not representative of the station.

## Not yet characterised

Screen resolution, GPU, standing distance and lighting. Every threshold in
`CONFIG` marked "verify at the station" is waiting on these.
