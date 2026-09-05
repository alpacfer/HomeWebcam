import { CONFIG } from "../config.js";
import type { Utterance } from "./types.js";
import type { VoiceWorkerIn, VoiceWorkerOut } from "./voice-protocol.js";

/**
 * The station's ear.
 *
 * A microphone, a level gate, and Whisper on a worker. It listens for a stretch
 * of sound loud enough to be someone talking, waits for them to stop, and hands
 * that stretch to the model; what comes back is a sentence with the time it was
 * said. Everything above reads those out of `PerceptionFrame.heard`, the same
 * way it reads hands, so a word is just another observation of the room.
 *
 * The gate is a plain energy threshold rather than a second model. It is a
 * hallway with one person in it talking to a mirror, not a call centre; a
 * neural VAD would be another 2 MB and another thing to be wrong. The numbers
 * are in CONFIG.voice and every one of them wants verifying at the station.
 *
 * Nothing is written down. The audio buffer is overwritten as it goes, the
 * transcript exists for as long as one frame, and no recording ever contains
 * sound. See docs/adr/0016-on-device-speech.md.
 */

export interface VoiceStatus {
  /** False when the microphone was refused, missing, or turned off in CONFIG. */
  listening: boolean;
  /** True once the model is loaded and a word could actually be recognised. */
  ready: boolean;
  /** 0..1 of the gate: how loud the room is right now. */
  level: number;
  /** True while someone is talking, before the model has had a look. */
  speaking: boolean;
  /** Utterances the model is still working through. */
  pending: number;
  /** The last thing it heard, for the HUD. */
  lastText: string;
  /** Where that came from. "injected" was never said out loud. See ADR 0011. */
  lastSource: "microphone" | "injected";
  /** How long the last transcription took, in ms. */
  lastTookMs: number;
  error: string | null;
  /** Which microphone it opened. */
  device: string;
}

const IDLE: VoiceStatus = {
  listening: false,
  ready: false,
  level: 0,
  speaking: false,
  pending: 0,
  lastText: "",
  lastSource: "microphone",
  lastTookMs: 0,
  error: null,
  device: "none",
};

export class VoiceEar {
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private worker: Worker | null = null;

  private status: VoiceStatus = { ...IDLE };
  private heard: Utterance[] = [];
  /** The utterance being collected, oldest chunk first. */
  private collecting: Float32Array[] = [];
  private collectedSamples = 0;
  private speakingSince = 0;
  private quietSince = 0;
  private nextId = 1;
  private pending = 0;

  get state(): VoiceStatus {
    return { ...this.status, pending: this.pending };
  }

  /**
   * Opens the microphone and starts the model loading. Never throws: a station
   * with no microphone, or one whose permission was refused, is a station that
   * works exactly as it did before, with `listening: false` saying why.
   *
   * Only called while the station is in debug mode. A mirror in a hallway does
   * not listen to the people walking past it; the two things a voice is for
   * here - stopping a recording and dictating a description - are both
   * developer tools, and the microphone light going out in the visitor view is
   * the visible proof of it. See ADR 0016.
   */
  async listen(): Promise<void> {
    if (!CONFIG.voice.enabled || this.stream !== null) return;
    try {
      const device = await pickMicrophone();
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          ...(device === null ? {} : { deviceId: { exact: device.deviceId } }),
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      this.status.device = device?.label ?? "default";

      // Whisper wants 16 kHz mono. Asking the graph for it means the browser
      // resamples once, in C++, instead of us doing it badly in JS.
      this.context = new AudioContext({ sampleRate: CONFIG.voice.sampleRate });
      await this.context.audioWorklet.addModule(workletUrl());
      this.node = new AudioWorkletNode(this.context, "voice-tap");
      this.node.port.onmessage = (event: MessageEvent<Float32Array>) => this.onAudio(event.data);
      this.context.createMediaStreamSource(this.stream).connect(this.node);
      // Connected to nothing audible: the node is a tap, not a speaker.
      this.node.connect(this.context.destination);

      this.worker = new Worker(new URL("./voice-worker.ts", import.meta.url), { type: "module" });
      this.worker.onmessage = (event: MessageEvent<VoiceWorkerOut>) => this.onWorker(event.data);
      this.send({ kind: "load", model: CONFIG.voice.model });
      this.status.listening = true;
    } catch (error) {
      this.status.error = error instanceof Error ? error.message : String(error);
      this.deafen();
    }
  }

