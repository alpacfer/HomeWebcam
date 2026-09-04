# 0002. MediaPipe Tasks Vision for hands, faces and pose

## Context

The station needs hand landmarks, gestures, face detection and eventually body
pose, all in a browser at video rate, all on-device.

## Decision

`@mediapipe/tasks-vision` (1.x), WASM with the WebGL `GPU` delegate. Model files
are vendored into `public/models/` by `npm run models`; the WASM runtime is
copied out of `node_modules` on `postinstall`.

The `GestureRecognizer` task is used for hands rather than `HandLandmarker`,
because it bundles the landmarker: running both would double the per-frame cost
for the same landmarks.

## Consequences

Served locally, not from a CDN, so the station works offline and no third party
learns when someone is in the hallway. The cost is a 18 MB download on setup and
a `models.json` manifest to keep in step with Google's published revisions.

MediaPipe's `*ForVideo` API is synchronous and demands strictly increasing
timestamps. That constraint propagates into `Detector`, which is why the whole
perception layer is synchronous.

It does **not** solve face recognition. See [ADR 0003](0003-face-recognition-deferred.md).

## Alternatives

**TensorFlow.js model zoo** - the same models, more wiring, slower.

**`@vladmandic/human`** - one library covering hands, face, pose *and* face
descriptors, which would have solved recognition too. Rejected as the primary
engine: it is a single-maintainer project, and it bundles decisions about model
choice and thresholds that we would rather make explicitly. Still the leading
candidate for the identity module alone.
