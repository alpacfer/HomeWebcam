import { smoothstep } from "../lib/ease.js";
import type { Vec2 } from "../perception/types.js";

/**
 * Spring-mounted UI: the menu is hung in front of the mirror rather than
 * bolted to it, so a hand sweeping past brushes it and it swings back.
 *
 * The model is Material 3 Expressive's motion-physics scheme, not a duration
 * and an easing curve: a critically-or-under-damped spring chasing a moving
 * target. Damping is a ratio (1 = no overshoot) and stiffness is the unit-mass
 * constant, so the natural frequency is sqrt(stiffness) rad/s. Token values in
 * CONFIG.motion.spring come straight from androidx ExpressiveMotionTokens.
 *
 * Everything here is in **isotropic screen units**: y is already normalized
 * 0..1 over the viewport height, and x is multiplied by the aspect ratio so a
 * circle of radius r is actually round. `toScreenUnits` does that conversion.
 * Multiply by window.innerHeight to land back in pixels.
 */

export interface Spring {
  /** 1 is critically damped. Below 1 the mount overshoots and wobbles. */
  damping: number;
  /** Unit-mass spring constant. Natural frequency is sqrt(stiffness) rad/s. */
  stiffness: number;
}

/** A hand reduced to what the physics cares about: where it is and how fast. */
export interface HandImpulse {
  position: Vec2;
  /** Screen units per second. */
  velocity: Vec2;
}

export interface BrushConfig {
  /** Beyond this distance from a panel's centre a hand has no effect. */
  radius: number;
  /** Offset produced per unit of hand speed. A brisk wave runs about 2 /s. */
  drag: number;
  /** Offset produced by a hand hovering still, directly over the panel. */
  press: number;
}

/** Semi-implicit Euler is stable well past this; it only bounds a frame hitch. */
const MAX_SUBSTEP_S = 1 / 120;
/** A tab-switch or a GC pause must not fire the panels across the screen. */
const MAX_STEP_S = 1 / 20;

/** Normalized mirrored-screen-space point to isotropic screen units. */
export function toScreenUnits(point: Vec2, aspect: number): Vec2 {
  return { x: point.x * aspect, y: point.y };
}

/**
 * Where a panel would like to sit given the hands near it.
 *
 * Two terms, because a hand does two things. `drag` follows the direction of
 * travel, so a wave sweeps panels along with it. `press` pushes away from the
 * hand itself, so a hand held still over a panel still nudges it and the thing
 * reads as loose rather than painted on. Both fall off with a smoothstep, which
 * keeps the edge of the radius from snapping.
 *
 * `press` stays small on purpose: a panel that runs away from a pointing finger
 * cannot be dwell-selected, and dwell is how the station is actually driven.
 */
export function brushOffset(
  center: Vec2,
  impulses: readonly HandImpulse[],
  config: BrushConfig,
): Vec2 {
  let x = 0;
  let y = 0;
  for (const hand of impulses) {
    const dx = center.x - hand.position.x;
    const dy = center.y - hand.position.y;
    const distance = Math.hypot(dx, dy);
    if (distance >= config.radius) continue;

    const weight = smoothstep(config.radius, 0, distance);
    x += weight * config.drag * hand.velocity.x;
    y += weight * config.drag * hand.velocity.y;
    if (distance > 1e-6) {
      x += (weight * config.press * dx) / distance;
      y += (weight * config.press * dy) / distance;
    }
  }
  return { x, y };
}

/**
 * A slow, tiny wander so a panel with no hand near it still looks suspended
 * rather than printed on the glass. The two axes run at incommensurable rates,
 * which keeps the path from collapsing into an obvious circle or a straight
 * line - the thing that makes an idle animation read as an animation.
 */
export function idleDrift(t: number, phase: number, amplitude: number, periodMs: number): Vec2 {
  if (amplitude === 0 || periodMs <= 0) return { x: 0, y: 0 };
  const angle = (2 * Math.PI * t) / periodMs;
  return {
    x: amplitude * Math.sin(angle + phase),
    y: amplitude * 0.6 * Math.sin(angle * 1.37 + phase * 1.9),
  };
}

/** One spring-mounted panel. Chases a target offset and overshoots on the way. */
export class SoftMount {
  private position: Vec2 = { x: 0, y: 0 };
  private velocity: Vec2 = { x: 0, y: 0 };

  constructor(
    private readonly spring: Spring,
    /** Hard travel limit, so a fast wave cannot throw a panel off screen. */
    private readonly maxOffset: number,
  ) {}

  /** @param dtSeconds Time since the previous step. Clamped internally. */
  step(target: Vec2, dtSeconds: number): Vec2 {
    const goal = clampMagnitude(target, this.maxOffset);
    let remaining = Math.min(Math.max(dtSeconds, 0), MAX_STEP_S);
    const dampingCoefficient = 2 * this.spring.damping * Math.sqrt(this.spring.stiffness);

    while (remaining > 0) {
      const dt = Math.min(remaining, MAX_SUBSTEP_S);
      remaining -= dt;
      const ax =
        -this.spring.stiffness * (this.position.x - goal.x) - dampingCoefficient * this.velocity.x;
      const ay =
        -this.spring.stiffness * (this.position.y - goal.y) - dampingCoefficient * this.velocity.y;
      this.velocity = { x: this.velocity.x + ax * dt, y: this.velocity.y + ay * dt };
      this.position = {
        x: this.position.x + this.velocity.x * dt,
        y: this.position.y + this.velocity.y * dt,
      };
    }

    const clamped = clampMagnitude(this.position, this.maxOffset);
    // Killing the velocity at the wall stops a held-down force from storing
    // energy the panel would spend the moment the hand leaves.
    if (clamped !== this.position) this.velocity = { x: 0, y: 0 };
    this.position = clamped;
    return this.position;
  }

  get offset(): Vec2 {
    return this.position;
  }

  reset(): void {
    this.position = { x: 0, y: 0 };
    this.velocity = { x: 0, y: 0 };
  }
}

function clampMagnitude(vector: Vec2, max: number): Vec2 {
  const length = Math.hypot(vector.x, vector.y);
  if (length <= max) return vector;
  const scale = max / length;
  return { x: vector.x * scale, y: vector.y * scale };
}
