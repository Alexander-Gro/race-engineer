import type { EngineerEvent } from '@race-engineer/core';
import {
  runProactiveTurn,
  TONE_TAG_INSTRUCTION,
  type ChatMessage,
  type HallucinationReport,
  type LlmProvider,
  type Persona,
  type RaceContextProvider,
} from '@race-engineer/ai';
import {
  parseToneTag,
  speak,
  VoicePriority,
  type AudioClip,
  type TtsProvider,
  type VoiceId,
  type VoicePlayer,
} from '@race-engineer/voice';

/**
 * Proactive call-out routing (docs/06 §Proactive): turn the Event Detector's {@link EngineerEvent}s
 * into engineer audio on the {@link VoicePlayer}. Each event is phrased — LLM-reasoned from the live
 * data by default ({@link engineerPhraser}), or templated as the degraded fallback — and spoken via
 * sentence-streamed TTS. The model phrases; it never computes (CLAUDE.md rule 1). Nothing cuts off a
 * line in progress; call-outs queue and play in priority order (the driver's PTT barge-in is the
 * only interrupt).
 *
 * Read-only/advisory throughout: this produces audio only; nothing here touches the game.
 */

/** Produces the spoken text for an event, or `null` to stay silent. */
export type ProactivePhraser = (event: EngineerEvent) => string | null | Promise<string | null>;

/**
 * Default mapping from an event to a {@link VoicePriority} for the queue. `fuel_low`/`energy_low` are
 * WARNING at their urgent threshold (≤2 laps) and a STRATEGY heads-up otherwise; `box_this_lap` and
 * `blue_flag` are WARNING; Tier-2+ events are CHATTER; everything else is a STRATEGY heads-up. (The
 * rules' own `priority` fields predate the voice scale and aren't reused.) Override via the router.
 */
export const defaultVoicePriority = (event: EngineerEvent): number => {
  if (event.type === 'fuel_low' || event.type === 'energy_low') {
    const threshold = event.payload.thresholdLaps;
    return typeof threshold === 'number' && threshold <= 2
      ? VoicePriority.WARNING
      : VoicePriority.STRATEGY;
  }
  if (event.type === 'box_this_lap' || event.type === 'blue_flag') return VoicePriority.WARNING;
  if (event.type === 'pit_window_open') return VoicePriority.STRATEGY; // strategy heads-up, not chatter
  if (event.tier >= 2) return VoicePriority.CHATTER;
  return VoicePriority.STRATEGY;
};

/**
 * Free/offline default phraser (docs/15 §template mode): deterministic templates, no LLM. Only
 * reads numbers already in the event payload. Returns `null` for events it has no template for.
 */
export const templatePhraser: ProactivePhraser = (event) => {
  switch (event.type) {
    case 'fuel_low': {
      const laps = event.payload.lapsRemaining;
      if (typeof laps !== 'number') return 'Fuel is getting low.';
      const whole = Math.max(0, Math.floor(laps)); // conservative: at least this many full laps
      return whole <= 1
        ? 'Fuel critical — box this lap.'
        : `Fuel's low — about ${whole} laps left.`;
    }
    case 'energy_low': {
      const laps = event.payload.lapsRemaining;
      if (typeof laps !== 'number') return 'Virtual energy is getting low.';
      const whole = Math.max(0, Math.floor(laps)); // conservative: at least this many full laps
      return whole <= 1
        ? 'Energy critical — box this lap.'
        : `Energy's low — about ${whole} laps left.`;
    }
    case 'tire_temp_out_of_window': {
      const dir = event.payload.direction;
      if (dir === 'hot') return 'Tyres are overheating — ease off to bring them back.';
      if (dir === 'cold') return 'Tyres are below temperature — push to get some heat in.';
      return 'Tyres are out of their window.';
    }
    case 'tire_temp_recovered':
      return 'Tyres are up to temperature now.';
    case 'strategy_update': {
      const kind = event.payload.kind;
      if (kind === 'energy-save') {
        const pct = event.payload.savePerLapPct;
        return typeof pct === 'number'
          ? `Strategy: you're energy-limited — save about ${pct.toFixed(1)}% a lap to make the window.`
          : "Strategy: you're energy-limited — start saving to make the window.";
      }
      if (kind === 'fuel-save') {
        const litres = event.payload.savePerLapLiters;
        return typeof litres === 'number'
          ? `Strategy: fuel's tight — save about ${litres.toFixed(2)} a lap to make the window.`
          : "Strategy: fuel's tight — start saving to make the window.";
      }
      return 'Strategy update.';
    }
    case 'pit_window_open': {
      const earliest = event.payload.earliestLap;
      const latest = event.payload.latestLap;
      return typeof earliest === 'number' && typeof latest === 'number'
        ? `Pit window's open — lap ${earliest} to ${latest}.`
        : 'Pit window is open.';
    }
    case 'box_this_lap':
      return 'Box this lap.';
    default:
      return null;
  }
};