  /**
   * Puts words in the station's ear without saying them, for the station CLI
   * and for `npm run verify`. They travel marked, exactly as a puppet's hands
   * do, so nothing downstream can mistake one for a person talking.
   */
  inject(text: string): void {
    const words = wordsOf(text);
    if (words.length === 0) return;
    const now = performance.now();
    this.status.lastText = text;
    this.status.lastSource = "injected";
    this.heard.push({ text, words, startedAt: now, endedAt: now, source: "injected" });
  }

  /** Everything heard since the last call. Drained into each PerceptionFrame. */
  drain(): Utterance[] {
    if (this.heard.length === 0) return [];
    const heard = this.heard;
    this.heard = [];
    return heard;
  }

  /**
   * Closes the microphone. The worker and its 41 MB of weights stay loaded, so
   * going back into debug mode is instant rather than another half minute.
   */
  deafen(): void {
    this.node?.port.close();
    this.node?.disconnect();
    this.node = null;
    void this.context?.close();
    this.context = null;
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
    this.collecting = [];
    this.collectedSamples = 0;
    this.status.listening = false;
    this.status.speaking = false;
    this.status.level = 0;
    // Not "the microphone it had": a device name beside listening:false reads
    // like an open microphone, which is the one thing this must never imply.
    this.status.device = "none";
  }

  close(): void {
    this.deafen();
    this.worker?.terminate();
    this.worker = null;
    this.status.ready = false;
  }

  /**
   * One block of microphone samples. Collects while the room is loud enough and
   * hands the collection over once it has been quiet for long enough.
   */
  private onAudio(block: Float32Array): void {
    const now = performance.now();
    const level = rms(block);
    this.status.level = level;

    const loud = level >= CONFIG.voice.activationLevel;
    if (loud) {
      if (this.collecting.length === 0) this.speakingSince = now;
      this.quietSince = now;
      this.status.speaking = true;
    } else if (this.collecting.length === 0) {
      // Silence with nothing collected: keep a little of it anyway, so a word
      // that starts between two blocks does not lose its first consonant.
      this.collecting.push(block);
      this.collectedSamples += block.length;
      this.trimLead();
      return;
    }

    this.collecting.push(block);
    this.collectedSamples += block.length;

    const spokenMs = (this.collectedSamples / CONFIG.voice.sampleRate) * 1000;
    const quietMs = now - this.quietSince;
    if (
      spokenMs >= CONFIG.voice.maxUtteranceMs ||
      (this.status.speaking && quietMs >= CONFIG.voice.silenceMs)
    ) {
      this.status.speaking = false;
      this.finish(now, spokenMs);
    }
  }

  /** Keeps at most `leadMs` of silence in front of a word. */
  private trimLead(): void {
    const keep = (CONFIG.voice.leadMs / 1000) * CONFIG.voice.sampleRate;
    while (this.collectedSamples > keep && this.collecting.length > 1) {
      const dropped = this.collecting.shift();
      this.collectedSamples -= dropped?.length ?? 0;
    }
  }

  private finish(now: number, spokenMs: number): void {
    const blocks = this.collecting;
    const samples = this.collectedSamples;
    this.collecting = [];
    this.collectedSamples = 0;
    if (spokenMs < CONFIG.voice.minUtteranceMs || this.worker === null) return;

    const audio = new Float32Array(samples);
    let offset = 0;
    for (const block of blocks) {
      audio.set(block, offset);
      offset += block.length;
    }

    this.pending++;
    this.send(
      {
        kind: "transcribe",
        model: CONFIG.voice.model,
        id: this.nextId++,
        audio,
        startedAt: this.speakingSince,
        endedAt: now,
      },
      [audio.buffer],
    );
  }

