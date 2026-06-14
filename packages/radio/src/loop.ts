import {
  runRadioTurn,
  type ChatMessage,
  type LlmProvider,
  type Persona,
  type RaceContextProvider,
  type RadioTurnResult,
  type ToolDef,
} from '@race-engineer/ai';
import {
  speak,
  type AudioClip,
  type RadioCapture,
  type TtsProvider,
  type VoiceId,
  type VoicePlayer,
} from '@race-engineer/voice';

/**
 * The reactive radio loop (docs/06 §Reactive, docs/07 §PTT flow): push-to-talk wires
 * STT → AI(read-only tools) → streaming TTS end to end.
 *
 * ```
 * PTT down  → barge-in stop the engineer + open the mic (RadioCapture.begin)
 * PTT up    → finalize transcript → runRadioTurn(provider + read-only tools)
 *           → speak the reply as sentence-streamed TTS on the VoicePlayer
 * ```
 *
 * Every dependency is injected and provider-agnostic, so the whole loop runs offline against a
 * scripted provider + fake STT/TTS + mock mic/sink (no key, no mic, no game — T5.2 Verify). It
 * is **read-only/advisory throughout**: it reads the mic and phrases tool output; there is no
 * path from here to the game (CLAUDE.md rule 5).
 */

export interface ReactiveRadioLoopEvents {
  /** Final transcript from a PTT exchange, before the LLM turn. */
  onTranscript?: (transcript: string) => void;
  /** The completed LLM turn (spoken text + the tool provenance for every number). */
  onReply?: (result: RadioTurnResult) => void;
  /** The clips enqueued for a reply (the engineer's voiced answer). */
  onSpoken?: (clips: AudioClip[], result: RadioTurnResult) => void;
  /** A turn was abandoned: `empty` (nothing said) or `superseded` (driver re-keyed PTT). */
  onSkipped?: (reason: 'empty' | 'superseded') => void;
  /** The LLM/STT/TTS chain threw; the loop stays alive for the next press. */
  onError?: (err: unknown) => void;
}

export interface ReactiveRadioLoopOptions {
  provider: LlmProvider;
  /** Snapshots the freshest race context at tool-call time (docs/06 §Context). */
  context: RaceContextProvider;
  /** PTT → STT capture (open on press, finalize on release). */
  capture: RadioCapture;
  /** Engineer voice output queue (barge-in on press, sentence-streamed replies). */
  player: VoicePlayer;
  /** Streaming TTS used to voice replies. */
  tts: TtsProvider;
  voice: VoiceId;
  persona?: Persona;
  /** Override the read-only tool set (defaults to the orchestrator's). */
  tools?: readonly ToolDef[];
  /** Max prior exchanges (user+assistant pairs) kept as rolling dialogue history. Default 6. */
  historyLimit?: number;
  events?: ReactiveRadioLoopEvents;
}

const DEFAULT_HISTORY_LIMIT = 6;

export class ReactiveRadioLoop {
  readonly #opts: ReactiveRadioLoopOptions;
  readonly #events: ReactiveRadioLoopEvents;
  readonly #historyLimit: number;
  #history: ChatMessage[] = [];
  /** Bumped on every PTT-down; an in-flight turn aborts speaking if it's been superseded. */
  #generation = 0;
  #inFlight: Promise<void> = Promise.resolve();

  constructor(opts: ReactiveRadioLoopOptions) {
    this.#opts = opts;
    this.#events = opts.events ?? {};
    this.#historyLimit = Math.max(0, opts.historyLimit ?? DEFAULT_HISTORY_LIMIT);
  }

  /** Map an {@link InputReader} PTT edge straight in: `events: { onPtt: (d) => loop.onPtt(d) }`. */
  onPtt(down: boolean): void {
    if (down) {
      this.pttDown();
      return;
    }
    const turn = this.pttUp();
    this.#inFlight = turn.then(
      () => undefined,
      () => undefined,
    );
  }

  /** PTT pressed: stop the engineer (barge-in) and open the mic. */
  pttDown(): void {
    this.#generation += 1;
    this.#opts.player.bargeInStop();
    this.#opts.capture.begin();
  }

  /**
   * PTT released: finalize the transcript, run the LLM tool-loop, and speak the reply. Resolves
   * with the turn result once the reply has been enqueued (or `null` if nothing was said / the
   * chain failed). Safe to `await` in tests; production wiring goes through {@link onPtt}.
   */
  async pttUp(): Promise<RadioTurnResult | null> {
    const myGen = this.#generation;
    const { transcript } = await this.#opts.capture.end();
    const text = transcript.trim();
    if (!text) {
      this.#events.onSkipped?.('empty');
      return null;
    }
    this.#events.onTranscript?.(text);

    try {
      const result = await runRadioTurn({
        provider: this.#opts.provider,
        context: this.#opts.context,
        userMessage: text,
        persona: this.#opts.persona,
        tools: this.#opts.tools,
        history: this.#history,
      });

      // Driver re-keyed PTT while we were thinking — don't talk over the new question.
      if (myGen !== this.#generation) {
        this.#events.onSkipped?.('superseded');
        return result;
      }

      this.#events.onReply?.(result);
      this.#appendHistory(text, result.text);
      const clips = await speak({
        player: this.#opts.player,
        tts: this.#opts.tts,
        voice: this.#opts.voice,
        text: result.text,
        shouldStop: () => myGen !== this.#generation,
      });
      this.#events.onSpoken?.(clips, result);
      return result;
    } catch (err) {
      this.#events.onError?.(err);
      return null;
    }
  }

  /** Abort the current capture without producing a transcript or a turn. */
  cancel(): void {
    this.#generation += 1;
    this.#opts.capture.cancel();
  }

  /** The rolling dialogue history fed to the next turn (docs/06 §Context). */
  get history(): readonly ChatMessage[] {
    return this.#history;
  }

  /** Await the most recent {@link onPtt}-driven turn (tests / graceful shutdown). */
  whenIdle(): Promise<void> {
    return this.#inFlight;
  }

  #appendHistory(user: string, assistant: string): void {
    this.#history.push({ role: 'user', content: user }, { role: 'assistant', content: assistant });
    const max = this.#historyLimit * 2;
    if (this.#history.length > max) this.#history = this.#history.slice(-max);
  }
}
