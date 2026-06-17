import type { EngineerEvent } from '@race-engineer/core';
import type { RaceContextProvider } from './context';
import { checkSpokenNumbers, type HallucinationReport } from './guard';
import { runRadioTurn, type ExecutedToolCall } from './orchestrator';
import { buildSystemPrompt, type Persona } from './prompt';
import type { ToolDef } from './tools';
import type { ChatMessage, LlmProvider } from './types';

/**
 * The **proactive engineer turn** (docs/06 §Proactive, the vision in CLAUDE.md): turn a detector
 * trigger into a *reasoned* radio call — the same tool-driven LLM that answers the driver
 * ({@link runRadioTurn}), now driving the proactive call-outs too. The deterministic event rules
 * are demoted from "author of the words" to "a background monitor that flags a candidate moment";
 * the engineer reads the **whole** live situation through its read-only tools (session phase, lap,
 * the car's state, what just changed), works out the *cause* — not just the symptom — and decides
 * whether the moment is even worth the radio.
 *
 * This is what makes the engineer reason instead of recite: cold tyres on the formation lap become
 * "they'll be cold for the start, ease in — I'll tell you when they're in" (or silence), not a flat
 * "tyres are cold, push". It upholds the hard rules unchanged — numbers come only from tools
 * (CLAUDE.md rule 1), there is no write path (rule 5). Template phrasing is the degraded fallback
 * only, wired one layer up in the radio package.
 */

/** The model emits exactly this when it judges the flagged moment isn't worth a word. */
export const PROACTIVE_SILENT = 'SILENT';

/**
 * Proactive addendum to the standing engineer prompt ({@link buildSystemPrompt}, which already
 * carries the "speak only when it changes what the driver does or knows; most of the time stay
 * silent" playbook). It frames the detector trigger as a *candidate*, demands cause-level reasoning
 * from the tools, and gives the engineer an explicit way to stay silent.
 */
export const PROACTIVE_ADDENDUM = `# This turn: a flagged moment, not a script
A background telemetry monitor just flagged a candidate moment (below). It is a raw signal only — a
threshold tripped — NOT something to read aloud. You decide whether it deserves the radio at all.

Use your tools to read the full live situation — session phase, lap, the car's state, what just
changed — and reason about the *cause*, not just the symptom (e.g. cold tyres on the formation lap or
first laps of a stint are expected, not a problem; a hot corner right after a moment off-track is the
spin, not a setup issue). Then do exactly one of:
- key the radio with the single most useful thing a real engineer would say *right now* — numbers
  from tools only, brief, with the action or the reassurance the driver actually needs, opened with
  its tone tag; or
- if it's expected, already known, mid-corner, or simply not worth a word, reply with exactly
  ${PROACTIVE_SILENT} and nothing else (no tone tag).

Output only the tagged spoken radio call, or ${PROACTIVE_SILENT}.`;

export interface ProactiveTurnInput {
  provider: LlmProvider;
  /** Snapshots the freshest race context each time a tool runs (docs/06 §Context). */
  context: RaceContextProvider;
  /** The candidate moment the detector flagged — a trigger, not a phrase to recite. */
  event: EngineerEvent;
  /** Override the system prompt; otherwise the standing engineer prompt + proactive addendum. */
  system?: string;
  persona?: Persona;
  tools?: readonly ToolDef[];
  /** Prior dialogue/call-out turns, so the engineer doesn't repeat a settled call. */
  history?: ChatMessage[];
  maxToolRounds?: number;
}

export interface ProactiveTurnResult {
  /** The radio call to speak, or `null` if the engineer judged the moment not worth a word. */
  text: string | null;
  /** Every tool run this turn, with its result — the provenance for any number spoken. */
  toolCalls: ExecutedToolCall[];
  rounds: number;
  messages: ChatMessage[];
  /**
   * Hallucination guard for the spoken line (docs/06 §Evaluation): is every number traceable to a
   * tool result this turn? For an *unsolicited* call-out, an ungrounded number is worse than silence —
   * the caller (engineerPhraser) drops the call rather than voice an invented figure.
   */
  hallucination: HallucinationReport;
}

/** Build the proactive system prompt: the standing engineer prompt + the proactive addendum. */
export const buildProactiveSystemPrompt = (persona?: Persona): string =>
  `${buildSystemPrompt(persona)}\n\n${PROACTIVE_ADDENDUM}`;

/** Normalize the model's reply: empty or a bare `SILENT` means "stay quiet" → `null`. */
const toSpokenOrSilent = (text: string): string | null => {
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;
  // Ignore a (mis-emitted) leading tone tag when testing for the sentinel — the tag steers the voice
  // only; "SILENT" with or without it still means stay quiet. The spoken text keeps its tag so the
  // voice layer can read the register (the addendum asks for SILENT *untagged*; this is belt-and-braces).
  const withoutTag = trimmed.replace(/^\[[a-z]+\]\s*/i, '');
  // Tolerate trailing punctuation / casing on the sentinel ("SILENT", "Silent.", "silent").
  if (/^silent[.!]?$/i.test(withoutTag)) return null;
  return trimmed;
};

/**
 * Run one proactive turn: hand the flagged event to the engineer and let it reason over the live
 * context with its read-only tools, returning the radio call to speak — or `null` if it chose
 * silence. Reuses {@link runRadioTurn} verbatim (same tool loop, same read-only registry), so the
 * proactive path can never reach a write path and never computes its own numbers.
 */
export const runProactiveTurn = async (input: ProactiveTurnInput): Promise<ProactiveTurnResult> => {
  const turn = await runRadioTurn({
    provider: input.provider,
    context: input.context,
    userMessage: `Monitor flagged: ${input.event.type}. Raw signal: ${JSON.stringify(input.event.payload)}.`,
    system: input.system ?? buildProactiveSystemPrompt(input.persona),
    tools: input.tools,
    history: input.history,
    maxToolRounds: input.maxToolRounds,
  });
  const text = toSpokenOrSilent(turn.text);
  return {
    text,
    toolCalls: turn.toolCalls,
    rounds: turn.rounds,
    messages: turn.messages,
    // Guard the spoken line only (silence has no numbers to invent).
    hallucination: checkSpokenNumbers({ text: text ?? '', toolCalls: turn.toolCalls }),
  };
};
