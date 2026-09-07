import { CONFIG } from "../config.js";
import { at } from "../lib/assert.js";
import { OneEuroVec2 } from "../lib/one-euro.js";
import { HAND } from "../perception/landmarks.js";
import type { HandObservation, PerceptionFrame, Vec2 } from "../perception/types.js";
import { toScreenUnits } from "./soft-mount.js";

/**
 * A pinch, read off the hand landmarks.
 *
 * The recognizer has no pinch label, so this is measured: the gap between the
 * thumb tip and the index tip, divided by the hand's own size so the number
 * means the same thing at one metre and at three. Nothing here knows about
 * paint; it is a sense built out of the perception contract, the way the
 * cursor is. See docs/adr/0017-pinch-to-paint.md.
 */

/**
 * Thumb-tip to index-tip distance as a fraction of the hand's size.
 *
 * The hand's size is the larger of its palm length (wrist to middle knuckle)
 * and palm width (index knuckle to little-finger knuckle). One of the two is
 * foreshortened whenever the hand tilts toward the camera - which is exactly
 * the pose a person pointing at a screen takes - and the larger one is the one
 * that was not. Measured in isotropic units so a sideways gap is not shorter
 * than a vertical one on a 16:9 screen.
 */
export function pinchRatio(hand: HandObservation, aspect: number): number {
  const point = (index: number): Vec2 => toScreenUnits(at(hand.landmarks, index, "hand"), aspect);
  const thumb = point(HAND.THUMB_TIP);
  const index = point(HAND.INDEX_TIP);
  const size = handSize(hand, aspect);
  if (size < 1e-6) return Number.POSITIVE_INFINITY;
  return Math.hypot(index.x - thumb.x, index.y - thumb.y) / size;
}

/**
 * Thumb-tip to index-tip distance in metres, off the world landmarks.
 *
 * No hand size in the denominator: the world landmarks are already metric, so
 * the same pinch reads the same number at any distance by construction rather
 * than by normalisation. And it is a distance in three dimensions, so a thumb
 * held in front of the index - the two tips on one line of sight, which the 2D
 * ratio calls a contact - reads as the centimetres apart they are. Null when
 * the source carried no world landmarks. See ADR 0021.
 */
export function pinchGapMetres(hand: HandObservation): number | null {
  if (hand.world.length <= Math.max(HAND.THUMB_TIP, HAND.INDEX_TIP)) return null;
  const thumb = at(hand.world, HAND.THUMB_TIP, "world");
  const index = at(hand.world, HAND.INDEX_TIP, "world");
  return Math.hypot(index.x - thumb.x, index.y - thumb.y, index.z - thumb.z);
}

/**
 * The nearest of three thumb-to-index pairs, over the hand's size: what a line
 * is *held* on, never what it is started on.
 *
 * Starting and holding are different questions. To start, the fingertips
 * themselves must meet, because a thumb resting on the side of a pointing index
 * puts the thumb tip within 0.07 of the index's middle joint while the tips are
 * 0.21-0.24 apart, and that pose means nothing; any reading that looks past the
 * tips starts a line there. To hold, the question is only whether contact
 * continues, and the two tip landmarks are the noisiest the model produces: in
 * held pinches the tip-to-tip ratio jumped past the open mark for long enough to
 * end a line the person never released, twice in nine takes. The joints behind
 * the tips rarely jump at the same time, so the closest of three pairs keeps
 * reading "together" through a tip that did. Replayed over every take, holding
 * on this heals both breaks and starts nothing new. See ADR 0022.
 */
export function pinchHoldRatio(hand: HandObservation, aspect: number): number {
  const point = (index: number): Vec2 => toScreenUnits(at(hand.landmarks, index, "hand"), aspect);
  const size = handSize(hand, aspect);
  if (size < 1e-6) return Number.POSITIVE_INFINITY;
  const gap = (a: number, b: number): number => {
    const p = point(a);
    const q = point(b);
    return Math.hypot(p.x - q.x, p.y - q.y);
  };
  return (
    Math.min(
      gap(HAND.THUMB_TIP, HAND.INDEX_TIP),
      gap(HAND.THUMB_TIP, HAND.INDEX_DIP),
      gap(HAND.THUMB_IP, HAND.INDEX_TIP),
    ) / size
  );
}

/** The same three pairs in metres, for the metric ruler. Null without world landmarks. */
export function pinchHoldMetres(hand: HandObservation): number | null {
  if (hand.world.length <= Math.max(HAND.THUMB_TIP, HAND.INDEX_TIP)) return null;
  const gap = (a: number, b: number): number => {
    const p = at(hand.world, a, "world");
    const q = at(hand.world, b, "world");
    return Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);
  };
  return Math.min(
    gap(HAND.THUMB_TIP, HAND.INDEX_TIP),
    gap(HAND.THUMB_TIP, HAND.INDEX_DIP),
    gap(HAND.THUMB_IP, HAND.INDEX_TIP),
  );
}