/** Short proactive system prompt (docs/06 §Proactive): one natural call-out from structured data. */
export const PROACTIVE_SYSTEM_PROMPT = `You are the driver's race engineer on the radio. A race event just occurred. Produce ONE short, natural call-out (a sentence or two): concise, numbers first. Use ONLY the numbers in the event data, exactly as given — never invent or recompute a number. You cannot change anything in the car; if action is needed, tell the driver the exact change. Output only the spoken words.

${TONE_TAG_INSTRUCTION}`;

export interface LlmPhraserOptions {
  /** Override the proactive system prompt. */
  system?: string;
}

/**
 * LLM-backed phraser (docs/06 §Proactive): hand the event data to a provider and let it phrase a
 * single call-out. Provider-agnostic (Ollama / free cloud tier / BYO-key Claude). No tools — the
 * numbers come from the event payload (the strategy engine already computed them); the prompt
 * instructs the model to quote them verbatim, upholding "the LLM never computes numbers".
 */
export const llmPhraser =
  (provider: LlmProvider, opts: LlmPhraserOptions = {}): ProactivePhraser =>
  async (event) => {
    const res = await provider.complete({
      system: opts.system ?? PROACTIVE_SYSTEM_PROMPT,
      messages: [
        { role: 'user', content: `Event: ${event.type}. Data: ${JSON.stringify(event.payload)}.` },
      ],
      tools: [],
    });
    const text = res.text?.trim();
    return text && text.length > 0 ? text : null;
  };

export interface EngineerPhraserOptions {
  provider: LlmProvider;
  /** Snapshots the freshest race context each call, so the engineer reasons over live data. */
  context: RaceContextProvider;
  persona?: Persona;
  /** Override the proactive system prompt. */
  system?: string;
  /**
   * Degraded fallback (CLAUDE.md vision): used only when the reasoning turn can't run — no
   * telemetry yet, the provider errored, a cost cap was hit, or we're offline. **Not** used when the
   * engineer deliberately stays silent (that returns `null` and the call is correctly dropped).
   * Defaults to {@link templatePhraser}.
   */
  fallback?: ProactivePhraser;
  /**
   * Observability hook fired when the AI turn throws and we degrade to {@link fallback}. Without it
   * a failing provider (e.g. Ollama not running) silently produces pre-written call-outs with no
   * clue why — wire this to a log so the degrade is visible.
   */
  onFallback?: (error: unknown, event: EngineerEvent) => void;
  /**
   * Recent call-outs (oldest→newest) fed to the engineer as prior turns, so it doesn't repeat a call
   * the driver already heard (the skill's "the driver remembers" rule, now with the actual data).
   * Snapshotted per call so it always reflects what's been said.
   */
  history?: () => ChatMessage[];
  /**
   * Fired when a generated call-out is **dropped** because a spoken number couldn't be traced to a
   * tool result this turn (hallucination guard). For an unsolicited call, silence beats a wrong
   * number — wire this to a log so the drop is visible.
   */
  onHallucination?: (report: HallucinationReport, event: EngineerEvent) => void;
}

