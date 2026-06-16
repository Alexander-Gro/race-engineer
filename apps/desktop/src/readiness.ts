import type { SttEngineId, TtsEngineId } from '@race-engineer/voice';
import type { AppSettings, SecretSlot } from './settings';
import { requiredSecretForLlm } from './settings';

/**
 * First-run readiness / health model (build-plan T10.2, docs/16 §5 onboarding + §6 health UI). A
 * **pure** function from the current config + injected capability probes → a structured list of
 * readiness checks (profile, LLM, voice, mic, output, PTT, data source), each with a status and the
 * next action to fix it. This is the model behind the onboarding/health screen and the
 * "are we ready to race?" badge — the renderer just paints it.
 *
 * Self-contained + input-injected (no Electron, no key VALUES — only presence booleans, rule 6; no
 * native probes — the caller passes detected capabilities), so it's unit-tested offline. Read-only/
 * advisory: it only describes whether the engineer is configured, never changes anything.
 */

export type ReadinessStatus = 'ready' | 'attention' | 'blocked';

export type ReadinessId = 'profile' | 'llm' | 'tts' | 'stt' | 'mic' | 'output' | 'ptt' | 'source';

export interface ReadinessCheck {
  id: ReadinessId;
  label: string;
  status: ReadinessStatus;
  /** Human-readable current state. */
  detail: string;
  /** The next step to resolve a gap, or null when ready. */
  action: string | null;
}

export interface ReadinessCapabilities {
  micPermission?: 'granted' | 'denied' | 'unknown';
  /** Count of audio output devices found, or null when not yet probed. */
  outputDeviceCount?: number | null;
  source?: 'synthetic' | 'lmu' | 'replay' | 'unknown';
  /** Is the active source producing data? (synthetic ⇒ true; lmu ⇒ SHM/REST up). null = unknown. */
  sourceAvailable?: boolean | null;
  /** Is a local Ollama server reachable? (only relevant for the ollama LLM route). null = unknown. */
  ollamaAvailable?: boolean | null;
}

export interface ReadinessInput {
  settings: AppSettings;
  /** Which secret slots have a key configured — presence booleans only, never values (rule 6). */
  secretsPresent?: Partial<Record<SecretSlot, boolean>>;
  capabilities?: ReadinessCapabilities;
}

export interface ReadinessReport {
  checks: ReadinessCheck[];
  /** Worst status across all checks — drives the overall badge. */
  overall: ReadinessStatus;
  /** The checks that are hard-blocked (the "fix these first" list). */
  blockers: ReadinessCheck[];
}

/** Cloud voice engines need the OpenAI key; everything else is local/offline (free). */
const CLOUD_TTS = new Set<TtsEngineId>(['openai']);
const CLOUD_STT = new Set<SttEngineId>(['openai']);

const has = (present: ReadinessInput['secretsPresent'], slot: SecretSlot): boolean =>
  present?.[slot] === true;

const SEVERITY: Record<ReadinessStatus, number> = { ready: 0, attention: 1, blocked: 2 };
const worst = (a: ReadinessStatus, b: ReadinessStatus): ReadinessStatus =>
  SEVERITY[a] >= SEVERITY[b] ? a : b;

const checkLlm = (settings: AppSettings, input: ReadinessInput): ReadinessCheck => {
  const provider = settings.llm.provider;
  const base = { id: 'llm' as const, label: 'AI engineer' };
  if (provider === 'template') {
    return {
      ...base,
      status: 'ready',
      detail: 'Free template mode — no key needed.',
      action: null,
    };
  }
  if (provider === 'ollama') {
    const ok = input.capabilities?.ollamaAvailable;
    return ok === false
      ? {
          ...base,
          status: 'attention',
          detail: 'Local LLM (Ollama) selected, but no Ollama server is reachable.',
          action: 'Start Ollama, or switch to the free template route in Settings.',
        }
      : { ...base, status: 'ready', detail: 'Local LLM via Ollama.', action: null };
  }
  // Cloud BYO-key route (claude / groq / openrouter / gemini).
  const slot = requiredSecretForLlm(provider);
  if (slot && has(input.secretsPresent, slot)) {
    return {
      ...base,
      status: 'ready',
      detail: `Cloud LLM (${provider}) — key configured.`,
      action: null,
    };
  }
  return {
    ...base,
    status: 'blocked',
    detail: `Cloud LLM (${provider}) selected, but no API key is stored.`,
    action: `Add your ${provider} API key in Settings, or switch to the free template route.`,
  };
};