/**
 * The hand's size: the larger of palm length (wrist to middle knuckle) and palm
 * width (index knuckle to little-finger knuckle). One of the two is
 * foreshortened whenever the hand tilts toward the camera - which is exactly
 * the pose a person pointing at a screen takes - and the larger one is the one
 * that was not.
 *
 * In isotropic screen-height units, so it doubles as the gate's distance
 * ruler: a palm 0.07 of the frame high is a hand about two metres from this
 * camera, 0.15 one at arm's length. See ADR 0024.
 */
export function handSize(hand: HandObservation, aspect: number): number {
  const point = (index: number): Vec2 => toScreenUnits(at(hand.landmarks, index, "hand"), aspect);
  const wrist = point(HAND.WRIST);
  const middle = point(HAND.MIDDLE_MCP);
  const indexKnuckle = point(HAND.INDEX_MCP);
  const pinkyKnuckle = point(HAND.PINKY_MCP);
  return Math.max(
    Math.hypot(middle.x - wrist.x, middle.y - wrist.y),
    Math.hypot(pinkyKnuckle.x - indexKnuckle.x, pinkyKnuckle.y - indexKnuckle.y),
  );
}

/** Where the ink lands: halfway between the two fingertips, in normalized space. */
export function pinchPoint(hand: HandObservation): Vec2 {
  const thumb = at(hand.landmarks, HAND.THUMB_TIP, "hand");
  const index = at(hand.landmarks, HAND.INDEX_TIP, "hand");
  return { x: (thumb.x + index.x) / 2, y: (thumb.y + index.y) / 2 };
}

export interface PinchGateOptions {
  closeBelow: number;
  openAbove: number;
  /** A pinch this tight is unambiguous and is confirmed on `deepMs` instead. */
  deepBelow: number;
  deepMs: number;
  /** How long a close has to hold to count. */
  closeMs: number;
  /** How long an open has to hold. Longer: a glitch must not end a line. */
  openMs: number;
  lostGraceMs: number;
  /**
   * How long the hold reading may sit between `closeBelow` and `openAbove`
   * before the pinch is over. The band is hysteresis, not a place to live.
   */
  looseMs: number;
  /**
   * A hand smaller than this (its size as a fraction of the frame height) is
   * far, and may start a line on the hold reading rather than the tips.
   */
  farBelow: number;
}

export interface PinchState {
  /**
   * The number a line may start on this frame - the ratio or the metric gap,
   * whichever CONFIG.paint.pinch.measure names, off the tips for a near hand
   * and off the nearest pair for a far one - or null when there was no hand.
   * Every threshold in the options is in these units.
   */
  reading: number | null;
  closed: boolean;
  /** True for exactly one frame each, when the state flips. */
  justClosed: boolean;
  justOpened: boolean;
  /**
   * How shut the fingers are right now, 0 at `openAbove` and 1 at `closeBelow`,
   * before any confirmation. Unlike `closed` this is only a measurement, so it
   * is honest the instant the fingers move and useless as a decision. It is
   * what the brush ring is drawn from: a visitor who cannot start a line can
   * see how much further they have to squeeze. See ADR 0019.
   */
  grip: number;
  /**
   * On the frame `justClosed` is true, when the fingers actually met - which is
   * one confirmation earlier. Null on every other frame. It is what lets a
   * stroke be drawn back to where it should have begun instead of starting
   * wherever the hand had got to while the gate made up its mind. See ADR 0020.
   */
  contactSince: number | null;
  /**
   * Whether the fingers are together right now, by the hold reading and before
   * any confirmation. `closed` says a line is open; this says whether ink
   * should be flowing into it this frame. The two part company the moment a
   * hand lets go: the line stays open while the gate waits to be sure, the ink
   * does not. False without a hand. See ADR 0023.
   */
  touching: boolean;
}