/**
 * The **context-aware engineer phraser** — the vision's default proactive voice (CLAUDE.md). Routes
 * each flagged event through {@link runProactiveTurn}, so the engineer reads the whole live
 * situation via its read-only tools, reasons about the cause, and decides whether (and what) to say.
 * Returns `null` when the engineer judges the moment isn't worth a word (the router then stays
 * silent). Falls back to {@link templatePhraser} (or a supplied fallback) only on failure — never
 * computing numbers itself, never reaching a write path.
 */
export const engineerPhraser =
  (opts: EngineerPhraserOptions): ProactivePhraser =>
  async (event) => {
    try {
      const result = await runProactiveTurn({
        provider: opts.provider,
        context: opts.context,
        event,
        persona: opts.persona,
        system: opts.system,
        ...(opts.history ? { history: opts.history() } : {}),
      });
      // Never voice an unverified number on an unsolicited call — drop it (silence > a wrong number).
      if (result.text && !result.hallucination.grounded) {
        opts.onHallucination?.(result.hallucination, event);
        return null;
      }
      return result.text; // string to speak, or null = the engineer chose silence
    } catch (err) {
      // No telemetry yet / provider error / cost cap / offline → degraded template fallback.
      // Surface it (don't swallow): a silently-failing provider looks like "pre-written call-outs".
      opts.onFallback?.(err, event);
      return (opts.fallback ?? templatePhraser)(event);
    }
  };

export type RoutedOutcome =
  | { kind: 'spoken'; event: EngineerEvent; text: string; clips: AudioClip[]; priority: number }
  | { kind: 'skipped'; event: EngineerEvent; reason: 'no-audio' };

export interface ProactiveVoiceRouterOptions {
  player: VoicePlayer;
  /** TTS for phrased call-outs. */
  tts: TtsProvider;
  voice: VoiceId;
  /** Phraser for events. Default {@link templatePhraser}; the vision default is {@link engineerPhraser}. */
  phrase?: ProactivePhraser;
  /** Event → queue priority. Default {@link defaultVoicePriority}. */
  priorityFor?: (event: EngineerEvent) => number;
}

export class ProactiveVoiceRouter {
  readonly #player: VoicePlayer;
  readonly #tts: TtsProvider;
  readonly #voice: VoiceId;
  readonly #phrase: ProactivePhraser;
  readonly #priorityFor: (event: EngineerEvent) => number;

  constructor(opts: ProactiveVoiceRouterOptions) {
    this.#player = opts.player;
    this.#tts = opts.tts;
    this.#voice = opts.voice;
    this.#phrase = opts.phrase ?? templatePhraser;
    this.#priorityFor = opts.priorityFor ?? defaultVoicePriority;
  }

  /** Route one event to the voice queue: phrase it, then synthesize + enqueue (or skip if silent). */
  async route(event: EngineerEvent): Promise<RoutedOutcome> {
    const priority = this.#priorityFor(event);
    const raw = (await this.#phrase(event))?.trim();
    if (!raw) return { kind: 'skipped', event, reason: 'no-audio' };
    // Split the LLM's leading tone tag from the words: `text` is the clean spoken line (for the
    // transcript/log/tests), `tone` drives the voice. `speak()` also strips the tag from audio, so
    // passing the raw line would be safe too — we parse here to keep the outcome's `text` clean.
    const { tone, text } = parseToneTag(raw);
    if (!text) return { kind: 'skipped', event, reason: 'no-audio' };
    const clips = await speak({
      player: this.#player,
      tts: this.#tts,
      voice: this.#voice,
      text,
      priority,
      delivery: { tone },
    });
    return { kind: 'spoken', event, text, clips, priority };
  }

  /** Route a batch (one detector tick) in order; higher-priority calls play first via the queue. */
  async routeAll(events: readonly EngineerEvent[]): Promise<RoutedOutcome[]> {
    const outcomes: RoutedOutcome[] = [];
    for (const event of events) outcomes.push(await this.route(event));
    return outcomes;
  }
}
