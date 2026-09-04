# 0013. The cursor is a 1€ filter, with speed-gated prediction

## Context

The cursor was a fixed first-order low-pass at 3 Hz. One cutoff has to answer
two opposite problems: a hand held still jitters and wants heavy smoothing, a
hand crossing the screen wants none. 3 Hz was the compromise, and the station's
owner reported the cursor did not feel attached to his hand.

The compromise was worse than it looked. A first-order low-pass at cutoff *f*
delays its input by about 1/(2*pi*f), so 3 Hz costs **53 ms on every movement**.
Measured against the rest of the pipeline, from `requestVideoFrameCallback`
metadata on the station:

| Stage | Measured |
| --- | --- |
| capture -> our callback (sensor, USB, decode) | 15.3 ms |
| callback -> on screen (one vsync at 60 Hz) | 16.7 ms |
| capture -> display | 32 ms |
| detector pass on top | ~17 ms |

So the filter alone was adding more delay than the sensor, the bus, the decoder
and the compositor combined.

## Decision

The 1€ filter (Casiez, Roussel and Vogel, CHI 2012), whose cutoff rises with
speed: `fc = fcmin + beta * |velocity|`, tuned to `fcmin = 3 Hz`, `beta = 30`.

**`fcmin` is set to the old filter's cutoff on purpose.** The adaptive cutoff can
then only ever be higher than 3 Hz, so the lag can only ever be lower: the change
cannot regress at any speed. That is a weaker-sounding claim than "better at both
ends" and a much more useful one.

The first attempt used the paper's suggested 1 Hz starting point and was wrong,
in a way only a person at the station could notice: the raw landmark overlay
visibly led the cursor. Measuring the station's actual hand speeds explained it -
a hand lining up a menu tile is slow, 0.06 u/s at the tenth percentile and
0.3 at the median - and at those speeds `fcmin = 1` costs 105 ms and 47 ms
against the old filter's flat 53 ms. The filter was *worse than what it replaced*
across most of real use, and prediction's dead band sat on top of exactly that
range. The paper's starting value is a starting value.

Two departures from a literal implementation, both deliberate:

**One cutoff for both axes**, driven by the magnitude of the 2D velocity.
Filtering each axis by its own speed makes lag depend on heading, so a diagonal
flick arrives bent toward whichever axis was moving less.

**Prediction gets its own velocity estimate.** The paper filters the derivative
at 1 Hz, which is right for driving a cutoff - only the magnitude matters, and a
fluttering cutoff is worse than a late one. It is wrong for extrapolation: at
1 Hz the estimate has a 159 ms time constant, so on a reversal it still points
the old way and prediction would throw the cursor *further* from the hand at the
moment the hand changed its mind. A second estimate at 6 Hz steers prediction.

On top of the filter, velocity extrapolation with a 35 ms horizon, faded in
between 0.15 and 1.0 units/second and **exactly zero below that**. Dwell-to-click
is cancelled by movement, and a dwelling hand is by definition a slow one, so
overshoot at a standstill would read as jitter and eat the click. Latency
compensation is worth nothing on a hand that is not going anywhere.

`CONFIG.hands.maxHands` drops to 1 in the same change. With `numHands: 2` and
one hand present, MediaPipe re-runs palm detection every frame hunting for the
second: the pass measured 26.5 ms against 17.5 ms at `numHands: 1`. Only one
hand drives the cursor, and the station's owner chose cursor feel over
two-handed menu brushing.

## Consequences

Lag against the fixed 3 Hz filter, at hand speeds measured on the station:

| hand speed | fixed 3 Hz | 1€ (fcmin 3, beta 30) |
| --- | --- | --- |
| standstill | 53 ms | 53 ms |
| 0.064 u/s (p10, careful aim) | 53 ms | **32 ms** |
| 0.123 u/s (p25) | 53 ms | **24 ms** |
| 0.299 u/s (median) | 53 ms | **13 ms** |
| 0.941 u/s (p90) | 53 ms | **5 ms** |
| 1.798 u/s (p99, brisk wave) | 53 ms | **3 ms** |

The cost is jitter at rest, and it is bounded rather than improved: at a
standstill the cutoff sits on the 3 Hz floor and behaves like the old filter.

`tests/one-euro.test.ts` asserts the dominance property across a sweep of speeds
rather than at one point, so a future tuning pass cannot reintroduce the 1 Hz
mistake without a red test.

Two knobs now instead of one, but they map onto symptoms one-to-one: jitter at
rest wants a lower `minCutoffHz`, lag when moving wants a higher `beta`. The
paper's tuning order is in `CONFIG.cursor.filter`.

`hand-motion.ts` still iterates every reported hand and so still drives the menu
brush from all of them; with `maxHands: 1` that is one hand, so two people can
no longer push the panels at once.

**None of this is a claim about how it feels.** The lag figures are analytic and
the tests use synthetic signals; the speed distribution is real but was measured
from one person over twelve seconds. Per ADR 0011 only a person in front of the
camera can judge a cursor - and it was a person, not a test, who caught the 1 Hz
tuning by seeing the raw overlay outrun the cursor.

The filter reads its options object every update and the bridge hands out the
live `CONFIG`, so both parameters can be tuned from the command line while
somebody stands at the mirror, with no rebuild:

```
window.__station.config.cursor.filter.beta = 45
```

## Alternatives

**Kalman filter.** The paper's own comparison found the 1€ filter matched it for
jitter at lower lag, with two intelligible parameters instead of a process and
measurement noise model nobody on this project would be able to re-tune.

**Decimating the hand pass to every second frame** was measured at 12.7 ms/frame
against 17.5 - a bigger saving than `maxHands: 1` - and rejected here: it halves
the cursor's update rate, which is the one thing this change exists to protect.

**A larger prediction horizon.** 35 ms is deliberately short of the ~50 ms the
pipeline actually costs. Extrapolation is only as good as the assumption that
the hand keeps going, and the research on tracking unpredictable targets finds
the benefit arrives late and the overshoot does not.

**A steadier landmark than the index fingertip.** The MediaPipe Hands paper notes
the palm region is the stable one under articulation, so a knuckle would jitter
less than a fingertip. Not taken: the fingertip is where people think they are
pointing. Revisit by measuring per-landmark jitter with a still hand rather than
by guessing.
