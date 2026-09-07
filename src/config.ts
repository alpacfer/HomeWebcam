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
    /**
     * Where the hand models run. "GPU" is WebGL on the station's Intel
     * integrated graphics; "CPU" is XNNPACK over WASM. Measured at the station
     * on 2026-09-07, window focused, no hand in frame, 1080p profile: GPU
     * 15.3-18.2 ms a pass, CPU 29.4-29.5 ms. The CPU path computes slightly
     * better numbers - the GPU runs at half precision, and on identical frames
     * its landmarks jittered 10-15% more - but the pinch wants every camera
     * frame far more than it wants that (see ADR 0022), and the CPU cannot
     * deliver even half of them. GPU, until the hardware changes.
     */
    delegate: "GPU" as "GPU" | "CPU",
    /** Flip if left/right read backwards at the station. See detectors/hands.ts. */
    swapHandedness: false,
  },

  faces: {
    enabled: true,
    /**
     * Not while painting. Nothing in Paint mode reads a face, the pinch is the
     * hardest thing this station measures, and the face pass cost 4-7 ms on
     * every other frame beside it. Faces come back the moment the mode is
     * left; the tracker's ids start over then. See ADR 0022.
     */
    offWhilePainting: true,
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
   * Paint mode: pinch thumb and index to draw on the mirror. Everything is
   * driven by one hand; the pointer is the midpoint of the two fingertips,
   * because it is the one point that does not jump when the fingers meet.
   * See docs/adr/0017-pinch-to-paint.md. Every number here wants a hand in
   * front of the real camera: verify at the station.
   */
  paint: {
    pinch: {
      /**
       * Thumb tip to index tip, as a fraction of the hand's own size (the
       * larger of palm length and palm width), so the same pinch reads the same
       * at one metre and at three. Below this the fingers count as pinched.
       *
       * 0.18, and the earlier 0.12 was the single worst number in this file:
       * it sat *below* where a real hand's contact reads, so lines would not
       * start. Replaying the takes in tests/fixtures/pinch-takes, the person
       * holding one pinch waited 826 ms for their line to begin and the worst
       * of the three shapes 369 ms; at 0.18 those are 234 ms and 212 ms, which
       * is the 180 ms confirmation plus a frame or two. Their fingers routinely
       * sat at 0.13-0.16 while plainly touching, which 0.12 called open.
       *
       * The mark can move up this far because the level was never what
       * separated a deliberate pinch from an accident - the duration was. In
       * the take where nothing was meant to be drawn, the ratio never stayed
       * under 0.18 for longer than 98 ms; in the takes that meant it, every
       * line held for hundreds. So closeMs does the discriminating and this
       * only has to be above a real contact. See ADR 0019.
       */
      closeBelow: 0.18,
      /**
       * Above this the fingers count as open again. The gap between the two is
       * hysteresis: a pinch hovering on one threshold would otherwise flicker
       * and chop a line into dots.
       *
       * Deliberately far above closeBelow, and lowering it would be a mistake.
       * A thirty-second take of one deliberately unbroken pinch put the ratio
       * above 0.24 in runs of up to nine frames while the fingers never parted,
       * so a mark down there would have cut that line repeatedly. The
       * stickiness this number seems to cause is dealt with elsewhere: ink
       * stops the frame the fingers leave contact, and the band below this
       * mark has a clock, `looseMs`, so a pinch cannot live in it.
       * See docs/adr/0018-paint-releases-on-contact.md and ADR 0023.
       */
      openAbove: 0.32,
      /**
       * How long a change has to hold before it counts, in each direction.
       *
       * Asymmetric, because the two mistakes are not the same size. A line
       * that starts by itself has to be erased, so closing is checked for long
       * enough to outlast every accidental dip in the take where nothing was
       * meant to be drawn: the longest of those ran 98 ms, so 180 ms clears it
       * by 82 ms and still starts a deliberate line inside a fifth of a second.
       * This is the threshold's other half - see closeBelow, which can only
       * afford to sit above a real contact because this number is doing the
       * discriminating.
       *
       * Opening is checked for far longer, because the thumb and index tips are
       * the noisiest landmarks the model has and they glitch while the fingers
       * are still shut. In one continuous pinch the ratio jumped from 0.09 to
       * 0.80 for two frames at full tracking confidence, and elsewhere drifted
       * over 0.32 for two more as confidence fell to 0.52; each of those broke
       * the line. 150 ms rides out every glitch in that take and leaves the two
       * genuine releases, which ran 13 and 25 frames.
       *
       * A slow release would normally read as a line that will not stop. It
       * does not here, because the ink it lays down is taken back again.
       */
      closeMs: 180,
      openMs: 150,
      /**
       * The fast way in. A pinch this tight is not something a hand does by
       * accident, so it does not have to wait for the full `closeMs`.
       *
       * The two takes where nothing was meant to be drawn dip under 0.12
       * thirteen times between them and never stay there for 50 ms; a
       * deliberate pinch arrives there within a frame or two of crossing 0.18.
       * Replayed over the corpus, 0.12 draws no false line at any confirmation
       * from 40 ms up, so 80 ms - three frames at the station's rate - is
       * double the shortest value that passes rather than a value on an edge.
       * 0.14 is on that edge: at 40 ms it invents a line.
       *
       * What it buys is the vertical-lines take, where a whole line went
       * missing. The person pinched, drew the full height of the screen and
       * got nothing, because the ratio spiked over 0.18 for one frame every
       * 100 ms or so and each spike restarted the 180 ms clock from zero. The
       * deep path never restarted: they were under 0.12 the whole time. It
       * takes that take from 9 lines to 10 and its worst wait from 438 ms to
       * 211 ms. See ADR 0020.
       */
      deepBelow: 0.12,
      deepMs: 80,
      /**
       * A hand the tracker loses for less than this keeps its stroke; when it
       * comes back the line continues.
       *
       * 200 ms sits in an empty gap. Across the six paint takes the detector
       * dropped the hand 39 times, and the lengths are in two clumps with
       * nothing between them: 28 glitches of 48 ms median and none over 120 ms,
       * and 11 real departures of 300 ms and up, none of them mid-line. So
       * anything from 120 to 300 ms behaves identically on the evidence, and
       * the middle of that gap is the value least likely to be wrong in either
       * direction. See ADR 0019.
       */
      lostGraceMs: 200,
      /**
       * How long a pinch may sit between `closeBelow` and `openAbove` before it
       * is over.
       *
       * The band between the two marks is hysteresis, and it had no clock: a
       * pinch that opened past 0.18 and stopped short of 0.32 was held for as
       * long as it stayed there. Fingertips parted a centimetre read exactly
       * there - 0.22-0.29 for seconds at a time in the parted-slightly take, on
       * the nearest-pair reading as much as on the tips - so the line ran on
       * until the hand opened wide: 11.5 s of ink with the fingers apart in a
       * 27 s take, and a release 2.6 s late at the median.
       *
       * 400 ms is the shortest limit that cuts no line in the corpus. A held
       * pinch does stray into the band: the nearest-pair reading sat above 0.18
       * for up to 178 ms in the twenty-second pinch and 173 ms in the other
       * continuous take, and once each for 351 and 387 ms in two takes whose
       * video is too blurred to say whether the fingers had parted. At 300 ms
       * those two lines break; at 400 every count in the corpus holds. The one
       * take it does shorten is the fast, close, blurred continuous take, at
       * two points where the reading stayed above contact for 550-750 ms.
       *
       * This decides when a *line* ends, not when the ink stops. Ink is held
       * back the frame the fingers leave contact (PaintSession), so the limit
       * can afford to be slow. See ADR 0023.
       */
      looseMs: 400,
      /**
       * A hand smaller than this - its size as a fraction of the frame height,
       * the larger of palm length and palm width - is far, and may start a line
       * on the nearest-pair reading rather than on the tips.
       *
       * Distance does not move where contact reads: the ratio is divided by
       * the hand's own size, and across every take a touching pinch reads a
       * median of 0.10-0.11 from 70 px hands up. What distance does is make
       * the two tip landmarks noisier, until at two metres they pop over
       * `closeBelow` every few frames of a real pinch and no confirmation ever
       * completes. In the two-metre take (palm 0.05-0.08 of the frame) the
       * tips gave 4 of 8 lines and the nearest-pair reading gives 7: in the
       * missed pinches it sat at 0.00-0.09 while the tips read 0.2. Starting on
       * it at *every* size invents two lines in a near idle take - the thumb
       * resting on the side of a pointing index reads as contact there
       * (ADR 0022) - so the rule is gated by size.
       *
       * 0.09 sits in an empty gap: the far take's palm never exceeds 0.080 and
       * no near take's drops under 0.101, so anything between behaves the same
       * on the corpus and the middle is the value least likely to be wrong in
       * either direction. Halve the pixel count in your head on the 1080p
       * profile: this is a fraction of the frame, not a pixel size, and the
       * corpus is 720p.
       *
       * Unmeasured: whether a far hand that means nothing starts lines on this
       * reading. No idle take exists at two metres; a task asks for one. Verify
       * at the station. See ADR 0024.
       */
      farBelow: 0.09,

      /**
       * Which measurement the gate reads.
       *
       * "ratio" is the thumb-to-index gap over the hand's own size, off the 2D
       * landmarks: every number above was tuned on it and every committed take
       * carries it. "metres" is the same gap in MediaPipe's world landmarks,
       * which the detector was throwing away until ADR 0021: a distance in
       * metres that needs no hand size to normalise it, and that has depth, so
       * two fingertips that only line up from the camera's point of view do not
       * read as touching.
       *
       * The ratio stays the default because the metric gap was measured and
       * lost. World landmarks were recovered for nine takes by re-running the
       * same model over the video: while the ratio gate held a real pinch, the
       * 3D gap read 27-30 mm at the median and 56 mm at the ninetieth
       * percentile, for two fingertips that were touching the whole time, and
       * an idle hand meaning nothing dipped to 13 mm and stayed under 25 mm for
       * 372 ms. The depth MediaPipe lifts from one image is too rough for a
       * centimetre, and a noisy z can only make a distance longer. No metric
       * mark drew fewer than two lines nobody meant. The switch stays so the
       * question can be asked again on the 1080p profile, which no take has
       * covered; `pinchMetres` travels in every trace either way. See ADR 0021.
       */
      measure: "ratio" as "ratio" | "metres",
      /**
       * The three marks for the metric gap, in metres, standing in for
       * closeBelow, openAbove and deepBelow when `measure` is "metres". The
       * confirmation times and the grace period are shared.
       *
       * Not tuned, because nothing tuned them into working: over the recovered
       * takes every pair from 20/40 to 50/75 mm either missed most lines or
       * invented some. These are the middle of the held-pinch distribution and
       * the open one, so a metric take reads sensibly on the HUD. Verify at the
       * station before ever switching `measure` to "metres".
       */
      metres: { closeBelow: 0.03, openAbove: 0.05, deepBelow: 0.02 },
    },

    /**
     * The brush point is smoothed with its own 1€ filter and no prediction.
     * Prediction overshoots at every reversal, which on a cursor is a wobble
     * and on a line is a hook drawn at every corner. The floor is lower than
     * the cursor's because a line shows jitter that a ring hides.
     */
    filter: {
      minCutoffHz: 2,
      beta: 25,
      derivativeCutoffHz: 1,
      predictionCutoffHz: 6,
    },

    /**
     * How far back a line may be drawn from when it is confirmed.
     *
     * The one correction a line still gets after the fact. A gate cannot
     * know a pinch has begun until it has held, so by the time a line is
     * certain the hand has been drawing it for a confirmation already - and at
     * the speed a person actually paints, 1.32 screen heights a second at the
     * median and 2.65 at the ninetieth percentile, that is 220 to 440 px of
     * line missing from the top of every stroke. That is what "it takes a
     * while to start detecting the line" is: not only a wait, but a line whose
     * beginning was cut off.
     *
     * So the stroke is begun where the fingers met rather than where the hand
     * had got to, replaying the points in between. It appears late and it
     * appears whole.
     *
     * 240 ms is a guard rather than a shape. The gate cannot be more than
     * `closeMs` plus the frame that carries it behind the moment the fingers
     * met - a pending close either fires at 180 ms or is reset - so in the
     * ordinary case this never bites. Setting it *at* closeMs did bite, shaving
     * the last frame off the head of every line that took the slow way in.
     * See docs/adr/0020-a-line-starts-where-the-fingers-met.md.
     */
    startBackdateMs: 240,

    /**
     * The brush has to travel this far, in screen heights, before a new point
     * is added to the stroke. Points closer than this are jitter, not a line,
     * and dropping them is most of what makes the line look drawn by hand.
     * About 3 px on the 1080p station.
     */
    minSegment: 0.003,

    /**
     * The palette. Six, bright enough to read over a lit hallway wall and a
     * dark jacket alike. Black is not here: over a hallway at night it is a hole.
     */
    colors: ["#ffffff", "#ffd84d", "#ff6b5c", "#97eeda", "#5cb8ff", "#ff66c4"],
    defaultColor: 3,

    /** Line widths in screen heights: 9, 19 and 43 px on the 1080p station. */
    sizes: [0.008, 0.018, 0.04],
    defaultSize: 1,

    /** The eraser is this many times the chosen width; erasing at 9 px is a chore. */
    eraserScale: 2,

    /**
     * Holding on the bin for this long clears everything. Twice the ordinary
     * dwell, because there is no undo, and a hand resting there by accident
     * gets a whole second of a ring filling to move away from.
     */
    clearDwellMs: 1600,

    /**
     * The tool tray is the same glass as the menu and hangs on the same kind of
     * spring, but the chips are a third of the size of a tile and sit closer
     * together, so they travel a third as far before they would overlap.
     */
    tray: {
      dock: { spring: { damping: 0.75, stiffness: 190 }, maxOffset: 0.008 },
      tile: { spring: { damping: 0.6, stiffness: 340 }, maxOffset: 0.012 },
    },
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
