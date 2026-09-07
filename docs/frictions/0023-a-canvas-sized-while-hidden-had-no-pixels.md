# 0023. A canvas sized while hidden had no pixels

- Date: 2026-09-07
- Status: integrated
- Area: UI

## What happened

Paint mode shipped to the live station through the dev server's reload while
it was being built. Someone at the station found the new tile, entered the
mode, picked a colour and a width from the tray and painted thirty strokes,
nearly a thousand points. The HUD counted every one. The mirror showed none of
them.

The paint canvas is born with the `hidden` attribute and is only shown when the
mode is entered. It was sized in its constructor, from `clientWidth` and
`clientHeight`, which for a hidden element are zero. So the canvas was 0 by 0
pixels, every `quadraticCurveTo` landed in an empty buffer, and nothing anywhere
complained: `getContext` succeeded, the draw calls succeeded, the stroke count
rose, and the snapshot said the canvas was visible, because it was.

## Impact

A person spent several minutes painting into nothing, and would have reported
"paint mode does nothing" with a trace that said it was doing everything.

## Root cause

Sizing was tied to construction instead of to visibility, and nothing read the
canvas's own size back. The DOM lane could not catch it: happy-dom does no
layout, so every element measures zero there whether hidden or not.

## Correction

The layer sizes its canvas when it is shown, not when it is built. The snapshot
carries the canvas's pixel size, `npm run station -- state` warns in words when
a visible paint canvas is 0 by 0, and the `dwell-opens-paint` check in
`npm run verify` fails unless the canvas has pixels. The pixel-reading checks
that follow it (`a-pinch-paints-a-line` and the rest) would also have failed,
because they count painted pixels rather than strokes; that they exist is the
lesson of friction 0019 paying off.

## Workflow integration

A canvas that appears and disappears is measured on appearance. The rule is
stated at the one place it applies (`PaintLayer.setVisible`) and guarded by the
snapshot warning and the verify check, so the next hidden-then-shown canvas has
a tool that says so rather than a person who paints into nothing.

## Proof

`npm run station -- state` in paint mode reports `paint on the glass,
3840x2160` on the station (2x device pixel ratio) and no warning; before the
fix the same snapshot would have said `0x0` with the warning above it.
`npm run verify` passes `dwell-opens-paint` with the size in its detail line
and `a-pinch-paints-a-line` with a painted pixel count above zero.
