import { CONFIG } from "../config.js";
import type { Utterance } from "../perception/types.js";

/**
 * What to do about something that was said.
 *
 * Pure, and separate from both the ear and the app, because "does this sentence
 * mean stop" is a decision with edge cases - a word inside another word, a
 * sentence that is being dictated rather than commanded - and those are worth
 * pinning in a test rather than discovering at the station with your hands up.
 *
 * There is one command. See docs/adr/0016-on-device-speech.md for why the
 * vocabulary is deliberately tiny and where the list would grow.
 */

export type VoiceAction =
  | { kind: "none" }
  | { kind: "stop" }
  /** Everything said while a description is waiting for words is words. */
  | { kind: "dictate"; text: string };

export interface VoiceContext {
  /** A dialog is open with a field waiting to be filled. */
  dictating: boolean;
  /** A take is running and could be stopped. */
  recording: boolean;
}

export function routeUtterance(utterance: Utterance, context: VoiceContext): VoiceAction {
  // Dictation first and unconditionally. Someone describing a bug will say the
  // word "stop" - "it stopped tracking" - and having that quietly operate the
  // recorder while they are talking about it would be indefensible.
  if (context.dictating) {
    const text = utterance.text.trim();
    return text === "" ? { kind: "none" } : { kind: "dictate", text };
  }
  if (context.recording && says(utterance, CONFIG.voice.commands.stop)) return { kind: "stop" };
  return { kind: "none" };
}

/**
 * Whole words only. "Stop." matches, and so does "ok stop", because a person
 * talking to a mirror does not speak in single tokens. "Stopped" does not.
 */
function says(utterance: Utterance, vocabulary: readonly string[]): boolean {
  return utterance.words.some((word) => vocabulary.includes(word));
}
