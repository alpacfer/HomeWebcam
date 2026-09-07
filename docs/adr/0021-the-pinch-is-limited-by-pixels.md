# 0021. The pinch is limited by pixels, not by the gate

## Context

The person at the station drew lines at arm's length and got them; stood two
metres back, tried eight, and got four. Their note: "i tried 8 sets of lines.
only drew 4 and with bad quality." The natural reading, and the one they
offered, was that the gate needed a better algorithm.

Every take carries the landmarks frame by frame, so this could be measured
rather than argued. Across 7,618 frames with a hand in them, over twelve takes,
sorted by how tall the hand was in the 1280x720 camera frame:

| hand height | ratio jitter p90 | one-frame jumps over 0.10 | gap at contact | dips under 0.18 that last 180 ms |
| --- | --- | --- | --- | --- |
| over 120 px | 0.064 | 4% | 9.6 px | 44% |
| 100-120 px | 0.090 | 8% | 8.0 px | 31% |
| 85-100 px | 0.146 | 18% | 6.0 px | 17% |
| 70-85 px | 0.178 | 21% | 5.0 px | 13% |
| 55-70 px | 0.266 | 31% | 2.7 px | 8% |
| under 55 px | 0.231 | 27% | 3.4 px | 7% |

The gate needs the ratio to stay under its mark for 180 ms. At arm's length the
signal does that 44% of the time; two metres back, 7%. At that distance a real
contact is a gap of three pixels, and the model's own landmark jitter is two to
three pixels. The number being thresholded is the noise.

The denominator is not the problem: the palm size the ratio divides by jitters
1.6-2.1% a frame. The thumb and index tips jitter 11-19% at the median and
61-70% at the ninetieth percentile. The two noisiest landmarks the model
produces are the only two the signal is built from.

Every alternative gate was tried on the same eight takes, replaying the real
logic and counting lines against what the person meant: a 3- and 5-frame median
in front of the gate, a leaky evidence integrator, an integrator graded by depth,
and a full sweep of `closeBelow` against `closeMs`. Total error over the eight
takes: the shipped gate 6, the medians 6-7, the integrators 6-9. Every cell in
the sweep that got the distance take past five lines invented lines in the two
takes where nothing was meant to be drawn. The shipped gate sits on the frontier
of what this scalar supports.

And every take was made on the wrong camera. `D` chose the debug instruments and
the 720p/60 profile together, and the recorder lives among the instruments, so
all twelve takes say `1280x720@60`. A visitor gets `1920x1080@30`, half again the
linear resolution, and it had never once been measured.

## Decision

**The view and the camera profile are two settings.** `StationView` says what is
on the glass; `CameraMode` says what the camera delivers. `D` and `F` still set
both; `R` swaps the profile alone, and `npm run station -- camera final` does the
same from the CLI, so a take can be recorded from the debug view on the camera a
visitor gets. The stylesheet is keyed on the view. The manifest, the snapshot
and the corpus say which profile a take was made on. `station record` switches
the view, not the profile, so recording no longer drops the camera to 720p.

**The detector keeps the world landmarks.** MediaPipe computes 21 landmarks in
metres in the same pass and `HandsDetector` was discarding them.
`HandObservation.world` carries them, mirrored once in `mirror.ts` like
everything else, and the trace records them so a take can be replayed against a
ruler that did not exist when it was made.

**The metric gap was measured, and it loses.** To test it without waiting for
new takes, the same model was re-run over the video of nine takes
(`scripts/recover-world.py`) and aligned to the app's trace by the ratio. The
gap is quieter frame to frame than the ratio - a third of the jitter relative to
its own contact scale, at distance - but it is biased. While the ratio gate held
a pinch the person never released, the 3D gap read 27-30 mm at the median and
56 mm at the ninetieth percentile, for two fingertips that were touching the
whole time; an idle hand meaning nothing dipped to 13 mm and stayed under 25 mm
for 372 ms. Depth lifted from a single image is too rough for a centimetre, and a
noisy z can only make a distance longer. No pair of metric marks from 20/40 to
50/75 mm drew fewer than two lines nobody meant, and the best of them scored a
total error of 20 against the ratio's 6. `CONFIG.paint.pinch.measure` stays
`"ratio"`; the switch and `scripts/pinch-rulers.mjs` stay so the question can be
asked of a 1080p take.

**A learned head was trained, and it does not beat the ratio either.** A 16-unit
network over the 21 world landmarks in a hand-fixed frame, both rulers and the
finger angles, trained on the takes with take-level truth (held pinches after
the first close, idle takes throughout) and scored leave-one-take-out through
the same gate: total error 16 against 6, four false lines, and the same four of
eight at distance. It classifies the take where the thumb rests on a curled
index as a pinch 61% of the time, which is why the fist rule exists. Same pixels
in, same answer out. MediaPipe Model Maker, the official path to the same kind
of head, was attempted three times in a Python 3.11 environment and does not
import against a current toolchain: first `tensorflow_hub` wants a
`pkg_resources` that setuptools no longer ships, then with that pinned back the
`mediapipe` it pins lacks a `mediapipe.tasks.cc` module it imports. The head
above is the same class of model, so nothing was lost.

**HaMeR and WiLoR are out.** WiLoR is the 2025 state of the art at 5.5 mm
joint error and over 130 fps, on a datacentre GPU. This station is an i5 with
integrated graphics, already spending 18-22 ms a frame on hands beside faces and
Whisper, and has no way to run a ViT-H in a browser at 30 fps. It could not even
be benchmarked offline here in useful time.

**The digest says what a take drew.** `strokes` was the count on the glass and
read as six breaks in a take that had drawn two; `strokesDrawn` is the count
this take began. See friction 0031.

## Consequences

The recorder can now answer the question that matters: does the visitor's
camera have this problem at all? A task asks for the distance take again on the
final profile. Until it is answered, every number in `CONFIG.paint.pinch` is
tuned for a camera visitors do not see, and a 1080p take will need its own
corpus entries before any of them move.

The corpus takes carry `metres` from now on, and `profile`. Older takes carry
neither. The corpus test replays whichever ruler `measure` names, so flipping
that switch without takes that carry the field is a failing test, which is the
right price.

Two research scripts live beside the tools. `recover-world.py` needs a Python
MediaPipe that the station's Python is too new for; the header says how to get
one. Neither is part of `npm run check`.

The trace grew 63 numbers per hand per frame. A 30 s take's manifest is about
2.4 MB against the video's 30; acceptable, and worth revisiting if a second
detector ever adds its own.

## Alternatives

**Move `closeBelow` to 0.24.** Scores 4 against 6 on the eight takes with no
false lines, and fixes the missing fifth line at close range. Not done here:
ADR 0019 says a mark moves on the corpus test, not on a replay that counts line
starts and cannot see how long each waited, and `closeBelow` also decides where
the release trim stops. It is the first candidate for the next tuning pass, and
median-3 in front of it is not - together they invent two lines.

**Feed the model more pixels by cropping and upscaling the hand.** MediaPipe
already crops the hand's region and resizes it to its own input; a 50 px hand
is upscaled to 224 either way. The information is not there to recover.

**Run two recognisers, one retrained with a pinch label.** Doubles the hand
cost from 18-22 ms to 40, which is the whole frame budget, for a head the
offline trial says would not help.

**Keep the metric gap as the default anyway, because it will be better on a
better model.** It might. The switch is one word in the config and the tool to
test it is committed; the default follows the evidence there is.
