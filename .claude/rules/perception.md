---
paths:
  - "src/perception/**/*.ts"
---

# Perception layer

- Output goes through `toMirroredScreen` / `boxToMirroredScreen` from
  `src/perception/mirror.ts`. Never write `1 - p.x` by hand anywhere else.
- `PerceptionFrame` and everything it contains is plain data. No MediaPipe type
  may appear in `types.ts` or leak out of `perception/`.
- `detect()` is synchronous. MediaPipe's `*ForVideo` methods block and require
  strictly increasing timestamps; async work here corrupts frame ordering.
- Detectors own their MediaPipe handle and must release it in `close()`.
- No network calls, no logging of frames, no persistence. Perception observes.
- New numeric thresholds go in `src/config.ts`, not inline.
