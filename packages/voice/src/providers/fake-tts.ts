import type { AudioChunk, AudioClip, TtsProvider, VoiceId } from '../types';

/**
 * Deterministic TTS provider for tests (no key, no network, no audio). `synthesizeStream`
 * yields one chunk per word; `prerender` returns a stable clip per phrase. Lets the priority
 * queue and Tier-0 pre-render be unit-tested end to end. Real cloud (ElevenLabs/Azure/OpenAI,
 * BYO-key) and local (Piper/Kokoro) providers implement the same {@link TtsProvider}.
 */
export class FakeTtsProvider implements TtsProvider {
  readonly name = 'fake-tts';

  async *synthesizeStream(text: string, _voice: VoiceId): AsyncIterable<AudioChunk> {
    const words = text.split(/\s+/).filter(Boolean);
    for (let i = 0; i < words.length; i += 1) {
      const word = words[i] ?? '';
      yield await Promise.resolve({ seq: i, data: new TextEncoder().encode(word) });
    }
  }

  prerender(phrases: readonly string[], voice: VoiceId): Promise<Map<string, AudioClip>> {
    const map = new Map<string, AudioClip>();
    for (const phrase of phrases) {
      map.set(phrase, { id: `${voice}:${phrase}`, label: phrase, durationMs: phrase.length * 60 });
    }
    return Promise.resolve(map);
  }
}
