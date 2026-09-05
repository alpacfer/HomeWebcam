# 0014. A debug recording is the model input, not the screen

## Context

Every interesting failure here is a perception failure: a hand that is there and
is not found, a Victory the model calls None, a cursor that jumps to the other
hand. All of them are gone the moment they happen, and a description of one is
the symptom rather than the evidence.

## Decision

Debug camera mode gets a corner control that records the camera stream itself -
the frames the detectors are handed - through `MediaRecorder`, capped at
`CONFIG.recording.maxMs`. Debug mode also gets a mouse pointer, which the rest
of the station suppresses, because a control in a corner has to be pressable.

Stopping asks for a name and a description and writes two files into the
gitignored `recordings/` directory, through the same kind of localhost endpoint
that already writes pictures (ADR 0009): the `.webm`, and a `.json` manifest
carrying the camera mode and what it negotiated, the loop's frame rate before
and during, the whole of `CONFIG`, and a per-frame trace of what the models
reported - hands in full, face boxes, the cursor.

The video is **unmirrored**, because that is the orientation the detectors work
in; the flip happens one layer later (ADR 0004), and the manifest says so.

## Consequences

A bug report is now a pair of files that can be replayed against a changed
detector, and the trace makes "the hand was there and the gesture came back
None" something the file states rather than something somebody remembers.

Encoding is not free. Measured on the station - real camera, a person in frame,
window focused, debug mode - a 12 s take at 8 Mb/s ran the loop at a median of
47.4 fps against 46.2 immediately before it started, so VP8 cost nothing
measurable. `CONFIG.recording.videoBitsPerSecond` is the knob if it ever does.

The video keeps every frame the camera delivered, not only the ones the loop
processed: a 5 s take held 242 encoded frames against 143 processed. A recording
made to debug a loop that is dropping frames must not drop the same frames.

A take never spans two camera formats: switching mode, losing the camera or
stopping the app all end it and put the naming dialog up. A take lives in memory
until it is saved, so reloading the page loses it.

Recordings are video of whoever was standing in the hallway. `recordings/` is
gitignored, nothing leaves the machine, and `npm run verify` removes exactly the
take its own check made.

## Alternatives

**A screen recording**, which is what was first asked for. It captures the
mirror: mirrored, colour-corrected, covered by the menu, at whatever rate the
compositor felt like. That is the picture of the symptom, and a fix has to be
tested against the picture the model got.

**The trace without the video**, which is small and replays nothing. **The video
without the trace**, which can show that something looked wrong and never that
the model disagreed with it.

**The 478-point face mesh in the trace.** At 60 fps it is more data than the
video it describes, and nothing outside the overlay reads a point of it. Boxes
and track ids go in; the mesh does not.

**One request with the video and the metadata together.** Multipart needs a
parser in the Vite middleware and base64 inflates a 30 MB take by a third. The
manifest is posted first and the video second, against the name the server sends
back, so the browser never supplies a path and a failed upload still leaves a
labelled record of what was being recorded.
