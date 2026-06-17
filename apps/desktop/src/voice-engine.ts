import type {
  ChatMessage,
  HallucinationReport,
  LlmProvider,
  Persona,
  RaceContext,
} from '@race-engineer/ai';
import type { EngineerEvent } from '@race-engineer/core';
import type { EngineerSnapshot } from '@race-engineer/engineer-core';
import {
  engineerPhraser,
  ProactiveVoiceRouter,
  ReactiveRadioLoop,
  shouldAnnounce,
  templatePhraser,
  type ProactivePhraser,
  type ProactivityLevel,
  type ReactiveRadioLoopEvents,
  type RoutedOutcome,
} from '@race-engineer/radio';
import {
  speak,
  VoicePlayer,
  VoicePriority,
  type AudioSink,
  type RadioCapture,
  type TtsProvider,
  type VoiceId,
} from '@race-engineer/voice';
import { snapshotToRaceContext } from './ask';

/**
 * The shell's **voice integration** (Track A — the voice path). It composes the radio layer
 * (`ProactiveVoiceRouter` + `ReactiveRadioLoop`) over a single {@link VoicePlayer}, and wires it
 * to the Engineer Core's two outputs:
 *
 *  - Core **events** → `routeEvents` → proactive call-outs (`fuel_low` = a templated/LLM phrase).
 *    Wire to `EngineerCore.onEvent` for off-throttle latency.
 *  - Core **snapshots** → `onSnapshot` → the freshest `RaceContext` for the reactive loop's
 *    read-only tools (reusing the {@link snapshotToRaceContext} bridge built for the text-ask path).
 *  - **PTT** edges → `onPtt` → the reactive radio loop (barge-in → STT → AI → streamed TTS).
 *
 * Everything is injected, so the whole thing runs offline against fakes (FakeProvider / FakeTts /
 * MockAudioSink / mock mic) — no key, no mic, no game. The **live half** (T4.5/T6.3/T10.1) swaps in
 * the real OS audio sink, a `getUserMedia` mic, a wheel-button PTT, and a configured provider.
 *
 * The vision (CLAUDE.md): with a `provider`, the proactive phraser defaults to the **context-aware
 * engineer** (`engineerPhraser` → `runProactiveTurn`), which reasons over live data via read-only
 * tools and decides what — if anything — to say; {@link templatePhraser} is the degraded fallback.
 * With no provider it falls back to template phrasing (free/offline). The reactive loop is also
 * provider-based, so it's only built when a `provider` + `capture` are supplied — until then `onPtt`
 * is a no-op.
 *
 * Read-only/advisory throughout: it produces audio and reads the mic; there is no path to the game.
 */
export interface EngineerVoiceDeps {
  // --- Proactive call-outs (free/offline default) — required ---
  /** TTS for phrased (non-reflex) call-outs and reactive replies. */
  tts: TtsProvider;
  /** Where audio goes (MockAudioSink in tests; the OS sink is the live half). */
  sink: AudioSink;
  voice: VoiceId;
  /**
   * Phraser for proactive events. Default: the context-aware `engineerPhraser` when a `provider` is
   * supplied (the vision), else {@link templatePhraser} (free/offline). Pass to override either way.
   */
  phrase?: ProactivePhraser;
  /** Event → queue priority. Defaults to the router's `defaultVoicePriority`. */
  priorityFor?: (event: EngineerEvent) => number;
  /**
   * Fired when the default `engineerPhraser` had to degrade a call-out to the pre-written template
   * because the AI turn threw (provider down / offline). Wire to a log so the degrade isn't silent.
   */
  onProactiveFallback?: (error: unknown, event: EngineerEvent) => void;
  /**
   * Fired when a generated call-out was **dropped** because a spoken number didn't trace to a tool
   * result (hallucination guard) — silence beats a wrong number on an unsolicited call. Wire to a log.
   */
  onProactiveHallucination?: (report: HallucinationReport, event: EngineerEvent) => void;

  // --- Reactive radio loop (PTT → STT → AI → TTS) — optional; supply both to enable ---
  /** LLM provider for `runRadioTurn` (FakeProvider in tests; Ollama/cloud is the live half). */
  provider?: LlmProvider;
  /** PTT → STT capture (mock in tests; a real mic is the live half — T4.5). */
  capture?: RadioCapture;
  persona?: Persona;
  loopEvents?: ReactiveRadioLoopEvents;
}

export class EngineerVoice {
  /** The shared output queue (proactive + reactive both speak through it; priorities arbitrate). */
  readonly player: VoicePlayer;
  /** Routes detected events to engineer audio. */
  readonly router: ProactiveVoiceRouter;
  /** The PTT conversational loop, or `null` until a provider + capture are supplied. */
  readonly loop: ReactiveRadioLoop | null;

  readonly #tts: TtsProvider;
  readonly #voice: VoiceId;
  #latest: EngineerSnapshot | null = null;
  #proactivity: ProactivityLevel = 'normal';
  /** Recent proactive call-outs (oldest→newest), so the engineer doesn't repeat what it just said. */
  readonly #recentCallouts: { trigger: string; text: string }[] = [];

