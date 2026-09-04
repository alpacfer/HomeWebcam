# 0004. One coordinate space, flipped once, in the detectors

## Context

The station is a mirror: the video is flipped horizontally so that moving left
moves your reflection left. MediaPipe returns coordinates in unflipped *camera*
space. Something has to reconcile the two.

Left unmanaged, the flip ends up applied in some places and not others. The
symptom is a UI that works but is subtly reversed, and it is genuinely hard to
find, because every individual piece looks right.

## Decision

Detectors flip x exactly once, on the way out:

```ts
const landmarks = raw.map((p) => ({ x: 1 - p.x, y: p.y }));
```

Everything above `perception/` is in **mirrored screen space**: normalized 0..1,
x already flipped. Nothing else in the codebase mirrors a coordinate, ever.
`src/perception/types.ts` says so at the top.

## Consequences

The overlay canvas needs no CSS transform, and its coordinates match the
mirrored video beneath it. Interaction code reads naturally: a cursor at
`x = 0.1` is near the left of the screen and got there by reaching left.

A new detector must remember to flip. That is one line, called out in
`AGENTS.md`, and the debug overlay makes a missed flip obvious immediately.

`CONFIG.ui.mirrored` only controls the CSS on the video element. Turning it off
gives an unmirrored picture with mirrored coordinates, which is wrong. If a
non-mirrored mode is ever wanted, the flag has to reach the detectors too.

## Alternatives

**Mirror in the canvas transform instead** - then text and labels come out
backwards and every label needs a counter-transform.

**Keep camera space and flip at render time** - pushes the flip into every
consumer, which is the failure mode this decision exists to prevent.