/**
 * Turns a noisy per-frame ratio into a deliberate open-or-closed.
 *
 * Two thresholds rather than one, so a pinch hovering on the line does not
 * flicker; a confirmation time in each direction, so scrambled landmarks do not
 * count; and a grace period for a hand the tracker drops mid-stroke, so the
 * line continues when it comes back rather than starting a new one.
 *
 * The two confirmation times are different sizes because the two mistakes are.
 * The ratio is built from the thumb and index tips, which are the noisiest
 * landmarks the model produces, and they glitch hardest while the fingers are
 * shut - in one held pinch the ratio jumped to 0.80 for two frames at full
 * confidence. An opening therefore has to prove itself for much longer than a
 * closing. See CONFIG.paint.pinch and ADR 0018.
 *
 * The band between the two thresholds has a clock of its own. Hysteresis is
 * for a reading that wobbles across a line, not for a hand that has settled
 * between them: fingertips parted a centimetre read above contact and below
 * the open mark for seconds at a time, and a gate with no clock there held
 * that line for as long as it lasted. After `looseMs` in the band the pinch is
 * over, whatever the reading. See ADR 0023.
 *
 * Distance changes which reading a line starts on, not where the marks are.
 * Contact reads the same ratio at two metres as at arm's length - the ratio is
 * divided by the hand's own size for exactly that - but the two tip landmarks
 * get noisier as the hand shrinks, until at two metres they pop over the mark
 * every few frames of a real pinch and no confirmation can complete. The
 * joints behind them stay quiet, so a far hand starts on the nearest of three
 * pairs, the reading a line is held on anyway. A near hand may not: with the
 * thumb resting on the side of a pointing index that reading calls contact
 * where the tips are plainly apart (ADR 0022). See ADR 0024.
 */
export class PinchGate {
  private closed = false;
  private pendingSince: number | null = null;
  private deepSince: number | null = null;
  private lostSince: number | null = null;
  /** When the hold reading last left contact with the gate closed. */
  private looseSince: number | null = null;
  /** Set on the frame the gate closes, read once, cleared by `state`. */
  private metAt: number | null = null;

  constructor(private readonly options: PinchGateOptions) {}

  /**
   * @param tips What a near hand may start a line on: the tips, strictly.
   * @param hold What a line is held on, and what a far hand may start one on.
   *   Defaults to `tips`; the pointer passes the nearest-pair measurement,
   *   which is harder to break. ADR 0022, ADR 0024.
   * @param size The hand's size as a fraction of the frame height. Defaults to
   *   a hand that is not far, so a caller with no size gets the near rule.
   */
  update(
    tips: number | null,
    fist: boolean,
    now: number,
    hold: number | null = tips,
    size: number = Number.POSITIVE_INFINITY,
  ): PinchState {
    const was = this.closed;
    const reading = size < this.options.farBelow ? hold : tips;

    if (reading === null || hold === null) {
      // A hand that has gone is only a pinch that has ended once it has been
      // gone for a while. Until then nothing changes - the loose clock
      // included, which keeps counting through a dropout rather than handing a
      // parted hand a fresh allowance each time the tracker blinks.
      this.lostSince ??= now;
      if (now - this.lostSince >= this.options.lostGraceMs) {
        this.closed = false;
        this.looseSince = null;
      }
      this.pendingSince = null;
      this.deepSince = null;
      return this.state(reading, was, false);
    }
    this.lostSince = null;

    // Contact is read off the hold reading, because that is what a line is
    // held on (ADR 0022); while the gate is open the flag is only information.
    const touching = hold < this.options.closeBelow;
    if (this.closed && !touching) {
      this.looseSince ??= now;
      if (now - this.looseSince >= this.options.looseMs) {
        this.closed = false;
        this.pendingSince = null;
        this.deepSince = null;
        this.looseSince = null;
        return this.state(reading, was, touching);
      }
    } else {
      this.looseSince = null;
    }

    // A fist may keep a line from starting; it may never end one. With the
    // index curled into the palm the thumb lands on it and the gap alone reads
    // as pinched, so the label is worth having on the way in. On the way out it
    // is worse than useless: the recognizer calls a real pinch a Closed_Fist
    // often, and for long enough - 238 ms at full confidence inside one
    // deliberately unbroken pinch, which cut that line in half. Every fist
    // label in the corpus lands on a hand that was painting on purpose, and the
    // take where nothing was meant to be drawn has none. See ADR 0019.
    const wanted =
      fist && !this.closed
        ? false
        : this.closed
          ? hold < this.options.openAbove
          : reading < this.options.closeBelow;

    // Two speeds on the way in, because two mistakes are not equally likely.
    // A pinch that plunges past `deepBelow` is not something a hand does by
    // accident: over both takes where nothing was meant to be drawn, no
    // accidental dip stayed that tight for even 50 ms, while every deliberate
    // pinch in the corpus arrives there within a frame or two of closing. A
    // pinch that only grazes `closeBelow` is the ambiguous one, and it still
    // has to hold for the full `closeMs`. See ADR 0020.
    if (!fist && reading < this.options.deepBelow) this.deepSince ??= now;
    else this.deepSince = null;

    if (wanted === this.closed) {
      this.pendingSince = null;
    } else {
      this.pendingSince ??= now;
      const deepEnough =
        wanted && this.deepSince !== null && now - this.deepSince >= this.options.deepMs;
      const confirmMs = wanted ? this.options.closeMs : this.options.openMs;
      if (deepEnough || now - this.pendingSince >= confirmMs) {
        if (wanted) this.metAt = this.pendingSince;
        this.closed = wanted;
        this.pendingSince = null;
        if (!wanted) this.looseSince = null;
      }
    }
    return this.state(reading, was, touching);
  }

