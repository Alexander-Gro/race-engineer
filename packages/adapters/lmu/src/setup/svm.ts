import type { SetupSummary } from '@race-engineer/core';

/**
 * Read-only parser for the LMU/rF2 `.svm` setup file (build-plan T9.1, spike S4, docs/03 §S4.2).
 * The `.svm` is an INI-style text file: `[SECTION]` headers and `Key=<value>//<display comment>`
 * entries. **The stored value is a 0-based setting index (or a delta vs the default), NOT the
 * physical number the garage UI shows** — base/step live in the car data, not the file, so the UI
 * value can't be reconstructed from the `.svm` alone (docs/03 §S4.2). So this parser reliably yields:
 *   - the **section/key structure** (what settings exist),
 *   - the **stored index** per setting (for delta-vs-reference / "X clicks" advice), and
 *   - the trailing **display comment** (the human-readable note the file carries).
 *
 * Pure (parses a string — the file read + location are the Windows-runtime/rig half, docs/03 §S4.1)
 * and **read-only** (CLAUDE.md rule 5: we parse setups to *advise* relative changes; we never write a
 * setup). Section/key names + which keys map to TC/ABS/brake-bias/etc. are **LIVE-VERIFY** on the rig.
 */

export interface SvmEntry {
  key: string;
  /** Stored 0-based setting index (or delta), or null when the value token isn't numeric. */
  index: number | null;
  /** The trailing `//comment` display text (UI-facing note), or null. */
  display: string | null;
  /** The raw value token before the `//`, verbatim. */
  raw: string;
}

export interface ParsedSetup {
  /** Section name (as written, e.g. `FRONTLEFT`) → its entries, in file order. */
  sections: Record<string, SvmEntry[]>;
}

const SECTION_RE = /^\[(.+)\]$/;

/** Parse `.svm` text into a structured setup. Tolerant: blank lines, comment lines, and malformed
 * entries are skipped; entries before the first section land under the `''` (root) section. */
export const parseSvm = (text: string): ParsedSetup => {
  const sections: Record<string, SvmEntry[]> = {};
  let current = '';
  const ensure = (name: string): SvmEntry[] => (sections[name] ??= []);

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('//') || line.startsWith(';') || line.startsWith('#')) {
      continue; // blank or comment-only line
    }
    const section = SECTION_RE.exec(line);
    if (section) {
      current = section[1]!.trim();
      ensure(current);
      continue;
    }
    const eq = line.indexOf('=');
    if (eq <= 0) continue; // not a `Key=Value` entry → skip (tolerant)

    const key = line.slice(0, eq).trim();
    const valuePart = line.slice(eq + 1);
    const commentAt = valuePart.indexOf('//');
    const raw = (commentAt >= 0 ? valuePart.slice(0, commentAt) : valuePart).trim();
    const display = commentAt >= 0 ? valuePart.slice(commentAt + 2).trim() || null : null;
    const n = Number(raw);
    const index = raw !== '' && Number.isFinite(n) ? n : null;
    ensure(current).push({ key, index, display, raw });
  }
  return { sections };
};

/**
 * Flatten a parsed setup into the canonical {@link SetupSummary}. Each entry becomes a `SECTION.Key`
 * param whose value is the **display comment** when present (the human-readable note), else the stored
 * index, else null. The display text is **LIVE-VERIFY** (it may be relative/indexed, not absolute) —
 * prefer live sources (SHM brake bias, REST aids) for current absolute values; use this for structure.
 */
export const setupSummaryFromSvm = (text: string, name: string | null = null): SetupSummary => {
  const { sections } = parseSvm(text);
  const params: Record<string, number | string | null> = {};
  for (const [section, entries] of Object.entries(sections)) {
    for (const e of entries) {
      const prefix = section === '' ? '' : `${section}.`;
      params[`${prefix}${e.key}`] = e.display ?? e.index ?? null;
    }
  }
  return { name, params };
};

export interface SetupDelta {
  section: string;
  key: string;
  /** Stored index in the base setup, or null when the key is absent there. */
  from: number | null;
  /** Stored index in the other setup, or null when the key is absent there. */
  to: number | null;
}

/**
 * Report which setting indices changed between two parsed setups (docs/03 §S4.2 — the reliable use of
 * the `.svm`: detect *which* settings moved vs a reference, to advise relative changes). Compares the
 * union of `SECTION.Key`s; a key present in only one side reports the missing side as null.
 */
export const diffSetups = (base: ParsedSetup, other: ParsedSetup): SetupDelta[] => {
  const indexOf = (
    p: ParsedSetup,
  ): Map<string, { section: string; key: string; index: number | null }> => {
    const m = new Map<string, { section: string; key: string; index: number | null }>();
    for (const [section, entries] of Object.entries(p.sections)) {
      for (const e of entries)
        m.set(`${section}.${e.key}`, { section, key: e.key, index: e.index });
    }
    return m;
  };
  const a = indexOf(base);
  const b = indexOf(other);
  const deltas: SetupDelta[] = [];
  for (const id of new Set([...a.keys(), ...b.keys()])) {
    const from = a.get(id)?.index ?? null;
    const to = b.get(id)?.index ?? null;
    if (from !== to) {
      const meta = a.get(id) ?? b.get(id)!;
      deltas.push({ section: meta.section, key: meta.key, from, to });
    }
  }
  return deltas;
};
