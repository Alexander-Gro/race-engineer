import type { LlmProvider, Persona, RaceContext } from '@race-engineer/ai';
import type { EngineerEvent } from '@race-engineer/core';
import type { EngineerSnapshot } from '@race-engineer/engineer-core';
import {
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
  type AudioClip,
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
 *  - Core **events** → `routeEvents` → proactive call-outs (Tier-0 spotter = pre-rendered clip,
 *    `fuel_low` = a templated/LLM phrase). Wire to `EngineerCore.onEvent` for off-throttle latency.
 *  - Core **snapshots** → `onSnapshot` → the freshest `RaceContext` for the reactive loop's
 *    read-only tools (reusing the {@link snapshotToRaceContext} bridge built for the text-ask path).
 *  - **PTT** edges → `onPtt` → the reactive radio loop (barge-in → STT → AI → streamed TTS).
 *
 * Everything is injected, so the whole thing runs offline against fakes (FakeProvider / FakeTts /
 * MockAudioSink / mock mic) — no key, no mic, no game. The **live half** (T4.5/T6.3/T10.1) swaps in
 * the real OS audio sink, a `getUserMedia` mic, a wheel-button PTT, and a configured provider.
 *
 * Free/offline by default: the proactive phraser defaults to {@link templatePhraser} (no LLM). The
 * reactive loop is provider-based (`runRadioTurn`), so it's only built when a `provider` + `capture`
 * are supplied — until then `onPtt` is a no-op. (A no-key *template* voice path can wrap the
 * text-ask `askEngineer` later, mirroring the LLM-free text path.)
 *
 * Read-only/advisory throughout: it produces audio and reads the mic; there is no path to the game.
 */
export interface EngineerVoiceDeps {
  // --- Proactive call-outs (free/offline default) — required ---
  /** TTS for phrased (non-reflex) call-outs and reactive replies. */
  tts: TtsProvider;
  /** Where audio goes (MockAudioSink in tests; the OS sink is the live half). */
  sink: AudioSink;
  /** Pre-rendered Tier-0 spotter clips keyed by event type (from `prerenderTier0`). */
  tier0Clips: ReadonlyMap<string, AudioClip>;
  voice: VoiceId;
  /** Phraser for non-reflex events. Default {@link templatePhraser} (free); swap in `llmPhraser`. */
  phrase?: ProactivePhraser;
  /** Event → queue priority. Defaults to the router's `defaultVoicePriority`. */
  priorityFor?: (event: EngineerEvent) => number;

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

  constructor(deps: EngineerVoiceDeps) {
    this.#tts = deps.tts;
    this.#voice = deps.voice;
    this.player = new VoicePlayer(deps.sink);
    this.router = new ProactiveVoiceRouter({
      player: this.player,
      tier0Clips: deps.tier0Clips,
      tts: deps.tts,
      voice: deps.voice,
      phrase: deps.phrase ?? templatePhraser,
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
   * driver is hard on the brakes / cornering, and the level caps chattiness — but a Tier-0 safety
   * reflex always passes. Wire to `EngineerCore.onEvent`; ignore the promise (`void`) or `await` it.
   */
  routeEvents(events: readonly EngineerEvent[]): Promise<RoutedOutcome[]> {
    const inputs = this.#latest?.raceState.player.inputs;
    const allowed = events.filter((event) =>
      shouldAnnounce(event, { level: this.#proactivity, inputs }),
    );
    return allowed.length === 0 ? Promise.resolve([]) : this.router.routeAll(allowed);
  }

  /** Forward a PTT edge to the reactive loop. No-op until the reactive half is wired (T4.5). */
  onPtt(down: boolean): void {
    this.loop?.onPtt(down);
  }

  /**
   * Speak a conversational reply as sentence-streamed TTS on the shared queue (CHATTER by default, so
   * a spotter/strategy call-out still preempts it). This is the free/provider-agnostic reactive path
   * (transcript → {@link AskResponder} → here), distinct from the loop's own provider-driven TTS.
   */
  speakReply(text: string, priority: number = VoicePriority.CHATTER): Promise<void> {
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
