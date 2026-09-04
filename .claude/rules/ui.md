---
paths:
  - "src/ui/**/*.ts"
  - "src/ui/**/*.css"
  - "index.html"
---

# UI layer

- Render only. `ui/` holds no application state: it reads `PerceptionFrame` and
  `CursorState` and draws. State belongs in `interaction/` or `app.ts`.
- Coordinates arriving here are already mirrored. Multiply by canvas width and
  height; never apply a transform to the overlay canvas.
- The camera feed is the background and stays the loudest thing on screen.
  Overlays are thin, quiet, and legible from three metres.
- Anything that is a developer aid (skeletons, boxes, fps, ids) is hidden when
  `showDebug` is off. A visitor sees the mirror and the interface, nothing else.
- Screenshot every visual change: `npm run screenshot -- --out captures/x.png`.
  One capture per state you touched, debug on and off if you changed both.
