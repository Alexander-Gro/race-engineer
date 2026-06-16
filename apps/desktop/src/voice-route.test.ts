import type { VoiceProviderConfig } from '@race-engineer/voice';
import { describe, expect, it } from 'vitest';
import {
  resolveVoiceRoute,
  sttLocalReady,
  ttsLocalReady,
  voiceRouteIsCloud,
  voiceRouteIsLocalReady,
  voiceRouteIsReady,
} from './voice-route';

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

  it('resolves the configured Piper binary+model into ttsConfig for the local TTS engine', () => {
    const route = resolveVoiceRoute(
      {
        tts: 'piper',
        stt: 'fake',
        local: { piper: { binaryPath: '/opt/piper/piper', modelPath: '/m/en.onnx' } },
      },
      secretsWith({}),
    );
    expect(route.ttsConfig).toEqual({ binaryPath: '/opt/piper/piper', modelPath: '/m/en.onnx' });
    expect(route.cloudTtsConfig).toBeUndefined(); // a local engine needs no key
  });

  it('resolves the configured whisper.cpp binary+model into sttConfig for the local STT engine', () => {
    const route = resolveVoiceRoute(
      {
        tts: 'fake',
        stt: 'whisper-cpp',
        local: { whisperCpp: { binaryPath: '/opt/whisper/whisper-cli', modelPath: '/m/ggml.bin' } },
      },
      secretsWith({}),
    );
    expect(route.sttConfig).toEqual({
      binaryPath: '/opt/whisper/whisper-cli',
      modelPath: '/m/ggml.bin',
    });
  });

  it('ignores local paths that do not match the selected engine (kokoro has no backend yet)', () => {
    const route = resolveVoiceRoute(
      { tts: 'kokoro', stt: 'fake', local: { piper: { binaryPath: '/p', modelPath: '/m' } } },
      secretsWith({}),
    );
    expect(route.ttsConfig).toBeUndefined();
  });

  it('stays serializable with local paths (plain paths, no fetch/backends)', () => {
    const route = resolveVoiceRoute(
      {
        tts: 'piper',
        stt: 'whisper-cpp',
        local: {
          piper: { binaryPath: '/p', modelPath: '/m' },
          whisperCpp: { binaryPath: '/w', modelPath: '/g' },
        },
      },
      secretsWith({}),
    );
    expect(() => structuredClone(route)).not.toThrow();
    expect(route.ttsBackend).toBeUndefined();
    expect(route.sttBackend).toBeUndefined();
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

describe('local voice readiness + the build gate', () => {
  const piperReady: VoiceProviderConfig = {
    tts: 'piper',
    stt: 'fake',
    ttsConfig: { binaryPath: '/p', modelPath: '/m' },
  };
  const whisperReady: VoiceProviderConfig = {
    tts: 'fake',
    stt: 'whisper-cpp',
    sttConfig: { binaryPath: '/w', modelPath: '/g' },
  };

  it('ttsLocalReady requires piper AND both binary and model paths', () => {
    expect(ttsLocalReady(piperReady)).toBe(true);
    expect(ttsLocalReady({ tts: 'piper', stt: 'fake', ttsConfig: { binaryPath: '/p' } })).toBe(
      false,
    );
    expect(ttsLocalReady({ tts: 'piper', stt: 'fake' })).toBe(false);
    // kokoro has no native backend yet, so paths don't make it ready.
    expect(
      ttsLocalReady({
        tts: 'kokoro',
        stt: 'fake',
        ttsConfig: { binaryPath: '/p', modelPath: '/m' },
      }),
    ).toBe(false);
  });

  it('sttLocalReady requires whisper-cpp AND both binary and model paths', () => {
    expect(sttLocalReady(whisperReady)).toBe(true);
    expect(
      sttLocalReady({ tts: 'fake', stt: 'whisper-cpp', sttConfig: { binaryPath: '/w' } }),
    ).toBe(false);
    expect(
      sttLocalReady({
        tts: 'fake',
        stt: 'faster-whisper',
        sttConfig: { binaryPath: '/w', modelPath: '/g' },
      }),
    ).toBe(false);
  });

  it('voiceRouteIsLocalReady is true when either local side is wired', () => {
    expect(voiceRouteIsLocalReady(piperReady)).toBe(true);
    expect(voiceRouteIsLocalReady(whisperReady)).toBe(true);
    expect(voiceRouteIsLocalReady({ tts: 'piper', stt: 'whisper-cpp' })).toBe(false); // no paths
  });

  it('voiceRouteIsReady admits cloud OR a ready local route, but not the bare free default', () => {
    expect(voiceRouteIsReady({ tts: 'openai', stt: 'fake' })).toBe(true); // cloud (BYO-key)
    expect(voiceRouteIsReady(piperReady)).toBe(true); // local, configured
    expect(voiceRouteIsReady(whisperReady)).toBe(true);
    expect(voiceRouteIsReady({ tts: 'kokoro', stt: 'faster-whisper' })).toBe(false); // default, no backends
    expect(voiceRouteIsReady({ tts: 'fake', stt: 'fake' })).toBe(false);
  });
});
