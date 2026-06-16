import type { EngineerSnapshot } from '@race-engineer/engineer-core';
import type { Reading } from './model';

/**
 * Setup-screen view-model (build-plan T9.3, docs/08 §3 / docs/09). A **pure** function from a snapshot
 * to a display-ready setup view: the **aid baseline** the engineer advises from (TC / ABS / brake bias
 * / engine map — with their valid range where the schema carries one), and the **loaded setup params**
 * grouped by section (from the read-only `.svm` parse, T9.1).
 *
 * State-honest (docs/05 §8): a value the source hasn't populated reads `—`/`unknown`, never a
 * fabricated number. Per-setting **safe ranges** for mechanical/aero settings live in the car data, not
 * the `.svm`, so they're `—` until the rig provides them (docs/03 §S4.2) — the model exposes the
 * structure so the screen can render them the moment those ranges land. No DOM (unit-tested offline);
 * read-only/advisory — it shows what to advise changing; the driver makes every change (rule 5).
 */

const UNKNOWN: Reading = { value: '—', severity: 'unknown' };

const aidValue = (v: number | null | undefined, unit = ''): Reading =>
  v === null || v === undefined || !Number.isFinite(v)
    ? UNKNOWN
    : { value: `${v}${unit}`, severity: 'neutral' };

/** A "min–max" range string when both bounds are known, else `—`. */
const range = (
  min: number | null | undefined,
  max: number | null | undefined,
  unit = '',
): string =>
  typeof min === 'number' && Number.isFinite(min) && typeof max === 'number' && Number.isFinite(max)
    ? `${min}–${max}${unit}`
    : '—';

export interface SetupAidRow {
  label: string;
  value: Reading;
  /** Valid range from the canonical schema, or `—` when the car's range isn't known offline. */
  range: string;
}

export interface SetupParamRow {
  key: string;
  value: string;
}

export interface SetupSection {
  section: string;
  rows: SetupParamRow[];
}

export interface SetupModel {
  /** A parsed setup (`.svm`) is loaded. */
  hasSetup: boolean;
  setupName: string | null;
  /** The read-only aid baseline — what the engineer advises relative changes from. */
  aids: SetupAidRow[];
  /** Loaded setup params, grouped by `.svm` section (empty when no setup is loaded). */
  sections: SetupSection[];
  seq: number;
}

const formatParam = (value: number | string | null): string =>
  value === null ? '—' : typeof value === 'number' ? String(value) : value;

/** Group flat `SECTION.Key` setup params into display sections, preserving order. */
const groupParams = (params: Record<string, number | string | null>): SetupSection[] => {
  const order: string[] = [];
  const bySection = new Map<string, SetupParamRow[]>();
  for (const [fullKey, value] of Object.entries(params)) {
    const dot = fullKey.indexOf('.');
    const section = dot > 0 ? fullKey.slice(0, dot) : '';
    const key = dot > 0 ? fullKey.slice(dot + 1) : fullKey;
    if (!bySection.has(section)) {
      bySection.set(section, []);
      order.push(section);
    }
    bySection.get(section)!.push({ key, value: formatParam(value) });
  }
  return order.map((section) => ({ section, rows: bySection.get(section)! }));
};

/** Build the setup-screen view-model for one snapshot. Pure, deterministic. */
export const buildSetupModel = (snapshot: EngineerSnapshot): SetupModel => {
  const p = snapshot.raceState.player;
  const setup = p.setupSummary;

  const aids: SetupAidRow[] = [
    {
      label: 'Traction control',
      value: aidValue(p.aids.tc?.value),
      range: range(p.aids.tc?.min, p.aids.tc?.max),
    },
    {
      label: 'ABS',
      value: aidValue(p.aids.abs?.value),
      range: range(p.aids.abs?.min, p.aids.abs?.max),
    },
    // Brake bias + engine map carry no schema range; the car's safe range is rig/car-data.
    { label: 'Brake bias (front)', value: aidValue(p.aids.brakeBias.frontPct, '%'), range: '—' },
    { label: 'Engine map', value: aidValue(p.engine.map), range: '—' },
  ];

  return {
    hasSetup: setup !== null,
    setupName: setup?.name ?? null,
    aids,
    sections: setup ? groupParams(setup.params) : [],
    seq: snapshot.seq,
  };
};
