/**
 * Spoken replies via the browser Web Speech API (build-plan T10.1 — free/no-key local TTS). The
 * engineer's *text* answer is spoken aloud using the OS voice (`window.speechSynthesis`), so a typed
 * question gets a heard reply today — with no key, no model download, and no native binary.
 *
 * This is the **conversational-reply** output only and is deliberately separate from the docs/07
 * tiered `VoicePlayer` pipeline (Piper/Kokoro → `AudioSink`), which carries pre-rendered spotter /
 * strategy audio and remains T10.1's native half. The mic→STT *input* path is also still that half.
 *
 * The logic is written over an injected {@link SpeechPort} (no DOM types) so it's unit-testable in
 * Node; the renderer supplies a port wrapping `speechSynthesis`. Read-only / output-only — it speaks
 * the engineer's own words and never touches the game (CLAUDE.md rule 5).
 */

/** The minimal speech surface the controller needs (renderer wraps `window.speechSynthesis`). */
export interface SpeechPort {
  /** Speak the text with the OS voice. */
  speak(text: string): void;
  /** Stop any in-progress / queued speech (barge-in / mute). */
  cancel(): void;
}

export interface SpeechControllerOptions {
  /** Start enabled? Default true (the user opted into voice); a `null` port forces disabled. */
  enabled?: boolean;
}

/**
 * Decides whether and what to speak. `say` is a no-op when muted, when no speech device is available,
 * or for blank text; speaking a new reply cancels the previous one (barge-in), so answers never pile
 * up. Muting stops anything mid-sentence.
 */
export class SpeechController {
  readonly #port: SpeechPort | null;
  #enabled: boolean;

  constructor(port: SpeechPort | null, options: SpeechControllerOptions = {}) {
    this.#port = port;
    this.#enabled = (options.enabled ?? true) && port !== null;
  }

  /** Whether a speech device is present at all (false ⇒ hide the toggle, fall back to text only). */
  get available(): boolean {
    return this.#port !== null;
  }

  get enabled(): boolean {
    return this.#enabled;
  }

  /** Turn speaking on/off; turning off stops any in-progress speech. No-op without a port. */
  setEnabled(on: boolean): void {
    this.#enabled = on && this.#port !== null;
    if (!this.#enabled) this.#port?.cancel();
  }

  /** Speak a reply aloud (cancels any current speech first). No-op when disabled or blank. */
  say(text: string): void {
    if (!this.#enabled || this.#port === null) return;
    const trimmed = text.trim();
    if (trimmed === '') return;
    this.#port.cancel();
    this.#port.speak(trimmed);
  }

  /** Stop any in-progress speech (e.g. on a new question). */
  stop(): void {
    this.#port?.cancel();
  }
}
