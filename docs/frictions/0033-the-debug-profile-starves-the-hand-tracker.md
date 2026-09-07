# 0033. The debug camera profile starves the hand tracker

- Date: 2026-09-07
- Status: integrated
- Area: perception

## What happened

Re-running the station's own hand model over the video of the distance take
gave 6 lines where the live station had drawn 4, on identical frames with
identical settings. Feeding the offline model only the frames the live loop had
processed - one every 26 ms, the loop's cadence on the 60 fps debug profile -
gave 3. Every frame: 6. Every other frame: 4. Every third: 3.

## Impact

Every pinch take in the corpus was made on the debug profile, 1280x720 at
60 fps, where the loop processes 34 of 60 frames with faces off and about 37
with them on. The tracker was handed a stream it could not keep up with, and
its accuracy on those takes was roughly half what the same model manages when
it sees every frame. The corpus, the thresholds tuned on it and the assessment
that "the gate is at the frontier" were all measured under that handicap.
Visitors, on 1920x1080 at 30 fps, get every frame processed (30.0 of 30.0
measured) and have very likely had a better pinch than any take suggested.

## Root cause

MediaPipe's hand landmarker in VIDEO mode tracks from the previous frame's
landmarks: the region it crops next is where the hand was last seen, and its
smoothing runs over the frames it is given. Skip 40% of a fast hand's frames
and it crops late and smooths over gaps. The debug profile was chosen for 60 fps
"motion fidelity" (ADR 0006) at a time when the loop was expected to keep up,
and nothing measured whether it did once the hand model cost 15-22 ms a frame.

## Correction

No profile changed: the debug profile keeps 60 fps for motion work, and the
visitor's profile already processes every frame. What changed is what a paint
take is made on. The task asking for the distance take again specifies the
final profile (`R`, or `station camera final`), the ADR says why, and
`scripts/pinch-rulers.mjs` and the corpus carry the profile with each take.
Faces are off while painting (ADR 0022), which on the debug profile takes the
loop from about 37 to 34-47 processed frames of 60: not enough.

## Workflow integration

`npm run station -- state` prints the view and profile first, and `watch
".camera.fps"` against `".camera.capturedFps"` is the two-line check for a
starved loop. The gotchas in AGENTS.md say to read the profile of a take before
trusting a pixel measurement, and ADR 0022 records the stride series so nobody
re-derives it.

## Proof

Offline stride series on the distance take (same model, same video): every
frame 6 lines, 33 ms 4, 26 ms 3, 40 ms 3, 50 ms 3; vertical-lines take 10, 8,
9, 7, 6. Live, focused, paint mode, faces off: 1080p profile loop 30.0 fps of
30.0 delivered; 720p/60 profile loop 34.0 fps median of 60.0.
