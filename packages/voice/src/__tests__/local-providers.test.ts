import { describe, expect, it } from 'vitest';
import { FakeSttProvider } from '../providers/fake-stt';
import { ProviderNotReadyError } from '../providers/errors';
import { kokoroTts, piperTts, type LocalTtsBackend } from '../providers/local-tts';
import { fasterWhisperStt, whisperCppStt, type LocalSttBackend } from '../providers/local-stt';
import {
  DEFAULT_VOICE_PROFILE,
  selectSttProvider,
  selectTtsProvider,
  type VoiceProviderConfig,
} from '../profile';
import type { AudioChunk, TtsProvider } from '../types';

// A stand-in for the native Piper/Kokoro binding (T10.1): one chunk per word.
const fakeTtsBackend: LocalTtsBackend = async function* (text): AsyncIterable<AudioChunk> {
  const words = text.split(/\s+/).filter(Boolean);
  for (let i = 0; i < words.length; i += 1) {
    yield await Promise.resolve({ seq: i, data: new TextEncoder().encode(words[i] ?? '') });
  }
};

// A stand-in for the native whisper backend: reuse the FakeSttProvider's stream.
const fakeSttBackend: LocalSttBackend = (opts) => new FakeSttProvider().startStream(opts);

const drain = async (provider: TtsProvider): Promise<number> => {
  let chunks = 0;
  for await (const _chunk of provider.synthesizeStream('box this lap', 'v1')) chunks += 1;
  return chunks;
};

describe('local TTS shells (Piper / Kokoro)', () => {
  it('conform to TtsProvider and report not-ready until the native backend is wired', async () => {
    for (const provider of [piperTts(), kokoroTts()]) {
      expect(provider.name).toMatch(/piper|kokoro/);
      expect(provider.available).toBe(false);
      expect(() => provider.synthesizeStream('car left', 'v1')).toThrow(ProviderNotReadyError);
      await expect(provider.prerender(['Clear.'], 'v1')).rejects.toThrow(ProviderNotReadyError);
    }
  });

  it('delegate to an injected backend once wired (T10.1)', async () => {
    const piper = piperTts({ voice: 'en-us' }, fakeTtsBackend);
    expect(piper.available).toBe(true);
    expect(await drain(piper)).toBe(3); // "box this lap"

    const clips = await piper.prerender(['Car left.', 'Clear.'], 'v1');
    expect(clips.get('Car left.')?.label).toBe('Car left.');
    expect(clips.size).toBe(2);
  });
});

describe('local STT shells (faster-whisper / whisper.cpp)', () => {
  it('conform to SttProvider and report not-ready until wired', () => {
    for (const provider of [fasterWhisperStt(), whisperCppStt()]) {
      expect(provider.name).toMatch(/whisper/);
      expect(provider.available).toBe(false);
      expect(() => provider.startStream({ sampleRate: 16000 })).toThrow(ProviderNotReadyError);
    }
  });

  it('delegate to an injected backend once wired (T10.1)', async () => {
    const provider = fasterWhisperStt({ model: 'small' }, fakeSttBackend);
    expect(provider.available).toBe(true);
    const stream = provider.startStream();
    stream.pushAudio(new TextEncoder().encode('box'));
    expect((await stream.finish()).transcript).toBe('box');
  });
});

describe('voice provider selection (provider-swap is config-only)', () => {
  it('selects the configured provider by id alone', () => {
    expect(selectTtsProvider({ tts: 'fake', stt: 'fake' }).name).toBe('fake-tts');
    expect(selectTtsProvider({ tts: 'piper', stt: 'fake' }).name).toBe('piper');
    expect(selectTtsProvider({ tts: 'kokoro', stt: 'fake' }).name).toBe('kokoro');
    expect(selectSttProvider({ tts: 'fake', stt: 'whisper-cpp' }).name).toBe('whisper-cpp');
    expect(selectSttProvider({ tts: 'fake', stt: 'faster-whisper' }).name).toBe('faster-whisper');
  });

  it('defaults to the free/local profile (docs/15) and swaps one field without touching code', () => {
    expect(DEFAULT_VOICE_PROFILE).toEqual({ tts: 'kokoro', stt: 'faster-whisper' });
    const swapped: VoiceProviderConfig = { ...DEFAULT_VOICE_PROFILE, tts: 'piper' };
    expect(selectTtsProvider(swapped).name).toBe('piper');
    expect(selectSttProvider(swapped).name).toBe('faster-whisper'); // unchanged
  });

  it('threads injected backends through the selector so the local provider is ready', () => {
    const tts = selectTtsProvider({ tts: 'kokoro', stt: 'fake', ttsBackend: fakeTtsBackend });
    expect(tts.available).toBe(true);
    const stt = selectSttProvider({
      tts: 'fake',
      stt: 'faster-whisper',
      sttBackend: fakeSttBackend,
    });
    expect(stt.available).toBe(true);
  });

  it('a selected not-ready provider throws on use (caller can fall back)', () => {
    const tts = selectTtsProvider(DEFAULT_VOICE_PROFILE); // kokoro, no backend wired yet
    expect(tts.available).toBe(false);
    expect(() => tts.synthesizeStream('hi', 'v1')).toThrow(ProviderNotReadyError);
  });
});
