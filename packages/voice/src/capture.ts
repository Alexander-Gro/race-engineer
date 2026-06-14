import type { MicSource, SttProvider, SttResult, SttStream } from './types';

/**
 * Push-to-talk capture (docs/07 §PTT flow): button DOWN → open an STT stream and feed mic
 * audio; button UP → stop the mic, finalize, hand the transcript to the AI Engineer (docs/06).
 * Driven by {@link begin}/{@link end} so it can be wired to the input reader's PTT edges (T5.2)
 * and unit-tested with a fake STT + mock mic — no real microphone or key.
 *
 * Capture only runs between begin and end (PTT held), matching the privacy-friendly,
 * no-wake-word design. Read-only: it observes the mic and never sends anything to the game.
 */

export interface RadioCaptureEvents {
  onPartial?: (text: string) => void;
  onFinal?: (result: SttResult) => void;
}

export interface RadioCaptureOptions {
  stt: SttProvider;
  mic: MicSource;
  sampleRate?: number;
  /** Domain-biasing hints (driver names, "box", aid names, numbers) — docs/07. */
  hints?: readonly string[];
  events?: RadioCaptureEvents;
}

export class RadioCapture {
  readonly #stt: SttProvider;
  readonly #mic: MicSource;
  readonly #sampleRate: number | undefined;
  readonly #hints: readonly string[] | undefined;
  readonly #events: RadioCaptureEvents;
  #stream: SttStream | null = null;

  constructor(opts: RadioCaptureOptions) {
    this.#stt = opts.stt;
    this.#mic = opts.mic;
    this.#sampleRate = opts.sampleRate;
    this.#hints = opts.hints;
    this.#events = opts.events ?? {};
  }

  get active(): boolean {
    return this.#stream !== null;
  }

  /** PTT down: open the STT stream and start feeding mic audio. Idempotent while held. */
  begin(): void {
    if (this.#stream) return;
    const stream = this.#stt.startStream({ sampleRate: this.#sampleRate, hints: this.#hints });
    if (this.#events.onPartial) stream.onPartial(this.#events.onPartial);
    this.#stream = stream;
    this.#mic.start((frame) => {
      this.#stream?.pushAudio(frame);
    });
  }

  /** PTT up: stop the mic, finalize, and return the transcript. Empty if not capturing. */
  async end(): Promise<SttResult> {
    const stream = this.#stream;
    if (!stream) return { transcript: '' };
    this.#mic.stop();
    this.#stream = null;
    const result = await stream.finish();
    this.#events.onFinal?.(result);
    return result;
  }

  /** Abort the current capture without producing a transcript. */
  cancel(): void {
    if (!this.#stream) return;
    this.#mic.stop();
    this.#stream.cancel();
    this.#stream = null;
  }
}
