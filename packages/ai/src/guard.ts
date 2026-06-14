import type { ExecutedToolCall } from './orchestrator';

/**
 * Hallucination guard (docs/06 §Evaluation / §Guardrails): an automated check that **every
 * number the model spoke this turn appears in a tool result from this turn**. The strategy
 * engine and `RaceState` own all numbers; the model only phrases them (CLAUDE.md rule 1). A
 * spoken figure with no source in any tool result is, by construction, invented — this surfaces
 * it for the trust/transcript log and for CI eval (docs/06 §Evaluation).
 *
 * Pure and provider-agnostic — it inspects {@link ExecutedToolCall} provenance, so it works the
 * same for the FakeProvider, Ollama, or any BYO-key cloud model.
 *
 * Scope: digit-form figures (integers, decimals, thousands-grouped like "7,000"). Matching is
 * **rounding-tolerant** (the model may quote 14.18 as "14.2") and **sign-insensitive** (gaps are
 * signed in the tools — −1.5 s ahead — but spoken unsigned with the direction in words: "1.5
 * ahead"; a hyphen in "P3-P5" is punctuation, not a minus). Three known, documented limits:
 * (1) numbers the model *originates* as advice (e.g. "back two clicks") are untraceable by design
 * and report as ungrounded — callers decide severity; (2) worded numerals ("fourteen") are not
 * parsed, so the persona/system prompt should emit digits; (3) because a figure is matched against
 * the *union* of this turn's tool numbers, a fabricated small integer can coincidentally fall
 * within rounding distance of an unrelated tool figure and read as grounded — a number-provenance
 * check cannot tell which tool number the model "meant", so it under-reports there. It is a
 * detection aid, not a proof of correctness.
 */

/** A digit-form number found in spoken text, with provenance for reporting. */
export interface SpokenNumber {
  value: number;
  /** The matched substring, e.g. "14.2" or "218.7". */
  text: string;
  /** Decimal places the speaker used — the precision tool figures are rounded to when matching. */
  decimals: number;
}

export interface HallucinationReport {
  /** True when every spoken figure traces to a tool result this turn. */
  grounded: boolean;
  /** Spoken figures with no source in any tool result this turn (the suspected hallucinations). */
  ungrounded: SpokenNumber[];
  /** How many spoken figures were checked. */
  checked: number;
}

// Thousands-grouped ("7,000") or plain digits, with an optional decimal part. No leading sign:
// the guard is sign-insensitive, and a hyphen before digits ("P3-P5", "lap-2") is punctuation,
// not a minus — so we extract the magnitude and compare on |value|.
const NUMBER_RE = /\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g;

/** Pull digit-form numbers (thousands-grouped or plain, with an optional decimal) out of text. */
export const extractNumbers = (text: string): SpokenNumber[] => {
  const out: SpokenNumber[] = [];
  for (const m of text.matchAll(NUMBER_RE)) {
    const raw = m[0];
    const value = Number(raw.replace(/,/g, ''));
    if (!Number.isFinite(value)) continue;
    // Commas only ever precede the decimal point, so they don't affect the fractional count.
    const dot = raw.indexOf('.');
    out.push({ value, text: raw, decimals: dot === -1 ? 0 : raw.length - dot - 1 });
  }
  return out;
};

/** Collect every finite number appearing anywhere in this turn's tool results (walks nested JSON). */
export const collectToolNumbers = (toolCalls: readonly ExecutedToolCall[]): number[] => {
  const nums: number[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === 'number') {
      if (Number.isFinite(v)) nums.push(v);
    } else if (Array.isArray(v)) {
      for (const item of v) walk(item);
    } else if (v && typeof v === 'object') {
      for (const item of Object.values(v)) walk(item);
    }
  };
  for (const call of toolCalls) walk(call.result);
  return nums;
};

const roundTo = (n: number, decimals: number): number => {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
};

/**
 * Is a spoken figure traceable to some tool number? Grounded when, for any tool number `t`,
 * `|t|` rounded to the speaker's precision equals `|spoken|` (within `absTol` for float noise).
 */
const isGrounded = (
  spoken: SpokenNumber,
  toolNumbers: readonly number[],
  absTol: number,
): boolean => {
  const s = Math.abs(spoken.value);
  for (const t of toolNumbers) {
    const a = Math.abs(t);
    if (Math.abs(a - s) <= absTol) return true;
    if (Math.abs(roundTo(a, spoken.decimals) - s) <= absTol) return true;
  }
  return false;
};

/**
 * Check that every number spoken in `result.text` traces to a tool result in `result.toolCalls`.
 * Returns the ungrounded figures (empty ⇒ `grounded: true`).
 */
export const checkSpokenNumbers = (
  result: { text: string; toolCalls: readonly ExecutedToolCall[] },
  opts: { absTol?: number } = {},
): HallucinationReport => {
  const absTol = opts.absTol ?? 1e-6;
  const spoken = extractNumbers(result.text);
  const toolNumbers = collectToolNumbers(result.toolCalls);
  const ungrounded = spoken.filter((s) => !isGrounded(s, toolNumbers, absTol));
  return { grounded: ungrounded.length === 0, ungrounded, checked: spoken.length };
};
