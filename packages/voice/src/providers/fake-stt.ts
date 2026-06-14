import type { SttProvider, SttResult, SttStream } from '../types';

/**
 * Deterministic STT provider for tests (no key, no network, no mic). Each pushed frame is one
 * word (decoded UTF-8); partials are the running join; `finish` returns the full transcript.
 * Lets the PTT capture flow be unit-tested end to end. Real cloud (Deepgram/OpenAI, BYO-key)
 * and local (faster-whisper) providers implement the same {@link SttProvider}.
 */
export class FakeSttProvider implements SttProvider {
  readonly name = 'fake-stt';

  startStream(_opts?: { sampleRate?: number; hints?: readonly string[] }): SttStream {
    const words: string[] = [];
    let partialCb: ((text: string) => void) | null = null;
    let cancelled = false;

    return {
      pushAudio(frame: Uint8Array): void {
        if (cancelled) return;
        const word = new TextDecoder().decode(frame).trim();
        if (!word) return;
        words.push(word);
        partialCb?.(words.join(' '));
      },
      onPartial(cb): void {
        partialCb = cb;
      },
      finish(): Promise<SttResult> {
        return Promise.resolve({ transcript: words.join(' '), confidence01: 1 });
      },
      cancel(): void {
        cancelled = true;
        words.length = 0;
      },
    };
  }
}
