# 0016. The station listens, on its own machine

## Context

Two things wanted a voice. Stopping a recording means walking back to the
keyboard, which is the one moment a hands-free station has hands in it. And the
description of a bug - the one thing a video cannot record - is typed by
somebody who has just spent thirty seconds performing the bug and would rather
say what happened than write it.

The obvious API is the browser's own `SpeechRecognition`, and it is not
available to this project: it streams the microphone to Google. A hallway
microphone leaving the machine is a worse version of the thing this project
already refuses to do with faces.

## Decision

Whisper tiny.en, in a worker, on the station's own disk.

`src/perception/voice.ts` opens the camera's microphone, gates it on loudness,
and hands each stretch of speech to `voice-worker.ts`, which runs the model
through transformers.js with `allowRemoteModels` off, the weights served from
`public/models/whisper-tiny.en/` and the runtime from `public/onnx/` - both by
the station's own server, exactly like MediaPipe's.

What comes back is an `Utterance` on `PerceptionFrame.heard`, so a word is
another observation of the room and everything above reads it the way it reads
hands. `src/interaction/voice-commands.ts` decides what it means:

- While a dialog is waiting for a description, everything said is **dictation**.
- Otherwise, "stop" ends a running recording.

Dictation wins unconditionally. Somebody describing a bug says "it stopped
tracking", and having that quietly operate the recorder they are describing
would be indefensible.

## Consequences

The station hears about a second and a half after the mouth stops: the gate
waits 600 ms for silence, then the model takes 0.3-1.5 s. That is the cost of
running it here instead of somewhere with a GPU farm, and it is fine for
stopping a recording and for dictating a sentence at a time.

Nothing is written down. No recording contains audio, the buffer is overwritten
as it goes, and a transcript lives exactly one frame before whatever consumes it
does. `station say "..."` can put words in the ear without a microphone; they
travel marked `injected` and are labelled everywhere they are read, for the same
reason a puppet's hands are (ADR 0011).

Whisper is a transcription model, not a detector. Handed a door closing it
answers with the likeliest sentence, which on this material is "you", "so", or
"thank you". The gate keeps most silence away from it and
`CONFIG.voice.hallucinations` drops the rest, but only when one is the entire
utterance: "thank you" inside a sentence is somebody talking.

`npm run models` grew by 41 MB and `npm install` by an ONNX runtime.
`@huggingface/transformers` also pulls `onnxruntime-node` and `sharp` for its
Node path, neither of which this project runs or ships; both carry open npm
advisories, and both are absent from the browser bundle.

## Alternatives

**The Web Speech API.** One line of code, no download, no latency - and the
audio goes to a server. Not available to a station whose privacy posture is the
reason it runs models locally at all.

**A keyword spotter** (TensorFlow.js speech-commands, 18 words, ~1 MB). Enough
for "stop" and useless for a description, which was half the ask.

**A neural voice-activity detector** in front of the model. Another 2 MB and
another thing to be wrong, for a hallway with one person in it. The energy gate
is `CONFIG.voice.activationLevel`, measured against this room's floor.

**Recording audio into the take.** Tempting - "I said stop and nothing happened"
would be in the file. It is also a microphone recording of whoever was standing
in a hallway, filed to disk. The trace records the *words* the station heard,
which is the part a bug report needs.
