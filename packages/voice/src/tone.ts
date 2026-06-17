/**
 * **Vocal tone** — the emotional register the engineer speaks a line in (docs/06 the vision: the AI
 * generates the words *and how they're felt*; the voice speaks it). The LLM picks the tone from the
 * live moment (a routine fuel read is `calm`; "box this lap" under an FCY is `urgent`; a personal
 * best is `upbeat`), tags it on the front of its reply, and the TTS layer renders it — Piper bends
 * its `length_scale`/`noise` knobs, the cloud voice takes a literal tone instruction. This is what
 * turns the flat, monotone default into a voice with situational emotion.
 *
 * It is **delivery only** — it never changes *what* is said or any number (the hard rules in
 * CLAUDE.md hold); it changes only the pace/energy/pitch the words are spoken with. Absent ⇒ `calm`,
 * the neutral default, so an untagged reply (older model, fallback path) still sounds natural.
 */

/** The emotional register a line is spoken in. Keep in sync with the model-facing instruction in `@race-engineer/ai`. */
export type VocalTone = 'calm' | 'urgent' | 'upbeat' | 'serious';

/** All tones, in tag order — the canonical set the parser accepts and the prompt advertises. */
export const VOCAL_TONES: readonly VocalTone[] = ['calm', 'urgent', 'upbeat', 'serious'];

/** The neutral default when a reply carries no tag (fallback paths, older models). */
export const DEFAULT_TONE: VocalTone = 'calm';

/** How the engineer is asked to express how it generates audio (delivery only — never the content). */
export interface VoiceDelivery {
  /** The emotional register to speak in; absent ⇒ {@link DEFAULT_TONE}. */
  tone?: VocalTone;
}

const TONE_SET = new Set<string>(VOCAL_TONES);

/**
 * Synonyms small local models reach for instead of the four canonical tags (e.g. llama emits
 * `[Routine]`, `[Warning]`). Mapped to the nearest register so the *delivery* is still right; any
 * leading bracket word **not** here still resolves to {@link DEFAULT_TONE} and is stripped, so a stray
 * label is never spoken. Keep this generous — it only affects tone choice, never the words.
 */
const TONE_ALIAS: Record<string, VocalTone> = {
  routine: 'calm',
  info: 'calm',
  information: 'calm',
  normal: 'calm',
  neutral: 'calm',
  steady: 'calm',
  ok: 'calm',
  critical: 'urgent',
  alert: 'urgent',
  emergency: 'urgent',
  warning: 'serious',
  caution: 'serious',
  concern: 'serious',
  careful: 'serious',
  positive: 'upbeat',
  happy: 'upbeat',
  good: 'upbeat',
  great: 'upbeat',
  pleased: 'upbeat',
  encouraging: 'upbeat',
};

// A leading bracketed **single alpha-word** label the model emits, e.g. "[urgent] Box this lap." —
// case-insensitive, tolerant of surrounding spaces. Pure letters only, so bracketed *content* that
// carries a digit (`[P3]`, `[51]`) is left alone; a pure-word label is treated as a (mis)tag and
// stripped from the spoken line either way (real radio never voices a "[label]").
const LEADING_TAG = /^\s*\[([a-z]+)\]\s*/i;

/** Resolve a leading bracket word to a tone: a canonical tag, a known synonym, else the default. */
const toneForLabel = (word: string): VocalTone =>
  TONE_SET.has(word) ? (word as VocalTone) : (TONE_ALIAS[word] ?? DEFAULT_TONE);

/**
 * Strip any Markdown the model leaks into a line that is about to be **spoken aloud** (and shown in
 * the transcript/UI). The prompt forbids formatting, but local models slip — so this is the
 * belt-and-braces guarantee that an asterisk, bullet, heading, or backtick never reaches the TTS or
 * the screen. Radio is one breath: newlines and list items collapse to a single spoken sentence.
 * Numbers, words, and ordinary punctuation (incl. mid-sentence hyphens/em-dashes) are untouched.
 */
export const stripSpokenFormatting = (text: string): string =>
  text
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/^\s*#{1,6}\s+/, '') // # headings
        .replace(/^\s*([-*+]|\d+[.)])\s+/, '') // -, *, +, "1." list markers (line start only)
        .trim(),
    )
    .filter((line) => line.length > 0)
    .join(' ')
    .replace(/\*+/g, '') // stray *bold*/*italic* asterisks
    .replace(/`+/g, '') // `code` ticks
    .replace(/\b_{1,2}([^_]+)_{1,2}\b/g, '$1') // _emphasis_ / __strong__ → inner words
    .replace(/\s{2,}/g, ' ')
    .trim();

/**
 * Split a model reply into its (optional) leading tone tag and the **clean spoken words**. The model
 * is asked to prefix exactly one `[calm|urgent|upbeat|serious]` tag, but small local models improvise
 * (`[Routine]`, `[Warning]`) — so any leading bracketed *word* is treated as a tag: a canonical tone or
 * known synonym sets the register, anything else falls back to {@link DEFAULT_TONE}, and **either way
 * the label is stripped** so it is never spoken aloud. Bracketed content carrying a digit (`[P3]`) is
 * left in place. The remainder runs through {@link stripSpokenFormatting} so no Markdown is voiced.
 */
export const parseToneTag = (reply: string): { tone: VocalTone; text: string } => {
  const match = reply.match(LEADING_TAG);
  if (match) {
    return {
      tone: toneForLabel(match[1]!.toLowerCase()),
      text: stripSpokenFormatting(reply.slice(match[0].length)),
    };
  }
  return { tone: DEFAULT_TONE, text: stripSpokenFormatting(reply) };
};
