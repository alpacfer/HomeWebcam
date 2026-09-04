# 0003. Face recognition is deferred, behind an interface

## Context

Recognising the people who live here is an end goal. MediaPipe Tasks detects and
landmarks faces but has no face-recognition task: it produces no identity
embedding. Recognition needs a second model, chosen deliberately.

It is also the part of this project with real privacy weight. A hallway camera
that identifies guests is a different object from one that does not.

## Decision

Do not implement it yet. Define the seam now:

- `IdentityDetector` in `src/perception/types.ts`
- `NoopIdentityDetector` in `src/perception/detectors/identity.ts`, returning null
- `FaceObservation.identity`, already plumbed through to the overlay
- `CONFIG.faces.identifyPeople`, off

Everything above the perception layer is already written against identity, so
implementing it changes one file and one line of `PerceptionEngine`.

## Consequences

Face labels show track ids (`face-1`) rather than names until this lands. That
is honest: the station genuinely does not know who anyone is.

The decision that matters is not the model, it is enrolment, storage and
deletion. Deferring keeps that decision from being made by accident while
wiring up a demo.

## Alternatives (for when this is picked up)

**ArcFace / MobileFaceNet via `onnxruntime-web`** - the standard approach.
Detect with MediaPipe, align to a canonical template using the eye and nose
keypoints the detector already returns, embed, compare by cosine similarity.
Explicit, small, and every step is inspectable. Roughly 5 MB of model.

**`@vladmandic/human`** - ships a face descriptor and would work out of the box,
at the cost of pulling in a second full perception stack alongside MediaPipe.

**`face-api.js`** - do not. Unmaintained for years, TFJS 1.x era.

Whatever is chosen: on-device only, enrolment must be explicit and consented,
templates stay local, and there must be a way to see and delete them.
