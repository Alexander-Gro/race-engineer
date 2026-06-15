import type { RaceContext } from './context';
import { templateAnswer } from './template';

/**
 * The free/offline/no-key "ask the engineer" entry point (docs/15 §free routes). It always returns
 * a spoken-style answer: {@link templateAnswer} (template mode — reads the read-only tools and quotes
 * their numbers verbatim, no LLM) when an intent matches, else a short guiding fallback.
 *
 * This is the seam where a configured LLM (Ollama / cloud BYO-key) plugs in later: when template mode
 * declines, a caller with a provider can route the question through `runRadioTurn` instead of taking
 * this fallback. Read-only/advisory — it phrases tool output and never computes numbers or touches
 * the game (CLAUDE.md rules 1 & 5).
 */
export const ASK_FALLBACK =
  "I didn't catch that — try asking about fuel, tyres, your position, last lap, or when to pit.";

/** Answer a typed/spoken question for free (template mode), falling back to a short prompt. */
export const askEngineer = (question: string, ctx: RaceContext): string =>
  templateAnswer(question, ctx) ?? ASK_FALLBACK;
