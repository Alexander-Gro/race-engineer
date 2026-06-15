import type { LlmProviderId } from '@race-engineer/ai';
import type { ButtonRef } from '@race-engineer/input';
import type { SttEngineId, TtsEngineId } from '@race-engineer/voice';

/**
 * App settings model + tolerant persistence (build-plan T6.3, docs/15 §two profiles). This is the
 * **non-secret** config — provider/profile/voice/proactivity/output-device/PTT binding. API keys are
 * **never** here: they live only in the OS secure store ({@link SecretStore}, Electron `safeStorage`),
 * separate by design so settings can be logged/backed-up without ever leaking a key (docs/15: "secrets
 * live only in the user's OS secure storage, never in the repo, never in logs").
 *
 * Pure + storage-injected so it's unit-testable with no Electron and no disk. Read-only/advisory —
 * settings tune the engineer's own behaviour; nothing here is a write path to the game.
 */

export type Profile = 'free' | 'premium';
export type ProactivityLevel = 'off' | 'low' | 'normal' | 'high';
/** LLM routes are owned by `ai` (the package that builds the providers) — re-exported for convenience. */
export type { LlmProviderId };

// `satisfies` ties these literal lists to the voice package's engine ids — a drift there is a compile
// error here, so the settings enum can't silently fall out of sync with what `selectTtsProvider` knows.
const TTS_ENGINES = ['fake', 'piper', 'kokoro'] as const satisfies readonly TtsEngineId[];
const STT_ENGINES = [
  'fake',
  'whisper-cpp',
  'faster-whisper',
] as const satisfies readonly SttEngineId[];
/** UI option lists (also the validation allow-lists). Exported so the settings panel renders them. */
export const PROFILES = ['free', 'premium'] as const satisfies readonly Profile[];
export const PROACTIVITY_LEVELS = [
  'off',
  'low',
  'normal',
  'high',
] as const satisfies readonly ProactivityLevel[];
export const LLM_PROVIDER_IDS = [
  'template',
  'ollama',
  'claude',
  'groq',
  'openrouter',
  'gemini',
] as const satisfies readonly LlmProviderId[];

export interface AppSettings {
  profile: Profile;
  llm: { provider: LlmProviderId; model?: string };
  voice: { tts: TtsEngineId; stt: SttEngineId };
  proactivity: ProactivityLevel;
  /** Chosen engineer-voice output device, or null = OS default. */
  outputDeviceId: string | null;
  /** Mapped push-to-talk button, or null = unmapped (the text box still works). */
  ptt: ButtonRef | null;
}

/** The free/local default (docs/15, ships enabled): no key, no signup, fully offline. */
export const DEFAULT_SETTINGS: AppSettings = {
  profile: 'free',
  llm: { provider: 'template' },
  voice: { tts: 'kokoro', stt: 'faster-whisper' },
  proactivity: 'normal',
  outputDeviceId: null,
  ptt: null,
};

/** Named OS-secure-store slots for cloud keys (BYO-key). Never persisted to settings JSON. */
export const SECRET_SLOTS = [
  'anthropic',
  'groq',
  'openrouter',
  'gemini',
  'deepgram',
  'openai',
  'elevenlabs',
  'azure',
] as const;
export type SecretSlot = (typeof SECRET_SLOTS)[number];

export const isSecretSlot = (value: unknown): value is SecretSlot =>
  typeof value === 'string' && (SECRET_SLOTS as readonly string[]).includes(value);

/** The key slot the chosen LLM provider needs, or null for the key-less free routes. */
export const requiredSecretForLlm = (provider: LlmProviderId): SecretSlot | null => {
  switch (provider) {
    case 'claude':
      return 'anthropic';
    case 'groq':
      return 'groq';
    case 'openrouter':
      return 'openrouter';
    case 'gemini':
      return 'gemini';
    case 'template':
    case 'ollama':
      return null;
    default: {
      const unknown: never = provider;
      throw new Error(`unknown LLM provider: ${String(unknown)}`);
    }
  }
};

const inSet = <T extends string>(set: readonly T[], v: unknown): v is T =>
  typeof v === 'string' && (set as readonly string[]).includes(v);

const parsePtt = (raw: unknown): ButtonRef | null => {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  return typeof o['deviceGuid'] === 'string' &&
    typeof o['buttonIndex'] === 'number' &&
    Number.isInteger(o['buttonIndex']) &&
    o['buttonIndex'] >= 0
    ? { deviceGuid: o['deviceGuid'], buttonIndex: o['buttonIndex'] }
    : null;
};

/**
 * Validate unknown input into {@link AppSettings}, filling defaults for anything missing or invalid
 * (so an old/partial/corrupt settings file upgrades cleanly instead of crashing — docs/16 §graceful).
 * Any stray fields (including a stray "key") are dropped: the output only ever has the known shape.
 */
export const parseSettings = (raw: unknown): AppSettings => {
  const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const llm = (typeof o['llm'] === 'object' && o['llm'] !== null ? o['llm'] : {}) as Record<
    string,
    unknown
  >;
  const voice = (typeof o['voice'] === 'object' && o['voice'] !== null ? o['voice'] : {}) as Record<
    string,
    unknown
  >;
  return {
    profile: inSet(PROFILES, o['profile']) ? o['profile'] : DEFAULT_SETTINGS.profile,
    llm: {
      provider: inSet(LLM_PROVIDER_IDS, llm['provider'])
        ? llm['provider']
        : DEFAULT_SETTINGS.llm.provider,
      ...(typeof llm['model'] === 'string' && llm['model'] ? { model: llm['model'] } : {}),
    },
    voice: {
      tts: inSet(TTS_ENGINES, voice['tts']) ? voice['tts'] : DEFAULT_SETTINGS.voice.tts,
      stt: inSet(STT_ENGINES, voice['stt']) ? voice['stt'] : DEFAULT_SETTINGS.voice.stt,
    },
    proactivity: inSet(PROACTIVITY_LEVELS, o['proactivity'])
      ? o['proactivity']
      : DEFAULT_SETTINGS.proactivity,
    outputDeviceId: typeof o['outputDeviceId'] === 'string' ? o['outputDeviceId'] : null,
    ptt: parsePtt(o['ptt']),
  };
};

/** Where settings JSON is read/written (a file in user-data; injected for tests). */
export interface SettingsStorage {
  read(): string | null;
  write(json: string): void;
}

const safeParseJson = (raw: string): unknown => {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
};

/**
 * Loads/saves {@link AppSettings} over an injected {@link SettingsStorage}. Always normalizes through
 * {@link parseSettings}, so what's written is exactly the known shape — a defence-in-depth guarantee
 * that no stray secret can be persisted into the settings file.
 */
export class SettingsStore {
  readonly #storage: SettingsStorage;
  #cache: AppSettings | null = null;

  constructor(storage: SettingsStorage) {
    this.#storage = storage;
  }

  load(): AppSettings {
    const raw = this.#storage.read();
    this.#cache = parseSettings(raw === null ? {} : safeParseJson(raw));
    return this.#cache;
  }

  save(settings: AppSettings): AppSettings {
    const clean = parseSettings(settings);
    this.#storage.write(JSON.stringify(clean, null, 2));
    this.#cache = clean;
    return clean;
  }

  /** Cached settings, loading once on first use. */
  get(): AppSettings {
    return this.#cache ?? this.load();
  }
}
