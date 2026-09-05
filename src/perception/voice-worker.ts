import { env, pipeline } from "@huggingface/transformers";
import type { VoiceWorkerIn, VoiceWorkerOut } from "./voice-protocol.js";

/**
 * Whisper tiny.en, on its own thread.
 *
 * It is here rather than on the main thread for one reason: the frame loop has
 * 16.7 ms and transcribing a sentence takes closer to a second. Running it
 * beside the detectors would drop frames in the very recording that was made to
 * explain why frames were being dropped.
 *
 * Nothing about this reaches the network. `allowRemoteModels` is off, the model
 * comes out of `public/models/whisper-tiny.en/` and the runtime out of
 * `public/onnx/`, both served by the station's own server, exactly like
 * MediaPipe's. Audio from a hallway leaving the machine would be a worse
 * version of the thing this project already refuses to do with faces.
 * See docs/adr/0016-on-device-speech.md.
 */

env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = "/models/";
/*
 * No Cache Storage copy of a file the station is already serving from its own
 * disk. It saves nothing here, and it survives a reload: a broken response
 * cached during five minutes of getting the model wired up is then served back
 * for the rest of the day, describing a problem that has been fixed.
 */
env.useBrowserCache = false;
const wasm = env.backends.onnx.wasm;
if (wasm !== undefined) {
  wasm.wasmPaths = "/onnx/";
  // Threads need SharedArrayBuffer, which needs cross-origin isolation, which
  // the station's server does not send. Asking for more would only warn and
  // fall back to this. See the ADR for what turning it on would cost.
  wasm.numThreads = 1;
}
type Transcriber = (
  audio: Float32Array,
  options: Record<string, unknown>,
) => Promise<{ text?: string } | Array<{ text?: string }>>;

let transcriber: Promise<Transcriber> | null = null;

function load(model: string): Promise<Transcriber> {
  transcriber ??= pipeline("automatic-speech-recognition", model, {
    /*
     * Keyed by the model *file*, which is not the same as the session name the
     * library uses internally: the encoder's session is called "model" and its
     * file is "encoder_model". A key that matches neither is not an error - the
     * session quietly takes the library's default instead, which is a build
     * npm run models does not download, and the failure arrives as a missing
     * file with a name nothing in this repo mentions. See friction 0021.
     *
     * Two different quantizations because they are not interchangeable here:
     * the encoder is fine as int8, and both the int8 and the legacy "quantized"
     * decoder ask this runtime for a block-quantized MatMul it cannot build a
     * session for ("Missing required scale"). uint8 loads.
     */
    dtype: { encoder_model: "int8", decoder_model_merged: "uint8" },
    device: "wasm",
    // The runtime's own QDQ optimiser is what refuses this decoder, not the
    // model: it rewrites quantized MatMuls on load and then cannot find a scale
    // it expects. Skipping that pass loads it as exported. See friction 0021.
    session_options: { graphOptimizationLevel: "disabled" },
  }) as unknown as Promise<Transcriber>;
  return transcriber;
}

self.addEventListener("message", (event: MessageEvent<VoiceWorkerIn>) => {
  const message = event.data;
  if (message.kind === "load") {
    void load(message.model)
      .then(() => post({ kind: "ready" }))
      .catch((error: unknown) => post({ kind: "failed", message: describe(error) }));
    return;
  }

  void (async () => {
    const started = performance.now();
    try {
      const asr = await load(message.model);
      // No `task` and no `language`: tiny.en is English-only and refuses both,
      // with "Cannot specify `task` or `language` for an English-only model".
      const result = await asr(message.audio, { return_timestamps: false });
      const text = (Array.isArray(result) ? result[0]?.text : result.text) ?? "";
      post({
        kind: "heard",
        id: message.id,
        text: text.trim(),
        startedAt: message.startedAt,
        endedAt: message.endedAt,
        tookMs: performance.now() - started,
      });
    } catch (error) {
      post({ kind: "failed", message: describe(error) });
    }
  })();
});

function post(message: VoiceWorkerOut): void {
  self.postMessage(message);
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
