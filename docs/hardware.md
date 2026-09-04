# Station hardware

## Camera: Logitech C922 Pro Stream

Enumerated from V4L2 on 2026-09-04 (`/dev/video0`). These are the real modes,
not the spec sheet.

### The one that matters

**1280x720 @ 60 fps, MJPG.** It is the only 60 fps mode the camera has.

`CONFIG.camera` is set to exactly this. Changing it costs frame rate:

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

## Processing budget

The 60 fps camera is not the constraint; the detectors are. Two MediaPipe
graphs (gesture recognizer + face detector) run per frame on the WebGL
delegate. Measure with the HUD's "fps processed" figure on the real station GPU
before deciding whether to drop a detector, decimate it to every Nth frame, or
lower the capture rate.

Headless screenshots report 3-6 fps processed. That is Chrome's software
rasterizer, not representative of the station.

## Not yet characterised

Screen resolution, GPU, standing distance and lighting. Every threshold in
`CONFIG` marked "verify at the station" is waiting on these.