const checkVoice = (
  id: 'tts' | 'stt',
  label: string,
  engine: string,
  isCloud: boolean,
  input: ReadinessInput,
): ReadinessCheck => {
  if (!isCloud) {
    return {
      id,
      label,
      status: 'ready',
      detail: `Local voice (${engine}) — free, offline.`,
      action: null,
    };
  }
  return has(input.secretsPresent, 'openai')
    ? {
        id,
        label,
        status: 'ready',
        detail: `Cloud voice (${engine}) — key configured.`,
        action: null,
      }
    : {
        id,
        label,
        status: 'blocked',
        detail: `Cloud voice (${engine}) selected, but no OpenAI key is stored.`,
        action: 'Add your OpenAI key in Settings, or pick a local voice engine.',
      };
};

const checkMic = (cap: ReadinessCapabilities): ReadinessCheck => {
  const base = { id: 'mic' as const, label: 'Microphone' };
  switch (cap.micPermission) {
    case 'granted':
      return { ...base, status: 'ready', detail: 'Microphone access granted.', action: null };
    case 'denied':
      return {
        ...base,
        status: 'blocked',
        detail: 'Microphone access is denied — push-to-talk voice input is unavailable.',
        action: 'Enable microphone access in Windows settings (the text box still works).',
      };
    default:
      return {
        ...base,
        status: 'attention',
        detail: 'Microphone access not yet granted.',
        action: 'Grant mic access to talk to the engineer (or use the text box).',
      };
  }
};

const checkSource = (cap: ReadinessCapabilities): ReadinessCheck => {
  const base = { id: 'source' as const, label: 'Telemetry source' };
  const source = cap.source ?? 'unknown';
  if (source === 'synthetic' || source === 'replay') {
    return { ...base, status: 'ready', detail: `${source} data — no game needed.`, action: null };
  }
  if (source === 'lmu') {
    return cap.sourceAvailable === true
      ? { ...base, status: 'ready', detail: 'Live LMU telemetry is flowing.', action: null }
      : {
          ...base,
          status: 'attention',
          detail: 'LMU source selected, but no telemetry yet.',
          action:
            'Start Le Mans Ultimate (and install the shared-memory plugin) to read live data.',
        };
  }
  return {
    ...base,
    status: 'attention',
    detail: 'No telemetry source selected.',
    action: 'Pick a data source.',
  };
};

/** Build the readiness report from the current config + injected capability probes. Pure. */
export const buildReadinessReport = (input: ReadinessInput): ReadinessReport => {
  const s = input.settings;
  const cap = input.capabilities ?? {};

  const checks: ReadinessCheck[] = [
    {
      id: 'profile',
      label: 'Profile',
      status: 'ready',
      detail:
        s.profile === 'free' ? 'Free profile — local, no key.' : 'Premium (bring-your-own-key).',
      action: null,
    },
    checkLlm(s, input),
    checkVoice('tts', 'Engineer voice (TTS)', s.voice.tts, CLOUD_TTS.has(s.voice.tts), input),
    checkVoice('stt', 'Speech input (STT)', s.voice.stt, CLOUD_STT.has(s.voice.stt), input),
    checkMic(cap),
    cap.outputDeviceCount === 0
      ? {
          id: 'output',
          label: 'Audio output',
          status: 'attention',
          detail: 'No audio output device found.',
          action: 'Connect speakers or headphones to hear the engineer.',
        }
      : {
          id: 'output',
          label: 'Audio output',
          status: 'ready',
          detail: 'Audio output available.',
          action: null,
        },
    s.ptt !== null
      ? {
          id: 'ptt',
          label: 'Push-to-talk',
          status: 'ready',
          detail: 'A wheel button is mapped.',
          action: null,
        }
      : {
          id: 'ptt',
          label: 'Push-to-talk',
          status: 'attention',
          detail: 'No push-to-talk button mapped.',
          action: 'Map a wheel button in Settings, or use the on-screen Hold-to-talk button.',
        },
    checkSource(cap),
  ];

  const overall = checks.reduce<ReadinessStatus>((acc, c) => worst(acc, c.status), 'ready');
  const blockers = checks.filter((c) => c.status === 'blocked');
  return { checks, overall, blockers };
};
