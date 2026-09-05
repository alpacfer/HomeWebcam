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
    maxHands: 1,
    minDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5,
    /** Flip if left/right read backwards at the station. See detectors/hands.ts. */
    swapHandedness: false,
  },

  faces: {
    enabled: true,
    /**
     * Run the face pass every Nth camera frame. 2 halves its cost and still
     * updates at 15 Hz on the station's 30 fps camera, far more than a head
     * moving at hallway speed needs. The skipped frames reuse the previous
     * result, so a face never blinks out. Raise it if the HUD shows the face
     * pass eating the budget.
     */
    everyNFrames: 2,
    maxFaces: 2,
    minDetectionConfidence: 0.5,
    /**
     * Facial features: the 478-point mesh, expression and head pose.
     *
     * This swaps the plain face detector for FaceLandmarker rather than adding
     * to it. FaceLandmarker finds faces itself, so running both would pay for
     * face detection twice and buy nothing. See ADR 0007.
     *
     * Off, so the face pass is BlazeFace: presence, a box and a track id. The
     * mesh cost 13-15 ms a pass with someone in frame against BlazeFace's 3.5,
     * and nothing outside the debug overlay and HUD read a single point of it.
     * Turn it back on to tune against expression or head pose. See ADR 0012.
     */
    features: false,
    /** No-op until an IdentityDetector is implemented. See detectors/identity.ts. */
    identifyPeople: false,
  },

  cursor: {
    /**
     * The 1€ filter, which trades a fixed cutoff for one that opens up with
     * speed. See src/lib/one-euro.ts and ADR 0013.
     *
     * Tune in the order the paper gives: set beta to 0, hold a hand still, and
     * lower minCutoffHz until the jitter goes; then move a hand fast and raise
     * beta until the lag goes. Symptoms map one-to-one - jitter at rest wants a
     * lower minCutoffHz, lag when moving wants a higher beta.
     */
    filter: {
      /**
       * 3 Hz is not a compromise here, it is a floor: it is exactly what the
       * fixed filter this replaced used, so at a standstill the cursor is no
       * jitterier than the station has always been, and every speed above a
       * standstill is strictly better. Measured hand speeds at the station run
       * 0.06 u/s at the tenth percentile to 1.8 at the ninety-ninth.
       *
       * The paper's suggested 1 Hz starting point was tried and was wrong for
       * this: it put 105 ms of lag on a slow, careful aim - twice the filter it
       * replaced - because a hand lining up a menu tile spends most of its time
       * below 0.3 u/s. See ADR 0013.
       */
      minCutoffHz: 3,
      /**
       * Chosen against the measured distribution rather than by feel: 30 puts
       * the median aim (0.3 u/s) at 13 ms of lag and a brisk wave (1.8) at 3 ms,
       * while a standstill stays at the 3 Hz floor. Verify at the station.
       */
      beta: 30,
      /** The paper's value. It says this one rarely needs changing. */
      derivativeCutoffHz: 1,
      /**
       * Faster than the cutoff's own derivative, because this one steers
       * prediction and has to notice a hand reversing direction. 6 Hz is a
       * 27 ms time constant against the 159 ms of the 1 Hz estimate.
       * Verify at the station.
       */
      predictionCutoffHz: 6,
    },

    /**
     * Latency compensation. Measured capture-to-display on the station is 32 ms
     * and the detector adds ~17 ms, so ~50 ms of the hand's past is on screen.
     * Aiming 35 ms ahead recovers most of it without betting the whole amount
     * on the hand continuing in a straight line.
     *
     * Prediction is off below `fadeInFrom` because overshoot at a standstill
     * reads as jitter and would cancel a dwell. Verify at the station.
     */
    prediction: {
      horizonMs: 35,
      /**
       * Below this, in units/second, the hand counts as holding still and gets
       * no prediction at all. 0.15 sits under the tenth percentile of measured
       * aiming speed, so a deliberate slow aim is helped rather than sitting in
       * a dead band, while a hand parked over a tile is left alone.
       */
      fadeInFrom: 0.15,
      fadeInTo: 1.0,
    },

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

  /**
   * The debug recorder: what the models were actually given, kept for a bug
   * report. Available in debug camera mode only. See ADR 0014.
   */
  recording: {
    /**
     * Hard cap on one take. Long enough to hold a gesture that only fails
     * sometimes, short enough that a recorder left running by mistake costs a
     * bounded amount of disk and of encoder time.
     */
    maxMs: 30_000,
    /**
     * Generous for 1280x720 on purpose. Hand landmarks fail on exactly what a
     * low bitrate destroys - motion blur and blocking around fast fingers - so
     * a stingy recording would misrepresent the input it exists to preserve.
     * 30 s at this rate is about 30 MB.
     */
    videoBitsPerSecond: 8_000_000,
    /**
     * First supported wins. VP8 before VP9 because it is the cheaper encode and
     * this runs beside two MediaPipe passes on the same machine; measure the
     * loop with `npm run station -- watch ".camera.fps"` before changing it.
     */
    mimeTypes: ["video/webm;codecs=vp8", "video/webm;codecs=vp9", "video/webm"],
    /** How often the loop's frame rate is sampled into the manifest, in ms. */
    healthSampleMs: 100,
  },

  /**
   * The ear. Whisper tiny.en on the camera's own microphone, entirely
   * on-device, listening for a stretch of speech and transcribing it.
   * See ADR 0016. Every number here wants verifying at the station.
   */
  voice: {
    enabled: true,
    /** Whisper is trained at 16 kHz; anything else is resampled to it anyway. */
    sampleRate: 16_000,
    /** Under public/models/. Downloaded by npm run models. */
    model: "whisper-tiny.en",
    /**
     * Which microphone. The C922's own is above the screen and pointed at
     * whoever is standing in front of it; the machine's built-in one is pointed
     * at the machine. Matched against the device label, case-insensitively.
     */
    deviceLabel: "c922|webcam",
    /**
     * RMS above which a block counts as speech. The C922's floor in this room
     * measured a median of 0.00 and a peak of 0.10 over eight quiet seconds,
     * so 0.02 sent chair scrapes to the model and got words back. 0.04 sits
     * above the room and below a voice at two metres. Watch `station state`
     * while talking, and verify at the station.
     */
    activationLevel: 0.04,
    /** Quiet for this long ends an utterance. Below ~400 ms it cuts words in half. */
    silenceMs: 600,
    /** Anything shorter than this is a cough, a door, or a chair. */
    minUtteranceMs: 250,
    /** A hard stop, so one long noise cannot grow an unbounded buffer. */
    maxUtteranceMs: 12_000,
    /** Silence kept in front of a word, so its first consonant survives. */
    leadMs: 300,
    /**
     * The whole vocabulary. Whole words, lower case, matched against a
     * transcript with its punctuation stripped.
     *
     * One command on purpose. Every word added here is a word somebody can say
     * by accident while describing a bug, and the model will hear it. See
     * src/interaction/voice-commands.ts.
     */
    commands: {
      stop: ["stop"],
    },
    /**
     * What Whisper says when it is given sound with no speech in it.
     *
     * It is a transcription model, not a detector: handed a door closing it
     * answers with the most likely sentence, and on this material that is
     * almost always one of these. They are dropped only when they are the
     * *entire* utterance, so "thank you" said in the middle of a sentence
     * survives. Add to it from what `station state` shows in a quiet room.
     */
    hallucinations: [
      "you",
      "thank you",
      "thanks for watching",
      "bye",
      "so",
      "oh",
      "yeah",
      "mm-hmm",
      "hmm",
    ],
  },

  /**
   * Tasks the person at the station is asked to perform in front of the camera.
   * Written from a keyboard, answered with a recording. See ADR 0015.
   */
  tasks: {
    /**
     * How often the debug view asks the server for the list. A task is written
     * minutes before anyone walks up to the station, so this only has to be
     * faster than a person crossing a hallway. Debug mode only: a mirror
     * showing the visitor interface asks for nothing.
     */
    pollMs: 3000,
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
