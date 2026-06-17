import type { VoiceProviderConfig } from '@race-engineer/voice';
import { describe, expect, it } from 'vitest';
import { attachLocalBackends } from './local-backends';

describe('attachLocalBackends', () => {
  it('attaches the Piper TTS backend when piper is selected and a binary path is configured', () => {
    const route = attachLocalBackends({
      tts: 'piper',
      stt: 'fake',
      ttsConfig: { binaryPath: '/opt/piper/piper', modelPath: '/m/voice.onnx' },
    });
    expect(typeof route.ttsBackend).toBe('function');
  });

  it('attaches the whisper.cpp STT backend when whisper-cpp + binary + model are configured', () => {
    const route = attachLocalBackends({
      tts: 'fake',
      stt: 'whisper-cpp',
      sttConfig: { binaryPath: '/opt/whisper/whisper-cli', modelPath: '/m/ggml.bin' },
    });
    expect(typeof route.sttBackend).toBe('function');
  });

  it('does NOT attach a backend when the binary path is missing (so it falls back to fake)', () => {
    const tts = attachLocalBackends({ tts: 'piper', stt: 'fake' }); // no ttsConfig
    expect(tts.ttsBackend).toBeUndefined();
    const stt = attachLocalBackends({
      tts: 'fake',
      stt: 'whisper-cpp',
      sttConfig: { binaryPath: '/w' },
    }); // no modelPath
    expect(stt.sttBackend).toBeUndefined();
  });

  it('attaches the Kokoro TTS backend when kokoro is selected (it self-downloads its model)', () => {
    const route = attachLocalBackends({ tts: 'kokoro', stt: 'fake' });
    expect(typeof route.ttsBackend).toBe('function');
  });

  it('leaves an STT engine without a native backend yet (faster-whisper) to fall back', () => {
    const route = attachLocalBackends({
      tts: 'fake',
      stt: 'faster-whisper',
      sttConfig: { binaryPath: '/y', modelPath: '/z' },
    });
    expect(route.sttBackend).toBeUndefined();
  });

  it('leaves cloud / fake routes untouched', () => {
    const cloud: VoiceProviderConfig = {
      tts: 'openai',
      stt: 'openai',
      cloudTtsConfig: { apiKey: 'k' },
      cloudSttConfig: { apiKey: 'k' },
    };
    const out = attachLocalBackends(cloud);
    expect(out.ttsBackend).toBeUndefined();
    expect(out.sttBackend).toBeUndefined();
    expect(out.cloudTtsConfig).toEqual({ apiKey: 'k' }); // preserved
  });

  it('does not mutate the input route', () => {
    const route: VoiceProviderConfig = {
      tts: 'piper',
      stt: 'fake',
      ttsConfig: { binaryPath: '/opt/piper/piper', modelPath: '/m/en.onnx' },
    };
    const out = attachLocalBackends(route);
    expect(typeof out.ttsBackend).toBe('function'); // attached on the copy…
    expect(route.ttsBackend).toBeUndefined(); // …never the original
    expect(out).not.toBe(route);
  });
});