  reset(): void {
    this.closed = false;
    this.pendingSince = null;
    this.deepSince = null;
    this.lostSince = null;
    this.looseSince = null;
    this.metAt = null;
  }

  private state(reading: number | null, was: boolean, touching: boolean): PinchState {
    const justClosed = this.closed && !was;
    const contactSince = justClosed ? this.metAt : null;
    this.metAt = null;
    return {
      reading,
      closed: this.closed,
      justClosed,
      justOpened: !this.closed && was,
      grip: this.grip(reading),
      contactSince,
      touching,
    };
  }

  private grip(reading: number | null): number {
    if (reading === null) return 0;
    const span = this.options.openAbove - this.options.closeBelow;
    if (span <= 0) return reading < this.options.closeBelow ? 1 : 0;
    return Math.min(1, Math.max(0, (this.options.openAbove - reading) / span));
  }
}

/**
 * The marks the gate runs on, in the units CONFIG.paint.pinch.measure names.
 * One place decides, so the gate, the release trim and the brush ring can never
 * be reading three different rulers.
 */
export function activeGateOptions(): PinchGateOptions {
  const pinch = CONFIG.paint.pinch;
  return pinch.measure === "metres" ? { ...pinch, ...pinch.metres } : pinch;
}

export interface BrushPointer extends PinchState {
  /** When this reading was taken, so a point laid down from it can be dated. */
  t: number;
  /** The 2D ratio, always, whatever the gate read: it is what every take and digest carries. */
  ratio: number | null;
  /** The metric gap, when the source had world landmarks. Null otherwise. */
  metres: number | null;
  /**
   * The hand's size as a fraction of the frame height, or null without a hand.
   * Under `farBelow` the hand counts as far and starts on the hold reading.
   */
  handSize: number | null;
  /** The smoothed pinch point, or null when there is no hand. */
  position: Vec2 | null;
  /** The raw fingertips, for the cursor that shows them closing. */
  thumb: Vec2 | null;
  index: Vec2 | null;
}

/**
 * One hand reduced to a brush: where it is and whether it is pressed.
 *
 * The pointer is the pinch point even while the hand is open. It is the one
 * point that is continuous through a pinch: the index tip moves several
 * centimetres toward the thumb as the fingers close, so a line that started
 * where the index tip had been would start beside where the cursor was.
 * Smoothed with its own 1€ filter and no prediction; see CONFIG.paint.filter.
 */
export class PinchPointer {
  /** The ruler in force, so a consumer trimming against a mark uses the right one. */
  readonly marks: PinchGateOptions = activeGateOptions();
  private readonly gate = new PinchGate(this.marks);
  private readonly smoothed = new OneEuroVec2(CONFIG.paint.filter);

  update(frame: PerceptionFrame, aspect: number): BrushPointer {
    const hand = highestHand(frame.hands);
    if (hand === undefined) {
      this.smoothed.reset();
      return {
        ...this.gate.update(null, false, frame.t),
        t: frame.t,
        ratio: null,
        metres: null,
        handSize: null,
        position: null,
        thumb: null,
        index: null,
      };
    }
    const fist =
      hand.gesture === "Closed_Fist" &&
      hand.gestureConfidence >= CONFIG.interaction.minGestureConfidence;
    const ratio = pinchRatio(hand, aspect);
    const metres = pinchGapMetres(hand);
    const size = handSize(hand, aspect);
    // A source with no world landmarks cannot be read in metres, and a reading
    // invented from the other ruler would be a threshold applied to the wrong
    // units. Null is "no measurement", which the gate treats as a lost hand.
    const metric = CONFIG.paint.pinch.measure === "metres";
    const tips = metric ? metres : ratio;
    const hold = metric ? pinchHoldMetres(hand) : pinchHoldRatio(hand, aspect);
    const state = this.gate.update(tips, fist, frame.t, hold, size);
    return {
      ...state,
      t: frame.t,
      ratio,
      metres,
      handSize: size,
      position: this.smoothed.update(pinchPoint(hand), frame.t),
      thumb: at(hand.landmarks, HAND.THUMB_TIP, "hand"),
      index: at(hand.landmarks, HAND.INDEX_TIP, "hand"),
    };
  }

  reset(): void {
    this.gate.reset();
    this.smoothed.reset();
  }
}

/** The same rule the cursor uses: the raised hand is the one that means it. */
function highestHand(hands: readonly HandObservation[]): HandObservation | undefined {
  let best: HandObservation | undefined;
  for (const hand of hands) {
    if (best === undefined || hand.indexTip.y < best.indexTip.y) best = hand;
  }
  return best;
}
