import type { SttEngineId, TtsEngineId } from '@race-engineer/voice';
import type { AppSettings } from './settings';

/**
 * Cloud-cost estimator (build-plan T10.1, docs/15 §"What a user might optionally pay" + the M10 gate's
 * "documented cloud cost/hour"). A **pure** read-out of what the *currently configured* providers would
 * cost the user per racing hour and over a 24-hour Le Mans — so the settings panel can show the bill
 * before they opt in. Read-only/advisory: this only describes the user's own optional spend; the
 * publisher never pays (docs/15 §economics — no embedded key, no central server).
 *
 * Self-contained on purpose: it imports **no** ai/voice runtime (only their id *types*, erased at
 * build), so the renderer can compute the estimate without pulling the AI graph into its bundle. The
 * deterministic engine does the math — the LLM is never asked to price itself (CLAUDE.md rule 1).
 *
 * The figures are **indicative and reproduce docs/15** (e.g. a Haiku-tiered budget profile ≈ $0.15/h):
 * pricing and free-tier quotas change over time, so the numbers are clearly framed as estimates.
 */

/** Per-1M-token USD pricing for the paid cloud LLM models (docs/15 reference line; input / output). */
export interface TokenPrice {
  inputPerMTokUsd: number;
  outputPerMTokUsd: number;
}

/** Claude pricing per docs/15 ("$1/$5, $3/$15, $5/$25 per 1M input/output tokens"). */
export const LLM_MODEL_PRICING: Readonly<Record<string, TokenPrice>> = {
  'claude-haiku-4-5': { inputPerMTokUsd: 1, outputPerMTokUsd: 5 },
  'claude-sonnet-4-6': { inputPerMTokUsd: 3, outputPerMTokUsd: 15 },
  'claude-opus-4-8': { inputPerMTokUsd: 5, outputPerMTokUsd: 25 },
};

/**
 * The model billed when `settings.llm.model` is unset. Only **Claude** is a paid bring-your-own-key
 * route here; the other cloud routes (Groq / Gemini / OpenRouter) are used on their **free tiers**
 * (docs/15 §"LLM brain — free routes", Route A) and template/ollama are local — all $0.
 */
const DEFAULT_CLAUDE_MODEL = 'claude-haiku-4-5'; // docs/06 fast tier

/** Hourly USD for local voice engines — every currently-selectable STT/TTS engine is local ($0). A
 * `Record` over the id types makes adding a *paid* engine later a compile error until it's priced. */
export const STT_HOURLY_USD: Readonly<Record<SttEngineId, number>> = {
  fake: 0,
  'whisper-cpp': 0,
  'faster-whisper': 0,
};
export const TTS_HOURLY_USD: Readonly<Record<TtsEngineId, number>> = {
  fake: 0,
  piper: 0,
  kokoro: 0,
};

/** Usage basis for the LLM estimate (docs/15 §"Rate-limit math": ~30 interactions/hour). */
export interface UsageAssumptions {
  interactionsPerHour: number;
  inputTokensPerInteraction: number;
  outputTokensPerInteraction: number;
}

/** Defaults reproduce docs/15's budget figure: Haiku → ~$0.005/interaction → ~$0.15/hour. */
export const DEFAULT_USAGE: UsageAssumptions = {
  interactionsPerHour: 30,
  inputTokensPerInteraction: 3000,
  outputTokensPerInteraction: 400,
};

/** Hours in the headline endurance estimate (Le Mans). */
export const LE_MANS_HOURS = 24;

/**
 * Hourly LLM cost for the configured provider/model. `0` for the free routes (template / ollama /
 * free-tier cloud); a priced number for Claude; `null` for Claude with a model we can't price (so the
 * UI says "depends on your model" instead of inventing a figure).
 */
export const llmHourlyCostUsd = (
  llm: AppSettings['llm'],
  usage: UsageAssumptions = DEFAULT_USAGE,
): number | null => {
  if (llm.provider !== 'claude') return 0; // free routes (docs/15) — no paid LLM cost
  const price = LLM_MODEL_PRICING[llm.model ?? DEFAULT_CLAUDE_MODEL];
  if (!price) return null; // paid route, unknown model — don't guess
  const perInteractionUsd =
    (usage.inputTokensPerInteraction / 1e6) * price.inputPerMTokUsd +
    (usage.outputTokensPerInteraction / 1e6) * price.outputPerMTokUsd;
  return perInteractionUsd * usage.interactionsPerHour;
};

export interface CostBreakdown {
  /** `null` = a paid LLM route whose model isn't in the pricing table. */
  llmUsd: number | null;
  sttUsd: number;
  ttsUsd: number;
}

export interface CostEstimate {
  /** True when every configured provider is free/local (the default profile). */
  isFree: boolean;
  /** Total $/hour, or `null` if the LLM cost is unknown (paid route, unpriced model). */
  hourlyUsd: number | null;
  /** Total over {@link CostEstimate.raceHours}, or `null` if unknown. */
  perRaceUsd: number | null;
  raceHours: number;
  hourly: CostBreakdown;
  /** A display-ready, honestly-hedged one-liner for the settings panel. */
  summary: string;
}

export interface CostOptions {
  raceHours?: number;
  usage?: UsageAssumptions;
}

const formatUsd = (usd: number): string => (usd === 0 ? '$0' : `$${usd.toFixed(2)}`);

/** Estimate the configured profile's optional cloud cost (docs/15). Pure + deterministic. */
export const estimateCloudCost = (settings: AppSettings, opts: CostOptions = {}): CostEstimate => {
  const raceHours = opts.raceHours ?? LE_MANS_HOURS;
  const llmUsd = llmHourlyCostUsd(settings.llm, opts.usage);
  const sttUsd = STT_HOURLY_USD[settings.voice.stt];
  const ttsUsd = TTS_HOURLY_USD[settings.voice.tts];
  const hourly: CostBreakdown = { llmUsd, sttUsd, ttsUsd };

  if (llmUsd === null) {
    return {
      isFree: false,
      hourlyUsd: null,
      perRaceUsd: null,
      raceHours,
      hourly,
      summary: 'Cloud LLM — cost depends on your model. Voice is free (local).',
    };
  }

  const hourlyUsd = llmUsd + sttUsd + ttsUsd;
  const perRaceUsd = hourlyUsd * raceHours;
  const isFree = hourlyUsd === 0;
  const summary = isFree
    ? 'Free — $0/hour. The default profile runs fully local at no cost.'
    : `~${formatUsd(hourlyUsd)}/hour · ~${formatUsd(perRaceUsd)} per ${raceHours} h race — billed to your own key (estimate).`;

  return { isFree, hourlyUsd, perRaceUsd, raceHours, hourly, summary };
};