  private onWorker(message: VoiceWorkerOut): void {
    if (message.kind === "ready") {
      this.status.ready = true;
      return;
    }
    if (message.kind === "failed") {
      this.status.error = message.message;
      this.pending = Math.max(0, this.pending - 1);
      return;
    }

    this.pending = Math.max(0, this.pending - 1);
    this.status.lastTookMs = Math.round(message.tookMs);
    const text = cleanTranscript(message.text);
    const words = wordsOf(text);
    if (words.length === 0 || isHallucination(words)) return;
    this.status.lastText = text;
    this.status.lastSource = "microphone";
    this.heard.push({
      text,
      words,
      startedAt: message.startedAt,
      endedAt: message.endedAt,
      source: "microphone",
    });
  }

  private send(message: VoiceWorkerIn, transfer: Transferable[] = []): void {
    this.worker?.postMessage(message, transfer);
  }
}

/**
 * Drops the annotations Whisper writes when it is not hearing words.
 *
 * On a quiet room it answers with `[BLANK_AUDIO]`, `(wind blowing)` or
 * `[ Silence ]` - a description of the sound rather than a transcript of it.
 * Dictated into a bug report those read as though somebody said them. The
 * energy gate keeps most silence away from the model; this catches the rest.
 */
export function cleanTranscript(text: string): string {
  return text
    .replaceAll(/\[[^\]]*\]/g, " ")
    .replaceAll(/\([^)]*\)/g, " ")
    .replaceAll(/\s+/g, " ")
    .trim();
}

/**
 * The lower-cased words in a transcript, with punctuation dropped.
 *
 * Whisper writes English, so it returns " Stop." rather than "stop", and every
 * command in this app would miss by a full stop without this. Exported because
 * it is the whole of the matching rule and it is worth testing.
 */
export function wordsOf(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9']+/)
    .filter((word) => word !== "");
}

/**
 * Whether the whole utterance is one of the things Whisper says about silence.
 *
 * Whole utterance only: a person describing a bug says "so" and "yeah" inside
 * sentences all the time, and dropping those would edit what they told us.
 * See CONFIG.voice.hallucinations.
 */
export function isHallucination(words: readonly string[]): boolean {
  return CONFIG.voice.hallucinations.includes(words.join(" ") as never);
}

/** Root-mean-square of a block, which is loudness as a number 0..1. */
function rms(block: Float32Array): number {
  let sum = 0;
  for (const sample of block) sum += sample * sample;
  return Math.sqrt(sum / Math.max(block.length, 1));
}

/**
 * Prefers the camera's own microphone, which is the one pointed at whoever is
 * standing in front of the mirror rather than at the machine's keyboard.
 */
async function pickMicrophone(): Promise<MediaDeviceInfo | null> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const inputs = devices.filter((device) => device.kind === "audioinput");
  const wanted = new RegExp(CONFIG.voice.deviceLabel, "i");
  return inputs.find((device) => wanted.test(device.label)) ?? null;
}

/**
 * The tap that reads the microphone, as a module built at runtime.
 *
 * An AudioWorklet has to be loaded from a URL, and this is four lines of code
 * that belong next to the class that uses them. A Blob URL keeps it here
 * instead of in a stray file under public/ that nothing else would explain.
 * There is no interpolation in it; it is a constant string.
 */
function workletUrl(): string {
  const source = `
    class VoiceTap extends AudioWorkletProcessor {
      process(inputs) {
        const channel = inputs[0]?.[0];
        if (channel !== undefined) this.port.postMessage(channel.slice());
        return true;
      }
    }
    registerProcessor("voice-tap", VoiceTap);
  `;
  return URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
}
