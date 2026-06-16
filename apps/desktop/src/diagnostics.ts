import type { AppSettings, SecretSlot } from './settings';
import { SECRET_SLOTS } from './settings';

/**
 * Local diagnostics export (build-plan T10.3, docs/16 §graceful degradation). A **pure** function that
 * assembles a redacted, self-contained snapshot the user can attach to a GitHub issue — app/version,
 * platform, the configured providers, source/health, recent event counts, and recent (scrubbed) errors.
 *
 * **No secrets, ever (CLAUDE.md rule 6 / docs/15).** Keys live only in the OS secure store and are
 * never passed in: secret state is reported as **presence booleans** (`anthropic: true`), never values,
 * and every free-text field (errors) is run through {@link redactSecrets} so a key that leaked into an
 * error message can't ride out in the report. The report is also privacy-conservative — device/PTT
 * hardware ids are reduced to "configured/mapped" booleans, not their raw identifiers.
 *
 * Pure + input-injected (no Electron, no `process`, no disk), so it's unit-tested offline and the
 * caller wires in the real version/platform/health. Read-only/advisory — it only describes app state.
 */

export const DIAGNOSTICS_SCHEMA = 'race-engineer/diagnostics@1' as const;

export interface DiagnosticsInput {
  appVersion: string;
  platform: { os: string; arch: string; osVersion?: string };
  runtime?: { node?: string; electron?: string; chrome?: string };
  /** Active telemetry source. */
  source: 'synthetic' | 'lmu' | 'replay' | 'unknown';
  settings: AppSettings;
  /** Which secret slots have a key configured — BOOLEANS ONLY, never the key value (rule 6). */
  secretsPresent?: Partial<Record<SecretSlot, boolean>>;
  /** Recent error messages — redacted on the way in (errors can echo a key). */
  recentErrors?: readonly string[];
  health?: {
    restAvailable?: boolean | null;
    shmAvailable?: boolean | null;
    lastSnapshotAgeMs?: number | null;
    tier2FirstAudioP95Ms?: number | null;
  };
  /** Recent event-type → count (context only; no payloads). */
  eventCounts?: Readonly<Record<string, number>>;
  /** Generation time in epoch ms (injected — keeps the function pure/deterministic). */
  generatedAtMs: number;
  /** Cap on recent errors kept (default 20). */
  maxErrors?: number;
}

export interface DiagnosticsReport {
  schema: typeof DIAGNOSTICS_SCHEMA;
  generatedAt: string; // ISO 8601, from generatedAtMs
  appVersion: string;
  platform: DiagnosticsInput['platform'];
  runtime: NonNullable<DiagnosticsInput['runtime']>;
  source: DiagnosticsInput['source'];
  config: {
    profile: AppSettings['profile'];
    llmProvider: AppSettings['llm']['provider'];
    llmModel: string | null;
    tts: AppSettings['voice']['tts'];
    stt: AppSettings['voice']['stt'];
    proactivity: AppSettings['proactivity'];
    /** Booleans only — never the raw device id / PTT hardware guid (privacy). */
    outputDeviceConfigured: boolean;
    pttMapped: boolean;
  };
  /** Per slot: is a key configured? Presence only — never a value (rule 6). */
  secrets: Record<SecretSlot, boolean>;
  health: NonNullable<DiagnosticsInput['health']>;
  eventCounts: Record<string, number>;
  recentErrors: string[];
}

const KEYISH = [
  /\bsk-[A-Za-z0-9_-]{12,}/g, // OpenAI / Anthropic-style keys
  /\bAIza[0-9A-Za-z_-]{16,}/g, // Google API keys
  /\bgsk_[A-Za-z0-9_-]{16,}/g, // Groq keys
  /\bBearer\s+[A-Za-z0-9._-]{12,}/gi, // Authorization: Bearer <token>
  // key/token/secret/authorization assignments: `apiKey: "xyz"`, `token=xyz`
  /\b(?:api[_-]?key|token|secret|authorization|password)\b["']?\s*[:=]\s*["']?[^\s"',}]+/gi,
];

/**
 * Scrub anything that looks like an API key / token from free text before it goes in the report.
 * Conservative — matches common key prefixes, Bearer tokens, and `key=`/`token:` assignments.
 */
export const redactSecrets = (text: string): string => {
  let out = text;
  for (const re of KEYISH) out = out.replace(re, '[redacted]');
  return out;
};

const allSecretsPresent = (
  present: DiagnosticsInput['secretsPresent'],
): Record<SecretSlot, boolean> => {
  const out = {} as Record<SecretSlot, boolean>;
  for (const slot of SECRET_SLOTS) out[slot] = present?.[slot] === true;
  return out;
};

/** Build the redacted diagnostics report from injected app state. Pure + deterministic. */
export const buildDiagnosticsReport = (input: DiagnosticsInput): DiagnosticsReport => {
  const s = input.settings;
  const maxErrors = input.maxErrors ?? 20;
  return {
    schema: DIAGNOSTICS_SCHEMA,
    generatedAt: new Date(input.generatedAtMs).toISOString(),
    appVersion: input.appVersion,
    platform: input.platform,
    runtime: input.runtime ?? {},
    source: input.source,
    config: {
      profile: s.profile,
      llmProvider: s.llm.provider,
      llmModel: s.llm.model ?? null,
      tts: s.voice.tts,
      stt: s.voice.stt,
      proactivity: s.proactivity,
      outputDeviceConfigured: s.outputDeviceId !== null,
      pttMapped: s.ptt !== null,
    },
    secrets: allSecretsPresent(input.secretsPresent),
    health: input.health ?? {},
    eventCounts: { ...(input.eventCounts ?? {}) },
    recentErrors: (input.recentErrors ?? []).slice(-maxErrors).map(redactSecrets),
  };
};

/** Pretty-print the report for writing to a file the user attaches to a bug report. */
export const serializeDiagnostics = (report: DiagnosticsReport): string =>
  JSON.stringify(report, null, 2);

/** A filesystem-safe filename for the report (no colons — Windows-safe), from its timestamp. */
export const diagnosticsFilename = (generatedAtMs: number): string => {
  const stamp = new Date(generatedAtMs).toISOString().replace(/[:.]/g, '-');
  return `race-engineer-diagnostics-${stamp}.json`;
};
