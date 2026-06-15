import { describe, expect, it } from 'vitest';
import { resolveVoiceRoute, voiceRouteIsCloud } from './voice-route';

const secretsWith = (
  keys: Record<string, string>,
): { getKey: (slot: string) => string | null } => ({
  getKey: (slot) => keys[slot] ?? null,
});

describe('resolveVoiceRoute', () => {
  it('attaches the OpenAI key from secure storage when the cloud TTS engine is selected', () => {
    const route = resolveVoiceRoute(
      { tts: 'openai', stt: 'faster-whisper' },
      secretsWith({ openai: 'sk-live' }),
    );
    expect(route.tts).toBe('openai');
    expect(route.cloudTtsConfig).toEqual({ apiKey: 'sk-live' });
  });

  it('uses an empty key (→ not-ready, falls back) when the cloud engine is selected but no key is set', () => {
    const route = resolveVoiceRoute({ tts: 'openai', stt: 'fake' }, secretsWith({}));
    expect(route.cloudTtsConfig).toEqual({ apiKey: '' });
  });

  it('attaches no cloud config for a local/fake TTS engine (no key needed)', () => {
    const route = resolveVoiceRoute(
      { tts: 'kokoro', stt: 'faster-whisper' },
      secretsWith({ openai: 'sk-live' }),
    );
    expect(route.cloudTtsConfig).toBeUndefined();
    expect(route.cloudSttConfig).toBeUndefined();
    expect(route.tts).toBe('kokoro');
  });

  it('attaches the OpenAI key to the cloud STT config when the cloud mic engine is selected', () => {
    const route = resolveVoiceRoute(
      { tts: 'openai', stt: 'openai' },
      secretsWith({ openai: 'sk-x' }),
    );
    // One OpenAI key powers both directions of the loop.
    expect(route.cloudTtsConfig).toEqual({ apiKey: 'sk-x' });
    expect(route.cloudSttConfig).toEqual({ apiKey: 'sk-x' });
  });

  it('produces a serializable route — no fetch/backends that would break the worker postMessage', () => {
    const route = resolveVoiceRoute({ tts: 'openai', stt: 'fake' }, secretsWith({ openai: 'k' }));
    expect(() => structuredClone(route)).not.toThrow();
    expect(route.ttsBackend).toBeUndefined();
    expect(route.cloudTtsConfig?.fetch).toBeUndefined();
  });
});

describe('voiceRouteIsCloud', () => {
  it('is true when either TTS or STT is cloud, false for local/fake', () => {
    expect(voiceRouteIsCloud({ tts: 'openai', stt: 'fake' })).toBe(true);
    expect(voiceRouteIsCloud({ tts: 'fake', stt: 'openai' })).toBe(true); // cloud mic alone activates it
    expect(voiceRouteIsCloud({ tts: 'kokoro', stt: 'faster-whisper' })).toBe(false);
    expect(voiceRouteIsCloud({ tts: 'fake', stt: 'fake' })).toBe(false);
  });
});
