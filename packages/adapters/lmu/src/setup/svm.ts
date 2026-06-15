import { readFileSync } from 'node:fs';
import type { SetupSummary } from '@race-engineer/core';

/**
 * Read-only parser for LMU/rF2 `.svm` setup files (build-plan T1.4 / spike S4, docs/03 §S4).
 *
 * `.svm` is the rF2 setup format LMU inherits: an INI-style text file of `[SECTION]` headers and
 * `Key=<value>//<display comment>` entries, found under
 * `…/Le Mans Ultimate/UserData/player/Settings/<Track>/<name>.svm` (S4.1, live-confirmed 2026-06-16).
 *
 * Two S4 facts shape this parser (both confirmed live against a real GT3 Le Mans setup):
 *  1. **Values are setting *indices*, not physical UI numbers** — `RWSetting=0` is wing index 0, not 0°.
 *  2. **…but LMU embeds the human-readable display in the trailing `//` comment** — `RWSetting=0//6.3 deg`,
 *     `AntilockBrakeSystemMapSetting=9//9 (Understeer)`, `EngineMixtureSetting=1//Race`. So unlike the
 *     pessimistic desk research, the display string *is* recoverable per-entry (when present; some read
 *     `//N/A` / `//Non-adjustable`). We keep both the raw index and the display comment.
 *
 * **Strictly read-only** (CLAUDE.md rule 5): this parses a file the driver already saved so the engineer
 * can *tell* them what their baseline is. There is no setup-write path anywhere. Pure (`parseSvm`) +
 * a thin read-only file wrapper (`parseSvmFile`); LMU-specific, so it lives in the adapter (rule 4).
 */

/** One `Key=value//comment` entry. `value` is the raw stored index (number) or string (quoted/tuple). */
export interface SvmEntry {
  /** The `[SECTION]` this entry sits under; `''` for the pre-section file header. */
  section: string;
  key: string;
  /** Raw stored value: a number for plain indices, a string for quoted text / `(tuple)` values. */
  value: number | string;
  /** The trailing `//` display hint (e.g. `6.3 deg`, `9 (Understeer)`, `Race`), or null if none. */
  display: string | null;
}

export interface SvmSetup {
  /** From `VehicleClassSetting="…"` (e.g. `GT3 Porsche_911_GT3_R_LMGT3 WEC2025`), or null. */
  vehicleClass: string | null;
  /** From the `//VEH=…` header comment (the car's `.VEH` path), or null. */
  vehPath: string | null;
  /** Every parsed entry, in file order. */
  entries: SvmEntry[];
}

/** The subset of setup fields the engineer advises from, each as `{ index, display }`. */
export interface SetupBaseline {
  vehicleClass: string | null;
  tractionControlMap: SvmEntry | null;
  absMap: SvmEntry | null;
  engineMixture: SvmEntry | null;
  engineBoost: SvmEntry | null;
  brakeMigration: SvmEntry | null;
  regenerationMap: SvmEntry | null;
  virtualEnergy: SvmEntry | null;
  fuel: SvmEntry | null;
  /** Per-corner tyre compounds (in file order — front-left, front-right, rear-left, rear-right). */
  compounds: SvmEntry[];
}

const stripQuotes = (s: string): string =>
  s.length >= 2 && s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s;

/** Parse a raw value token into a number (plain index) or string (quoted text / `(tuple)`). */
const parseValue = (raw: string): number | string => {
  const trimmed = raw.trim();
  if (trimmed.startsWith('"')) return stripQuotes(trimmed);
  if (trimmed.startsWith('(')) return trimmed; // e.g. UpgradeSetting=(299140,0,0,0) — keep verbatim
  // A bare integer/float index; otherwise fall back to the raw string (never throw on odd input).
  if (/^[+-]?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  return trimmed;
};

/**
 * Parse `.svm` text. Tolerant by design (docs/16 §never-crash): unknown lines are skipped, malformed
 * entries are dropped rather than thrown, so a format drift on a future build degrades to a partial
 * read instead of a crash.
 */
export const parseSvm = (text: string): SvmSetup => {
  const entries: SvmEntry[] = [];
  let vehicleClass: string | null = null;
  let vehPath: string | null = null;
  let section = '';

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0) continue;

    // Full-line comment. Capture the `//VEH=…` car path; ignore the rest.
    if (line.startsWith('//')) {
      const veh = /^\/\/VEH=(.+)$/.exec(line);
      if (veh?.[1]) vehPath = veh[1].trim();
      continue;
    }

    // Section header.
    const sec = /^\[(.+)]$/.exec(line);
    if (sec?.[1]) {
      section = sec[1];
      continue;
    }

    const eq = line.indexOf('=');
    if (eq < 1) continue; // not a Key=Value line

    const key = line.slice(0, eq).trim();
    const rest = line.slice(eq + 1);
    // Split the value from its trailing `//display` comment on the FIRST `//`.
    const comment = rest.indexOf('//');
    const valuePart = comment >= 0 ? rest.slice(0, comment) : rest;
    const display = comment >= 0 ? rest.slice(comment + 2).trim() : null;
    const value = parseValue(valuePart);

    if (key === 'VehicleClassSetting' && typeof value === 'string') vehicleClass = value;

    entries.push({ section, key, value, display: display && display.length > 0 ? display : null });
  }

  return { vehicleClass, vehPath, entries };
};

const find = (svm: SvmSetup, key: string): SvmEntry | null =>
  svm.entries.find((e) => e.key === key) ?? null;

/** Pull the engineer-relevant aid/strategy baseline out of a parsed setup. */
export const extractSetupBaseline = (svm: SvmSetup): SetupBaseline => ({
  vehicleClass: svm.vehicleClass,
  tractionControlMap: find(svm, 'TractionControlMapSetting'),
  absMap: find(svm, 'AntilockBrakeSystemMapSetting'),
  engineMixture: find(svm, 'EngineMixtureSetting'),
  engineBoost: find(svm, 'EngineBoostSetting'),
  brakeMigration: find(svm, 'BrakeMigrationSetting'),
  regenerationMap: find(svm, 'RegenerationMapSetting'),
  virtualEnergy: find(svm, 'VirtualEnergySetting'),
  fuel: find(svm, 'FuelSetting'),
  compounds: svm.entries.filter((e) => e.key === 'CompoundSetting'),
});

/**
 * Map a parsed setup to the canonical {@link SetupSummary} (`{ name, params }`, docs/04). `params` is the
 * flat `key → index` map (last-wins on the duplicate per-corner keys); the richer per-entry display lives
 * in {@link SvmSetup}. Keeps the canonical container permissive until M9 pins the full setup schema.
 */
export const toSetupSummary = (svm: SvmSetup, name: string | null = null): SetupSummary => {
  const params: Record<string, number | string | null> = {};
  for (const e of svm.entries) params[e.key] = e.value;
  return { name, params };
};

/**
 * Read + parse a `.svm` file (read-only). Windows path under `UserData/player/Settings/<Track>/`.
 * Throws only if the file can't be read; a readable-but-odd file parses to a partial {@link SvmSetup}.
 */
export const parseSvmFile = (path: string): SvmSetup => parseSvm(readFileSync(path, 'utf8'));
