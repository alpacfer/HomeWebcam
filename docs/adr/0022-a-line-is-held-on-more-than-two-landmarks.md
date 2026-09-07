# 0022. A line is held on more than two landmarks, and the pinch gets the frame

## Context

ADR 0021 established that the pinch's limit at distance is pixels and that no
gate on the tip-to-tip ratio beats the shipped one. The person at the station
answered: "still needs better detection ... the biggest issue is detecting the
pinch." So this record is what *was* found to help, tried against the same nine
takes, with the model re-run over their video where the app's own trace could
not answer.

Three things were measured. Where a line breaks, what the loop is fed, and
what the detector costs.

**Held pinches broke on one landmark.** In two of nine takes a pinch the person
never released was cut: the tip-to-tip ratio jumped past the open mark for
longer than the 150 ms confirmation while the fingers stayed together. The two
tip landmarks are the noisiest the model produces. The joints behind them are
not, and they rarely jump in the same frame.

**The tracker was starved.** Re-run offline over the distance take's video, the
same model with the same settings drew 6 lines where the live station drew 4.
Fed only frames 26 ms apart, the live loop's cadence on the 60 fps debug
profile, it drew 3. The series is monotonic in frames seen, not in regularity:

| frames fed to the model | distance take (8 meant) | vertical lines (10 meant) |
| --- | --- | --- |
| every frame, 60 fps | 6 | 10 |
| every 33 ms (a 30 fps camera) | 4 | 8 |
| every 26 ms (the live loop on 720p/60) | 3 | 9 |
| every 40 ms | 3 | 7 |
| every 50 ms | 3 | 6 |

MediaPipe tracks from the previous frame's landmarks and smooths over the frames
it is given; a stream it cannot keep up with halves its accuracy on a fast hand.
Live, focused, in paint mode: the 1080p/30 visitor profile processes 30.0 of
30.0 fps; the 720p/60 debug profile processes 34 of 60. Every take in the
corpus was on the debug profile. See friction 0033.

**Detector settings and delegates do not move it.** Detection confidence 0.15,
0.3 or 0.5, presence 0.3 or 0.5, tracking 0.3 or 0.5: identical lines, hand
present on 76-77% of the distance take's frames whatever the threshold. The CPU
delegate computes slightly steadier landmarks (10-15% less jitter on identical
frames, half precision on the GPU being the likely reason) at 29.4 ms a pass
against the GPU's 15.3-18.2, which would starve the tracker further. The face
pass cost 4-7 ms on every other frame beside all of this, and nothing in Paint
mode reads a face.

## Decision

**A line starts on the fingertips and is held on the nearest of three pairs.**
`pinchRatio` (thumb tip to index tip) is the only reading that may start a
line: a thumb resting on the side of a pointing index puts the thumb tip 0.07
from the index's middle joint while the tips are 0.21-0.24 apart, and any
reading that looks past the tips starts a line there - "min of three pairs"
as a single reading did, once, in exactly that pose. `pinchHoldRatio`, the
closest of tip-tip, tip-DIP and IP-tip over the hand's size, is what keeps a
line going. `PinchGate.update` takes both; the release trim still reads the
tips. Replayed over the nine takes: both held-pinch breaks healed, nothing
else changed, no line invented; total error 3 against 5 on this replay. The
committed takes carry `hold` per frame and were regenerated from their
recordings; a take without the field is held on its ratio.

**Paint mode runs no face pass.** `CONFIG.faces.offWhilePainting`; the engine
reports the face cost as 0 there so the HUD says what is running, and the face
tracker's ids start over when the mode is left.

**Paint takes are made on the visitor's profile.** Nothing in `CONFIG.camera`
changes: the debug profile keeps its 60 fps for motion work, and the visitor's
profile already processes every frame. The task asking for the distance take
again says which profile, and the corpus records it.

**The hands delegate is a config switch, and stays GPU.** Measured; see
`CONFIG.hands.delegate`.

**Not changed:** detection, presence and tracking confidences, which the sweep
showed to be irrelevant to this failure.

**A lighter landmark model was tried, and is not a swap.** MediaPipe's Tasks
bundle ships only the full hand landmarker (5.5 MB); the legacy
`@mediapipe/hands` package still publishes the lite one (2.1 MB). Given the
input-normalization metadata the Tasks graph demands, copied from the full
model with `tflite-support` in a Python environment of its own, and zipped in
place of the full one, it loads, tracks and drives the gesture head. On the
pinch it is the full model's equal: at 60 fps the distance take gives 6 lines
with either, and the verticals 10 against the full model's 9. But its gesture
head calls fewer frames `Closed_Fist` - 284 against 314 on the fist take, 8
against 26 at distance, 97% agreement overall - and the pinch gate leans on
that label to refuse a thumb resting on a curled index. One line started in the
take where nothing was meant, at either cadence. Its cost on the station's GPU
is unmeasured: a lighter model only earns its place if it lets the debug loop
process all 60 frames, and that needs a hand in frame to measure. Filed as a
candidate with its blocker, not shipped.

## Consequences

The one thing that would double the debug profile's tracking accuracy - a loop
that processes all 60 frames - needs the hand pass under about 13 ms with a
hand in frame, and the GPU delegate is at 15-22. The lite model above is the
candidate; a geometric fist rule off the landmarks would have to replace the
label it weakens before it could be tried live. Until then a paint take on the
debug profile is a measurement of a starved tracker, and the number printed by
`station state` is the first thing to read.

Two environment facts cost an hour and are worth keeping: the `mediapipe`
1.0.1 Python wheel does not ship `mediapipe.tasks.cc`, so its metadata module
and Model Maker fail to import; and `tflite-support` imports only in a venv
that holds neither mediapipe nor tensorflow (its pybind types clash with
theirs). The offline harness needed three venvs for that reason.

The gate now carries two readings, and a future ruler (metric or otherwise)
must supply both. `scripts/pinch-rulers.mjs` and the distiller compute the hold
reading the same way the app does; a divergence shows up in the corpus test.

## Alternatives

**Hold on the metric gap.** Loses for the reasons in ADR 0021; measured again
with a nearest-pair rule and it still invents lines.

**Start on the nearest pair too.** One false line in the thumb-on-index pose,
which is the pose the fist rule exists for; the tips must meet to start.

**A 30 fps debug profile.** 4 lines against 3 in the stride series: not the
fix, and it costs the motion fidelity the profile exists for.

**Lower detector thresholds to find the hand more often.** The palm detector
finds the hand on the same 76-77% of frames at any threshold; what is lost at
distance is not lost to a threshold.

**The CPU delegate for its steadier landmarks.** Twice the cost per pass, which
starves the tracker further; the stride series says frames matter more.
