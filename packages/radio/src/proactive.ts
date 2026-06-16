import type { EngineerEvent, EventType } from '@race-engineer/core';
import type { LlmProvider } from '@race-engineer/ai';
import {
  speak,
  VoicePriority,
  type AudioClip,
  type TtsProvider,
  type VoiceId,
  type VoicePlayer,
} from '@race-engineer/voice';

/**
 * Proactive call-out routing (docs/06 §Proactive, docs/01 §Latency tiers): turn the Event
 * Detector's {@link EngineerEvent}s into engineer audio on the {@link VoicePlayer}, each on the
 * right tier.
 *
 *  - **Tier-0 reflex** (`car_left` / `car_right` / `three_wide` / `clear`) → a **pre-rendered**
 *    clip, played at near-zero latency. **Never an LLM round-trip and never live synthesis**
 *    (CLAUDE.md rule 2): the clip comes straight from {@link prerenderTier0}'s map.
 *  - **Tier 1+** (`fuel_low`, …) → a short phrase (LLM-phrased or templated) spoken via
 *    sentence-streamed TTS. The phrase only ever *reads back* numbers the strategy engine put in
 *    the event payload — the model phrases, it never computes (CLAUDE.md rule 1).
 *
 * Read-only/advisory throughout: this produces audio only; nothing here touches the game.
 */

/** Produces the spoken text for a (non-reflex) event, or `null` to stay silent. */
export type ProactivePhraser = (event: EngineerEvent) => string | null | Promise<string | null>;

const URGENT_REFLEX = new Set<EventType>(['car_left', 'car_right', 'three_wide']);

/**
 * Default mapping from an event to a {@link VoicePriority} for the queue. Urgent reflex calls
 * preempt (SPOTTER); a `clear` release just queues (STRATEGY); `fuel_low` is a WARNING at its
 * urgent threshold (≤2 laps) and a STRATEGY heads-up otherwise. (The rules' own `priority`
 * fields predate the voice scale and aren't reused directly.) Override via the router options.
 */
export const defaultVoicePriority = (event: EngineerEvent): number => {
  if (URGENT_REFLEX.has(event.type)) return VoicePriority.SPOTTER;
  if (event.type === 'fuel_low' || event.type === 'energy_low') {
    const threshold = event.payload.thresholdLaps;
    return typeof threshold === 'number' && threshold <= 2
      ? VoicePriority.WARNING
      : VoicePriority.STRATEGY;
  }
  if (event.type === 'box_this_lap' || event.type === 'blue_flag') return VoicePriority.WARNING;
  if (event.type === 'pit_window_open') return VoicePriority.STRATEGY; // strategy heads-up, not chatter
  if (event.tier >= 2) return VoicePriority.CHATTER;
  return VoicePriority.STRATEGY; // `clear` + other Tier-1 proactive call-outs
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
export const PROACTIVE_SYSTEM_PROMPT = `You are the driver's race engineer on the radio. A race event just occurred. Produce ONE short, natural call-out (a sentence or two): calm, concise, numbers first. Use ONLY the numbers in the event data, exactly as given — never invent or recompute a number. You cannot change anything in the car; if action is needed, tell the driver the exact change. Output only the spoken words.`;

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

export type RoutedOutcome =
  | { kind: 'prerendered'; event: EngineerEvent; clip: AudioClip; priority: number }
  | { kind: 'spoken'; event: EngineerEvent; text: string; clips: AudioClip[]; priority: number }
  | { kind: 'skipped'; event: EngineerEvent; reason: 'no-audio' };

export interface ProactiveVoiceRouterOptions {
  player: VoicePlayer;
  /** Pre-rendered Tier-0 clips keyed by event type (from {@link prerenderTier0}). */
  tier0Clips: ReadonlyMap<string, AudioClip>;
  /** TTS for phrased (Tier 1+) call-outs. */
  tts: TtsProvider;
  voice: VoiceId;
  /** Phraser for non-reflex events. Default {@link templatePhraser}; swap in {@link llmPhraser}. */
  phrase?: ProactivePhraser;
  /** Event → queue priority. Default {@link defaultVoicePriority}. */
  priorityFor?: (event: EngineerEvent) => number;
}

export class ProactiveVoiceRouter {
  readonly #player: VoicePlayer;
  readonly #tier0Clips: ReadonlyMap<string, AudioClip>;
  readonly #tts: TtsProvider;
  readonly #voice: VoiceId;
  readonly #phrase: ProactivePhraser;
  readonly #priorityFor: (event: EngineerEvent) => number;

  constructor(opts: ProactiveVoiceRouterOptions) {
    this.#player = opts.player;
    this.#tier0Clips = opts.tier0Clips;
    this.#tts = opts.tts;
    this.#voice = opts.voice;
    this.#phrase = opts.phrase ?? templatePhraser;
    this.#priorityFor = opts.priorityFor ?? defaultVoicePriority;
  }

  /** Route one event to the voice queue. Reflex events enqueue a pre-rendered clip synchronously. */
  async route(event: EngineerEvent): Promise<RoutedOutcome> {
    const priority = this.#priorityFor(event);
    const clip = this.#tier0Clips.get(event.type);
    if (clip) {
      // Tier-0: pre-rendered, no synth, no LLM — hits the queue immediately (docs/01 Tier 0).
      this.#player.enqueue(clip, priority);
      return { kind: 'prerendered', event, clip, priority };
    }
    const text = (await this.#phrase(event))?.trim();
    if (!text) return { kind: 'skipped', event, reason: 'no-audio' };
    const clips = await speak({
      player: this.#player,
      tts: this.#tts,
      voice: this.#voice,
      text,
      priority,
    });
    return { kind: 'spoken', event, text, clips, priority };
  }

  /**
   * Route a batch (one detector tick). Reflex (pre-rendered) events are enqueued **first** so a
   * spotter call never waits behind a phrased call-out's TTS synthesis — preserving the Tier-0
   * latency budget. Returns outcomes in original event order.
   */
  async routeAll(events: readonly EngineerEvent[]): Promise<RoutedOutcome[]> {
    const outcomes = new Array<RoutedOutcome>(events.length);
    const reflex: number[] = [];
    const phrased: number[] = [];
    events.forEach((e, i) => (this.#tier0Clips.has(e.type) ? reflex : phrased).push(i));
    for (const i of reflex) outcomes[i] = await this.route(events[i]!);
    for (const i of phrased) outcomes[i] = await this.route(events[i]!);
    return outcomes;
  }
}
