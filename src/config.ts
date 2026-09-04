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
    modes: {
      /** The detector-tuning view: maximum motion fidelity on the station camera. */
      debug: {
        width: 1280,
        height: 720,
        frameRate: 60,
        /** 50 admits a camera reporting 59.94 while rejecting the 30 fps mode. */
        minFrameRate: 50,
      },
      /** The visitor view: maximum native 16:9 detail on the station camera. */
      final: {
        width: 1920,
        height: 1080,
        frameRate: 30,
        /** Allows common 29.97 fps reporting without accepting a low-rate fallback. */
        minFrameRate: 25,
      },
    },
    /** Pin a specific camera by deviceId once the station hardware is fixed. */
    deviceId: null as string | null,
  },

  hands: {
    enabled: true,
    /**
     * Run the hand pass every Nth camera frame. 1 = every frame.
     * The cursor is driven by fingertips, so hands stay at full rate: at 60 fps
     * a decimated hand is a cursor that visibly steps. See ADR 0006.
     */
    everyNFrames: 1,
    maxHands: 2,
    minDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5,
    /** Flip if left/right read backwards at the station. See detectors/hands.ts. */
    swapHandedness: false,
  },

  faces: {
    enabled: true,
    /**
     * Run the face pass every Nth camera frame. 2 halves its cost and still
     * updates at 30 Hz, which is far more than a head moving at hallway speed
     * needs. The skipped frames reuse the previous result, so a face never
     * blinks out. Raise it if the HUD shows the face pass eating the budget.
     * Verify at the station.
     */
    everyNFrames: 2,
    maxFaces: 2,
    minDetectionConfidence: 0.5,
    /**
     * Facial features: the 478-point mesh, expression and head pose.
     *
     * This swaps the plain face detector for FaceLandmarker rather than adding
     * to it. FaceLandmarker finds faces itself, so running both would pay for
     * face detection twice and buy nothing. Turn it off for the cheap
     * presence-only path on a weaker GPU. See ADR 0007.
     */
    features: true,
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
    /** Visitors start in the clean, high-detail presentation. D/F switch modes. */
    defaultCameraMode: "final" as const,
    mirrored: true,
    /**
     * The HUD rewrites its text node, which invalidates layout. Doing that 60
     * times a second to display a number that a human reads a few times a
     * second is pure overhead, so it is throttled.
     */
    hudHz: 10,
  },
} as const;
