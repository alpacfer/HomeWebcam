# 0017. A generated name failed its own guard

- Date: 2026-09-05
- Status: integrated
- Area: tooling

## What happened

The debug recorder saves two files: the server names the pair from the name a
person typed, sends the stem back, and validates that stem again when the video
arrives. The first live save wrote the manifest and then answered the video with
`400`. The stem was `debug-flicker-2026-09-05T07-33-46-536Z`; the pattern that
guarded it was `/^[a-z0-9][a-z0-9-]{0,120}$/`, which has no room for the `T` and
the `Z` of an ISO timestamp the same file had just put there.

## Impact

Every recording failed at the last step, and each attempt left a manifest on
disk with no video beside it. Two orphaned manifests were written before the
cause was found.

## Root cause

The pattern was written against the slug and reviewed against the slug, while
the value it guards is slug plus timestamp. Nothing checked the generator and
the guard against each other, so they could only disagree at runtime, on a
station, after a real take had already been recorded.

## Correction

`recordingFile()` now decides where a stem may write, and does it twice: the
widened pattern, and then a containment check on the resolved path, which holds
whatever the pattern lets through. Both orphaned manifests were removed.

## Workflow integration

`recordingStem` and `recordingFile` are exported from `vite.config.ts` and
`tests/recording-names.test.ts` runs every stem the server builds back through
the guard that has to accept it, alongside the traversal attempts it has to
refuse. A name generated in one place and validated in another is now a thing
`npm run check` compares.

## Proof

`npx vitest run tests/recording-names.test.ts` - 5 passing, including the case
that shipped broken. On the station, `npm run station -- record 5 --name
"recorder smoke test"` wrote `recorder-smoke-test-<stamp>.webm` and its manifest
side by side; `gst-discoverer-1.0` read the file back as WebM/VP8 1280x720.
