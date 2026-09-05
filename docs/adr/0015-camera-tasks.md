# 0015. Tasks are asked from a keyboard and answered by a recording

## Context

The debug recorder (ADR 0014) fixed what a bug report contains. It did not fix
who takes one. The person who can reproduce a perception bug is standing in the
hallway with their hands up; whoever is changing the code is at a keyboard,
often not in the room and often not at the same hour. What crosses that gap
today is a sentence - "I waved and it did nothing" - which is the one thing the
station could have recorded and did not.

## Decision

A task is a question written from the keyboard, shown in the debug view, and
answered by a recording of the person doing what it asks.

`npm run task -- new "<title>" "<step>" "<step>" --about "<why>"` writes
`tasks/<slug>-<stamp>.json`. The debug view polls `/api/tasks` while it is
visible, and draws every step as a button. Pressing one starts a take against
that step; pressing again stops it; the dialog then asks only what happened,
because the take is already named after the task and the step.

What comes back is filed against the step: the recording's stem, the note, where
the hands came from, and a **digest** of the trace - how much of the take had a
hand, a face and a cursor in it, which gestures the model reported and for how
long, which tile the cursor was over, how far a dwell got, and the frame rate the
trace itself implies.

The recording's trace gained the other half of the picture at the same time:
every frame now carries where the interface was - mode, phase, each panel's live
hit rectangle and glow, and which one was hovered.

`npm run task -- show latest [--frames 20]` prints the answer: the digest, any
error the page threw during the take, and a sampled walk through the trace.

## Consequences

A question and its answer are one artifact, so a bug survives the gap between
the person who has it and the person who fixes it.

The digest is the point of the tool. A recording nobody has opened can already
say "a hand was in 4% of the frames", which is usually the whole answer, and the
video is there when it is not.

Tasks are files. The command line writes them and never needs the station to be
running; the station only ever appends what it produced - a run, or a status -
and a task finishes itself once every step has a take on it.

The panel does not scroll and does not truncate. A person standing two metres
back cannot reach a scrollbar, and a task they cannot see is a task nobody does.
That puts a practical ceiling on how many tasks can be open at once, which is
the right pressure: they are questions, not a backlog.

A run records where its hands came from and says so everywhere it is read.
Scripted hands can drive a task step - `npm run station -- record --task` does
exactly that - and the answer is worth having for the wiring and worthless for
the models. See ADR 0011.

Recordings are camera footage of a person. Removing a task leaves them on disk
and prints their paths rather than deleting them.

## Alternatives

**A message on the screen with no recording.** That is the sentence we already
get. The recorder existed first precisely because the sentence is not enough.

**One recording for the whole task.** Multi-step tasks are how a question gets
narrowed - "now do it closer to the camera" - and one take per step is what
makes the two comparable. A single take would leave the boundaries in a note.

**Pushing tasks to the browser over a socket.** A task is written minutes before
anyone walks up to the station; polling every three seconds, only while the
debug view is on screen, is faster than a person crossing a hallway and costs a
mirror in final mode nothing at all.

**Storing runs only in the recording manifests.** Then the panel could not show
which steps are answered without reading every manifest on disk, and each is
about half a megabyte. The task file holds the answers; the manifest holds a
copy of the question, so a recording is still self-describing.
