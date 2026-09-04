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

  interaction: {
    /** Ignore uncertain gesture labels before they can start a shortcut. */
    minGestureConfidence: 0.7,
    /** Deliberate hold time for Victory and Open Palm. Verify at the station. */
    gestureHoldMs: 900,
  },

  /**
   * Spring tokens, copied from Material 3 Expressive's motion-physics scheme
   * (androidx ExpressiveMotionTokens.kt). M3 dropped duration-plus-easing for
   * springs precisely for interfaces that get pushed around instead of played
   * back, which is exactly what a hand-driven menu is.
   *
   * Damping is a ratio: 1 is critically damped, below 1 overshoots. Stiffness
   * is the unit-mass constant, so the natural frequency is sqrt(stiffness)
   * rad/s and a spring settles in roughly 4 / (damping * sqrt(stiffness)) s.
   */
  motion: {
    spatialFast: { damping: 0.6, stiffness: 800 },
    spatialDefault: { damping: 0.8, stiffness: 380 },
    spatialSlow: { damping: 0.8, stiffness: 200 },
    effectsDefault: { damping: 1, stiffness: 1600 },
  },

  picture: {
    countdownMs: 3000,
    savedMessageMs: 2600,
  },

  ui: {
    /** Visitors start in the clean, high-detail presentation. D/F switch modes. */
    defaultCameraMode: "final" as const,
    mirrored: true,
    /**
     * The menu is hung in front of the mirror rather than bolted to it. Offsets
     * and radii are in screen heights, so 0.03 is about 32 px on the 1080p
     * station. All of these need a hand in front of the real camera to judge:
     * verify at the station.
     */
    menu: {
      /** The heavy thing the tiles hang in. M3's slow spatial token: it sways. */
      dock: { spring: { damping: 0.75, stiffness: 190 }, maxOffset: 0.018 },
      /**
       * Tiles are lighter and looser: M3's default spatial stiffness paired
       * with the fast token's damping ratio, the bounciest pairing the scheme
       * offers, so a tile brushed by a wave wobbles before it settles.
       */
      tile: { spring: { damping: 0.6, stiffness: 340 }, maxOffset: 0.036 },
      /**
       * How a hand moves a panel. `drag` carries it along with the wave, and a
       * brisk wave runs about 2 screen heights a second. `press` is the nudge
       * from a hand simply being there, and it stays small on purpose: a tile
       * that runs away from a pointing finger cannot be dwell-selected.
       */
      brush: { radius: 0.34, drag: 0.022, press: 0.016 },
      /** Hand velocity is far too noisy to drive a spring with unfiltered. */
      velocitySmoothingHz: 6,
      /**
       * The drift of a panel nobody is touching. Small enough that you notice
       * it only by the panel not being dead: 0.004 is about 4 px, over 7 s.
       */
      idle: { amplitude: 0.004, periodMs: 7000 },
      /** Reach of the Fluent-style reveal light the hand carries over the glass. */
      revealRadius: 0.24,
      /** Degrees of tilt at full travel. Enough to catch the light, not to skew. */
      tiltDeg: 7,
    },

    /**
     * Rim refraction for the glass, in px. Strength is how far the backdrop is
     * bent at the very edge, band is how deep into the panel that bending
     * reaches, aberration is the prismatic spread across R/G/B and costs two
     * extra passes. Chromium only; see src/ui/glass.ts.
     */
    glass: {
      refraction: true,
      band: 26,
      strength: 6.5,
      aberration: 0.4,
    },

    /**
     * The HUD rewrites its text node, which invalidates layout. Doing that 60
     * times a second to display a number that a human reads a few times a
     * second is pure overhead, so it is throttled.
     */
    hudHz: 10,
  },
} as const;
