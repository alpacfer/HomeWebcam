/**
 * Every tunable in one place. Nothing else in the codebase should hardcode a
 * threshold, a timeout or a resolution.
 *
 * Values marked "verify at the station" are reasonable defaults that were not
 * measured against the real camera, screen and standing distance.
 */
export const CONFIG = {
  camera: {
    /**
     * 1280x720 @ 60 is not an arbitrary pick. On the station's C922 it is the
     * ONLY mode that offers 60 fps, and only over MJPG. Enumerated from V4L2:
     *
     *   MJPG 1280x720 -> 60, 30, 24, 20, 15, 10 fps
     *   MJPG 1920x1080 -> 30 max
     *   YUYV 1280x720 -> 10 max   (uncompressed cannot carry 720p faster)
     *
     * So asking for 1080p, or letting the browser fall back to YUYV, costs
     * half the frame rate or more. See docs/hardware.md before changing these.
     */
    width: 1280,
    height: 720,
    frameRate: 60,
    /** Pin a specific camera by deviceId once the station hardware is fixed. */
    deviceId: null as string | null,
  },

  hands: {
    enabled: true,
    maxHands: 2,
    minDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5,
    /** Flip if left/right read backwards at the station. See detectors/hands.ts. */
    swapHandedness: false,
  },

  faces: {
    enabled: true,
    minDetectionConfidence: 0.5,
    /** No-op until an IdentityDetector is implemented. See detectors/identity.ts. */
    identifyPeople: false,
  },

  cursor: {
    /** Lower = smoother and laggier. Verify at the station. */
    smoothingHz: 3,
    /** ms of holding still over a target before it activates. */
    dwellMs: 800,
    /** Normalized movement that cancels a dwell. Verify at the station. */
    dwellToleranceNorm: 0.035,
  },

  ui: {
    /** Landmark skeletons, boxes and the HUD. Toggle at runtime with "d". */
    debugOverlay: true,
    mirrored: true,
  },
} as const;