  constructor(deps: EngineerVoiceDeps) {
    this.#tts = deps.tts;
    this.#voice = deps.voice;
    this.player = new VoicePlayer(deps.sink);
    // The vision (CLAUDE.md): when a provider is configured, the proactive voice is the
    // context-aware engineer (it reasons over live data via read-only tools and decides what — if
    // anything — to say). Template phrasing is the degraded fallback only: it's `engineerPhraser`'s
    // own fallback (no telemetry/provider error) and the no-provider default here.
    const phrase: ProactivePhraser =
      deps.phrase ??
      (deps.provider
        ? engineerPhraser({
            provider: deps.provider,
            context: () => this.#requireContext(),
            persona: deps.persona,
            fallback: templatePhraser,
            history: () => this.#calloutHistory(), // so it doesn't repeat what it just said
            ...(deps.onProactiveFallback ? { onFallback: deps.onProactiveFallback } : {}),
            ...(deps.onProactiveHallucination
              ? { onHallucination: deps.onProactiveHallucination }
              : {}),
          })
        : templatePhraser);
    this.router = new ProactiveVoiceRouter({
      player: this.player,
      tts: deps.tts,
      voice: deps.voice,
      phrase,
      priorityFor: deps.priorityFor,
    });

    this.loop =
      deps.provider && deps.capture
        ? new ReactiveRadioLoop({
            provider: deps.provider,
            capture: deps.capture,
            player: this.player,
            tts: deps.tts,
            voice: deps.voice,
            context: () => this.#requireContext(),
            persona: deps.persona,
            events: deps.loopEvents,
          })
        : null;
  }

  /** Keep the freshest snapshot for the reactive loop's read-only tools (wire to the snapshot stream). */
  onSnapshot(snapshot: EngineerSnapshot): void {
    this.#latest = snapshot;
  }

  /** Set how chatty the engineer is (the driver's proactivity setting — T6.3/T8.5). */
  setProactivity(level: ProactivityLevel): void {
    this.#proactivity = level;
  }

  /**
   * Route a batch of detected events to engineer audio and resolve with the outcomes. Each event is
   * first gated by the proactivity level + quiet windows (T8.5): non-urgent chatter is held when the
   * driver is hard on the brakes / cornering, and the level caps chattiness. Spoken outcomes are
   * remembered (no-repeat). Wire to `EngineerCore.onEvent`; ignore the promise (`void`) or `await` it.
   */
  async routeEvents(events: readonly EngineerEvent[]): Promise<RoutedOutcome[]> {
    const inputs = this.#latest?.raceState.player.inputs;
    const allowed = events.filter((event) =>
      shouldAnnounce(event, { level: this.#proactivity, inputs }),
    );
    if (allowed.length === 0) return [];
    const outcomes = await this.router.routeAll(allowed);
    // Remember what was actually said, so the next call-out's history shows it (no repeats).
    for (const o of outcomes) {
      if (o.kind === 'spoken') this.#rememberCallout(o.event.type, o.text);
    }
    return outcomes;
  }

  /** Cap on remembered call-outs fed back as history (keeps the prompt small). */
  static readonly #CALLOUT_MEMORY = 6;
  #rememberCallout(trigger: string, text: string): void {
    this.#recentCallouts.push({ trigger, text });
    if (this.#recentCallouts.length > EngineerVoice.#CALLOUT_MEMORY) this.#recentCallouts.shift();
  }

  /** Recent call-outs as prior turns, so the engineer sees what it already told the driver. */
  #calloutHistory(): ChatMessage[] {
    return this.#recentCallouts.flatMap(({ trigger, text }) => [
      { role: 'user' as const, content: `Monitor flagged: ${trigger}.` },
      { role: 'assistant' as const, content: text },
    ]);
  }

  /** Forward a PTT edge to the reactive loop. No-op until the reactive half is wired (T4.5). */
  onPtt(down: boolean): void {
    this.loop?.onPtt(down);
  }

  /**
   * Speak a reply to the driver's question as sentence-streamed TTS on the shared queue. Plays at
   * CONVERSATION priority by default, so only a Tier-0 safety reflex can cut it off and generic
   * call-outs queue behind it instead of chopping the answer mid-sentence. This is the
   * free/provider-agnostic reactive path (transcript → {@link AskResponder} → here), distinct from
   * the loop's own provider-driven TTS.
   */
  speakReply(text: string, priority: number = VoicePriority.CONVERSATION): Promise<void> {
    if (!text.trim()) return Promise.resolve();
    return speak({ player: this.player, tts: this.#tts, voice: this.#voice, text, priority }).then(
      () => undefined,
    );
  }

  /** Driver keyed PTT: stop the engineer talking and clear pending chatter (barge-in). */
  bargeIn(): void {
    this.player.bargeInStop();
  }

  /** Await any in-flight reactive turn (tests / graceful shutdown). */
  whenIdle(): Promise<void> {
    return this.loop?.whenIdle() ?? Promise.resolve();
  }

  #requireContext(): RaceContext {
    if (this.#latest === null) throw new Error('No telemetry yet — cannot answer.');
    return snapshotToRaceContext(this.#latest);
  }
}
