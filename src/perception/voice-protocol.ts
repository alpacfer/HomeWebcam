/**
 * What crosses the wire to the speech worker. One file so both ends agree.
 * See src/perception/voice.ts and src/perception/voice-worker.ts.
 */

export type VoiceWorkerIn =
  | { kind: "load"; model: string }
  | {
      kind: "transcribe";
      model: string;
      id: number;
      /** 16 kHz mono PCM. Transferred, not copied. */
      audio: Float32Array;
      startedAt: number;
      endedAt: number;
    };

export type VoiceWorkerOut =
  | { kind: "ready" }
  | { kind: "failed"; message: string }
  | {
      kind: "heard";
      id: number;
      text: string;
      startedAt: number;
      endedAt: number;
      /** How long the model took. The first one includes loading it. */
      tookMs: number;
    };
