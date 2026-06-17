import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  parseSettings,
  requiredSecretForLlm,
  SettingsStore,
  type AppSettings,
  type SettingsStorage,
} from './settings';

/** An in-memory SettingsStorage for round-trip tests. */
const memStorage = (initial: string | null = null): SettingsStorage & { value: string | null } => {
  const box = {
    value: initial,
    read: () => box.value,
    write: (json: string) => {
      box.value = json;
    },
  };
  return box;
};

describe('parseSettings', () => {
  it('returns the free/local defaults for empty or non-object input', () => {
    expect(parseSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('garbage')).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS.profile).toBe('free');
    expect(DEFAULT_SETTINGS.llm.provider).toBe('template'); // no key needed
  });

  it('keeps valid fields and falls back per-field on invalid ones (tolerant upgrade)', () => {
    const parsed = parseSettings({
      profile: 'premium',
      llm: { provider: 'claude', model: 'claude-opus-4-8' },
      voice: { tts: 'piper', stt: 'nonsense' },
      proactivity: 'high',
      outputDeviceId: 'hp-1',
      ptt: { deviceGuid: 'wheel', buttonIndex: 7 },
    });
    expect(parsed.profile).toBe('premium');
    expect(parsed.llm).toEqual({ provider: 'claude', model: 'claude-opus-4-8' });
    expect(parsed.voice.tts).toBe('piper');
    expect(parsed.voice.stt).toBe('whisper-cpp'); // invalid → default
    expect(parsed.proactivity).toBe('high');
    expect(parsed.outputDeviceId).toBe('hp-1');
    expect(parsed.ptt).toEqual({ deviceGuid: 'wheel', buttonIndex: 7 });
  });

  it('rejects a malformed PTT binding and a non-integer button index', () => {
    expect(parseSettings({ ptt: { deviceGuid: 'wheel' } }).ptt).toBeNull();
    expect(parseSettings({ ptt: { deviceGuid: 'wheel', buttonIndex: 1.5 } }).ptt).toBeNull();
    expect(parseSettings({ ptt: { deviceGuid: 'wheel', buttonIndex: -1 } }).ptt).toBeNull();
  });

  it('parses local voice binary/model paths and drops empty/garbage path entries', () => {
    const parsed = parseSettings({
      voice: {
        tts: 'piper',
        stt: 'whisper-cpp',
        local: {
          piper: { binaryPath: '/opt/piper/piper', modelPath: '/m/en.onnx' },
          whisperCpp: { binaryPath: '/opt/whisper/whisper-cli', modelPath: '/m/ggml.bin', junk: 1 },
        },
      },
    });
    expect(parsed.voice.local).toEqual({
      piper: { binaryPath: '/opt/piper/piper', modelPath: '/m/en.onnx' },
      whisperCpp: { binaryPath: '/opt/whisper/whisper-cli', modelPath: '/m/ggml.bin' },
    });
  });

  it('omits voice.local entirely when no valid local paths are present (no empty husk)', () => {
    expect(parseSettings({ voice: { tts: 'piper', stt: 'fake' } }).voice.local).toBeUndefined();
    // An empty / non-string-path object resolves to nothing rather than a fake "ready" engine.
    expect(
      parseSettings({ voice: { tts: 'piper', stt: 'fake', local: { piper: { binaryPath: '' } } } })
        .voice.local,
    ).toBeUndefined();
    expect(DEFAULT_SETTINGS.voice.local).toBeUndefined(); // the free default carries no paths
  });

  it('drops unknown fields — including a stray "key" — so settings can never carry a secret', () => {
    const parsed = parseSettings({
      profile: 'free',
      apiKey: 'sk-leak',
      anthropic: 'sk-leak',
    }) as unknown as Record<string, unknown>;
    expect(JSON.stringify(parsed)).not.toContain('sk-leak');
    expect(parsed['apiKey']).toBeUndefined();
    expect(parsed['anthropic']).toBeUndefined();
  });
});

describe('requiredSecretForLlm', () => {
  it('maps each cloud provider to its key slot and the free routes to none', () => {
    expect(requiredSecretForLlm('template')).toBeNull();
    expect(requiredSecretForLlm('ollama')).toBeNull();
    expect(requiredSecretForLlm('claude')).toBe('anthropic');
    expect(requiredSecretForLlm('groq')).toBe('groq');
    expect(requiredSecretForLlm('openrouter')).toBe('openrouter');
    expect(requiredSecretForLlm('gemini')).toBe('gemini');
  });
});

describe('SettingsStore', () => {
  it('round-trips settings through storage, normalizing on save', () => {
    const storage = memStorage();
    const store = new SettingsStore(storage);
    const next: AppSettings = {
      ...DEFAULT_SETTINGS,
      profile: 'premium',
      llm: { provider: 'groq' },
      ptt: { deviceGuid: 'wheel', buttonIndex: 3 },
    };
    const saved = store.save(next);
    expect(saved).toEqual(next);
    // A fresh store reading the same storage sees the persisted values (mapping round-trips).
    expect(new SettingsStore(storage).load()).toEqual(next);
  });

  it('falls back to defaults when storage is empty or corrupt (no crash)', () => {
    expect(new SettingsStore(memStorage(null)).load()).toEqual(DEFAULT_SETTINGS);
    expect(new SettingsStore(memStorage('{not json')).load()).toEqual(DEFAULT_SETTINGS);
  });

  it('never writes a secret into the settings file (defence in depth)', () => {
    const storage = memStorage();
    const store = new SettingsStore(storage);
    store.save({ ...DEFAULT_SETTINGS, ...({ anthropic: 'sk-leak' } as object) });
    expect(storage.value).not.toContain('sk-leak');
  });
});
