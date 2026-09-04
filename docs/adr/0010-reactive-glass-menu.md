# 0010. The menu is wordless glass on a spring

## Context

The first visitor interface was two captioned cards beside two lines of copy,
with emoji for the gestures. Nobody standing in a hallway reads four sizes of
type off a mirror, the emoji were drawn by whatever font the system chose, and
the cards were painted on: an interface driven entirely by hands that never once
behaved as though a hand were near it.

## Decision

No visitor-facing text. Icons carry the mode, the gesture that opens it, and how
far through holding that gesture you are; labels survive as `aria-label` only.

The look is assembled from systems that already solved this, cited where used:
**Apple's Liquid Glass** for the material - translucency, a specular rim, and
real edge refraction via a canvas displacement map fed to `feDisplacementMap`
(`src/ui/glass.ts`); **Fluent's reveal highlight** for the light a hand carries
across a panel; **Material 3 Expressive's motion physics** for movement, with
the damping and stiffness in `CONFIG.motion` copied from androidx
`ExpressiveMotionTokens`. Icons are Phosphor (MIT), inlined with Vite's `?raw`,
which keeps them on-device and includes the two gestures we teach.

Each tile is a soft mount inside a heavier one. A hand sets a target offset from
two terms: `drag`, along the hand's direction of travel, and `press`, away from
the hand. Sweeping past brushes the row; holding still barely moves it. The
physics lives in `src/interaction/`, so the renderer stays stateless.

## Consequences

`press` is weak on purpose: a tile that flees a pointing finger cannot be
dwelled on. Hit rectangles move with their tiles.

Refraction is Chromium-only. Measured at the station in debug mode, 1280x720@60,
with a person in frame and the window focused: 25 fps with the rim refraction,
27 with the menu removed entirely. Repeat it with `npm run station -- perf
--glass`, and believe nothing it prints while the window is unfocused - Chrome
throttles a page nobody is looking at, and the tool says so. A plain blur is
listed first as the fallback, and `CONFIG.ui.glass.refraction` turns it off. It
is delight, never meaning.

A wordless interface cannot explain a mode it has no icon for. Adding one means
finding a glyph that says it from three metres, which is the point.

## Alternatives

Keeping short captions was rejected: at hallway distance they are decoration,
and half-removing them leaves two type sizes competing with the mirror.

Hand-drawn SVG paths instead of an icon package would have avoided a dependency,
but two icons drawn by us never look like one family, and nothing we would draw
has a peace sign and an open palm in the same hand as a camera and a gamepad.

Animating with durations and easing was rejected because the input is a hand,
not a click: a spring already has somewhere to be pushed to, and Material 3
moved to physics for the same reason.
