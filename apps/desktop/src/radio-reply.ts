/**
 * Reactive radio reply (build-plan T10.1, voice loop slice 3, docs/06/07). Ties the three voice-loop
 * pieces together: a push-to-talk edge → capture the radio (slice 2 mic-in) → answer it → speak the
 * answer out (slice 1 audio-out). The answer comes from the **provider-aware `AskResponder`** (free
 * template mode by default; the configured LLM when one is set — hallucination-guarded either way), so
 * the spoken radio reply uses the *same* grounded brain as the text-ask, just triggered by voice and
 * spoken rather than typed and displayed.
 *
 * Pure over injected ports — fully unit-tested with a fake capture / answer / speak. Read-only/advisory:
 * it reads the mic and produces audio; nothing flows toward the game (CLAUDE.md rule 5).
 */

/** The capture surface this orchestrator drives (a {@link RadioCapture}, narrowed for testability). */
export interface ReplyCapture {
  begin(): void;
  end(): Promise<{ transcript: string }>;
}

export interface RadioReplyDeps {
  capture: ReplyCapture;
  /** Answer the transcript (the worker passes `AskResponder.answer` — template or configured LLM). */
  answer: (question: string) => Promise<string>;
  /** Speak a reply as sentence-streamed TTS (the worker passes `EngineerVoice.speakReply`). */
  speak: (text: string) => void;
  /** Stop the engineer mid-sentence when the driver keys PTT to talk (barge-in). */
  bargeIn: () => void;
  /** Optional observability hook (logging/tests): what was heard, and what's being said back. */
  onEvent?: (event: { kind: 'heard' | 'reply'; text: string }) => void;
}

export interface RadioReply {
  /** A PTT edge: down → barge-in + open capture; up → finalize, answer, speak. */
  onPtt(down: boolean): void;
  /** Resolves once any in-flight answer/speak settles (tests / graceful shutdown). */
  whenIdle(): Promise<void>;
}

export const createRadioReply = (deps: RadioReplyDeps): RadioReply => {
  let pending: Promise<void> = Promise.resolve();

  const handleUp = async (): Promise<void> => {
    const { transcript } = await deps.capture.end();
    const question = transcript.trim();
    if (!question) return; // released without speaking → nothing to answer
    deps.onEvent?.({ kind: 'heard', text: question });
    const reply = await deps.answer(question);
    if (!reply.trim()) return;
    deps.onEvent?.({ kind: 'reply', text: reply });
    deps.speak(reply);
  };

  return {
    onPtt(down: boolean): void {
      if (down) {
        deps.bargeIn(); // the driver takes the mic — stop the engineer talking
        deps.capture.begin();
      } else {
        // Chain so whenIdle() (and barge-in ordering) is deterministic; never reject the chain.
        pending = pending.then(handleUp).catch(() => undefined);
      }
    },
    whenIdle(): Promise<void> {
      return pending;
    },
  };
};
