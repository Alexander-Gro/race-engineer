import type { EngineerEvent, EventType } from '@race-engineer/core';

/**
 * Proactive call-outs spoken aloud (build-plan T10.1 — free/no-key, Web Speech). The Engineer Core
 * already detects events and attaches them to every snapshot (the dashboard paints them as alert
 * chips); this turns that **same event feed** into spoken engineer call-outs — "box this lap", "fuel
 * running low", "pit window open" — using the OS voice, with no key, no model download, no native binary.
 *
 * It is the proactive sibling of the conversational {@link SpeechController} (text-ask replies) and,
 * like it, is deliberately **separate from the docs/07 tiered `VoicePlayer` pipeline** (Piper/Kokoro →
 * `AudioSink`, with payload-number phrasing via the radio `templatePhraser`), which remains T10.1's
 * native/premium half.
 *
 * **Tier-0 reflex spotter calls (`car_left`/`car_right`/`three_wide`) are excluded by design.** docs/01
 * §tiers + docs/07 §interim-TTS require those to be **pre-rendered clips** played through the tiered
 * `VoicePlayer` (the <300 ms safety path) — never a live `speechSynthesis` round-trip. So this free path
 * voices only **Tier ≥ 1** events (a structural guard enforces it). For those, the call-out is a terse,
 * fixed phrase per type — appropriate for an alert ("box this lap"), not a readout; for numbers the
 * driver asks the engineer (the text-ask path). Tier-2 events the premium path would phrase via the LLM
 * get a terse **templated fallback** here — a deliberate degraded mode for the free/no-key profile.
 * No number is invented (CLAUDE.md rule 1) — the detection/strategy math already happened in the Core;
 * this only voices the event, exactly as the dashboard already labels it.
 *
 * Pure over an injected {@link CalloutSpeechPort} (no DOM types), so the priority/preemption logic is
 * unit-tested in Node; the renderer supplies a port wrapping `speechSynthesis`. Output-only — it speaks
 * the engineer's own call-outs and never touches the game (CLAUDE.md rule 5).
 */

/** Terse spoken phrases per event type. Tier ≥ 1 only — Tier-0 reflex spotter calls
 * (`car_left`/`car_right`/`three_wide`) stay on the pre-rendered `VoicePlayer` path (docs/01/07) and are
 * never listed here; markers (`lap_completed`, `clear`, `flag_changed`, `driver_question`) are silent
 * so the engineer isn't chatty. */
export const SPOKEN_PHRASES: Partial<Record<EventType, string>> = {
  // Tier 1 — templated alerts
  fuel_low: 'Fuel running low.',
  tire_temp_out_of_window: 'Tyres are out of their window.',
  pit_window_open: 'Pit window is open.',
  box_this_lap: 'Box this lap.',
  blue_flag: 'Blue flag — faster car coming through.',
  faster_class_approaching: 'Faster class approaching.',
  slower_class_ahead: 'Slower car ahead.',
  // Tier 2 — strategy
  fcy_opportunity: 'Full-course yellow — a cheap stop is on.',
  undercut_opportunity: 'Undercut is on.',
  rival_pitted: 'Your rival just pitted.',
  incident_ahead: 'Incident ahead — take care.',
  strategy_update: 'Strategy update.',
};

/** A call-out ready to speak: the phrase + the event's voice priority (higher preempts). */
export interface SpokenCallout {
  text: string;
  /** From the event's `priority` (docs/04 — for the voice queue; higher preempts lower). */
  priority: number;
  /** The emission id — used to avoid re-speaking the identical event. */
  id: string;
  eventType: EventType;
}

/** Phrase a single event, or `null` if it isn't a speakable call-out. Tier-0 reflex spotter calls are
 * **always** rejected here — they belong to the pre-rendered `VoicePlayer` safety path (docs/01/07),
 * not this live-synthesis path — so even a stray Tier-0 phrase can never reach `speechSynthesis`. */
export const calloutForEvent = (event: EngineerEvent): SpokenCallout | null => {
  if (event.tier === 0) return null;
  const text = SPOKEN_PHRASES[event.type];
  return text ? { text, priority: event.priority, id: event.id, eventType: event.type } : null;
};

/** The minimal speech surface the speaker needs (renderer wraps `speechSynthesis`). `onDone` fires on
 * natural end **or** error, so the speaker always learns the utterance finished. */
export interface CalloutSpeechPort {
  speak(text: string, onDone: () => void): void;
  cancel(): void;
}

export interface CalloutSpeakerOptions {
  /** Start enabled? Default true (proactive call-outs are the headline feature); `null` port disables. */
  enabled?: boolean;
}

/**
 * Speaks the most important pending call-out, with **priority preemption**: a more urgent call-out
 * (e.g. a Tier-0 "car left") cuts off a less urgent one in progress; a less-or-equally urgent call-out
 * that arrives while one is speaking is **dropped, not queued** — a stale "box this lap" three seconds
 * late is worse than silence. Events are already deduped/cooled-down by the Core's detector, so the
 * same emission won't re-fire; an id guard covers re-delivery.
 */
export class CalloutSpeaker {
  readonly #port: CalloutSpeechPort | null;
  #enabled: boolean;
  #current: { priority: number } | null = null;
  #lastId: string | null = null;

  constructor(port: CalloutSpeechPort | null, options: CalloutSpeakerOptions = {}) {
    this.#port = port;
    this.#enabled = (options.enabled ?? true) && port !== null;
  }

  /** Whether a speech device is present (false ⇒ hide the toggle, stay silent). */
  get available(): boolean {
    return this.#port !== null;
  }

  get enabled(): boolean {
    return this.#enabled;
  }

  /** Turn call-outs on/off; turning off stops anything in progress. No-op without a port. */
  setEnabled(on: boolean): void {
    this.#enabled = on && this.#port !== null;
    if (!this.#enabled) this.#stop();
  }

  /**
   * Speak the highest-priority speakable call-out in this batch (one detector tick / snapshot). Lower
   * priority is silent if it can't preempt the current call-out. No-op when muted or with no port.
   */
  announce(events: readonly EngineerEvent[]): void {
    if (!this.#enabled || this.#port === null) return;
    let top: SpokenCallout | null = null;
    for (const event of events) {
      const callout = calloutForEvent(event);
      if (callout && (top === null || callout.priority > top.priority)) top = callout;
    }
    if (top === null || top.id === this.#lastId) return; // nothing to say / already said this one
    if (this.#current !== null && top.priority <= this.#current.priority) return; // can't preempt → drop
    this.#speak(top);
  }

  /** Stop any in-progress call-out (e.g. before a conversational reply, or on mute). */
  stop(): void {
    this.#stop();
  }

  #speak(callout: SpokenCallout): void {
    this.#port?.cancel(); // preempt whatever's speaking
    this.#current = { priority: callout.priority };
    this.#lastId = callout.id;
    this.#port?.speak(callout.text, () => {
      // Only clear if this is still the active utterance (a later preempt may have replaced it).
      if (this.#current?.priority === callout.priority && this.#lastId === callout.id) {
        this.#current = null;
      }
    });
  }

  #stop(): void {
    this.#port?.cancel();
    this.#current = null;
  }
}
