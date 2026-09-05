# 0021. A model that would not load blamed the wrong thing

- Date: 2026-09-05
- Status: integrated
- Area: tooling

## What happened

Wiring Whisper into the station took six failures, and not one of them named the
thing that was wrong:

1. `no available backend found` - the ONNX runtime wanted a build of its WASM
   glue that `sync-wasm.mjs` did not copy. The message named no file.
2. `Failed to fetch dynamically imported module` - Vite saw the runtime's
   `import()` of a file under `public/`, appended `?import`, and refused it as
   "should not be imported from source code". A 500, reported by the app as a
   missing backend.
3. `Failed to load model because protobuf parsing failed` - a model file that
   was not there. Vite answers a missing path with `index.html` and a 200, so
   the runtime parsed a web page as weights.
4. The same message again, from a *cached* copy of that web page: transformers.js
   keeps model responses in Cache Storage, so a response fetched during a broken
   five minutes was served back for the rest of the afternoon.
5. `Missing required scale ... for node ...DequantizeLinear` - the runtime's own
   QDQ optimiser refusing a decoder that loads fine in onnxruntime-node.
6. `local_files_only=true ... not found locally at encoder_model_quantized.onnx` -
   a `dtype` object keyed by session name instead of file name. An unmatched key
   is not an error; the session silently takes the library's default, which is a
   build nothing in this repo downloads.

## Impact

An hour of chasing errors that described a consequence several layers from the
cause, twice on a file that was on disk and correct.

## Root cause

Every layer between the app and the weights answers a missing or malformed
request with something that looks like success: Vite with a web page, the model
cache with a stale copy of that page, the dtype resolver with a silent default.
Nothing in the chain says "the file you asked for is not here".

## Correction

The runtime copy now includes both builds it may ask for. `dtype` is keyed by
file name and the decoder is the uint8 export, which this runtime will build a
session for; graph optimisation is disabled for that session, which is what lets
it. `env.useBrowserCache` is off: the station serves these files from its own
disk and a second copy only preserves mistakes.

## Workflow integration

`vite.config.ts` now serves `/models/`, `/onnx/` and `/mediapipe/` itself,
before Vite's own middlewares: it drops the `?import` query, and it answers a
missing file with a **404 and the path**, never with index.html. Every miss is
logged by the dev server and listed at `/api/missing`, so the next time a model
fails to load the first question - "did it get the file?" - has an answer that
takes one `curl`.

## Proof

`curl /api/missing` named `encoder_model_quantized.onnx` and ended the sixth
failure in one step. `npm run station -- state` then reported
`ear ready · C922 Pro Stream Webcam · heard "..." in 1306 ms`.
