import type { RestSnapshot } from './rest/client';
import { parseSvm } from './setup/svm';

/**
 * Assemble a one-shot **rig capture** report (build-plan support for the S2/S3/S4 live halves). On the
 * rig with LMU running, `pnpm capture` fetches every read-only REST payload + (optionally) a `.svm`
 * setup file and hands them here; the report bundles the **raw payloads** (so the field names can be
 * confirmed and the tolerant mappers narrowed) plus a **key index** per endpoint and the parsed `.svm`
 * section/key structure. The point: turn the whole rig-verification into a single capture-and-confirm
 * pass instead of an endpoint-by-endpoint spike.
 *
 * Pure (assembles already-fetched data — the live GET + file read are the CLI's job, `tools/capture.ts`)
 * and read-only (it only reads payloads the GET-only client fetched and a setup file opened read-only).
 * The payloads are game telemetry/config — no secrets — so they're bundled verbatim for mapping.
 */

export const LMU_CAPTURE_SCHEMA = 'race-engineer/lmu-capture@1' as const;

/** Top-level key names of an object payload, plus one level of nesting (`key.subkey`). Field-name aid. */
export const topLevelKeys = (value: unknown): string[] => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return [];
  const out: string[] = [];
  for (const [k, v] of Object.entries(value)) {
    out.push(k);
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      for (const sub of Object.keys(v)) out.push(`${k}.${sub}`);
    }
  }
  return out;
};

export interface CaptureEndpoint {
  responded: boolean;
  /** Top-level (and one-deep) key names seen — what to map the tolerant readers onto. */
  keys: string[];
}

/** The read-only REST endpoints captured (the `RestSnapshot` keys, minus `base`). */
const REST_ENDPOINTS = [
  'sessions',
  'vehicles',
  'weather',
  'strategyUsage',
  'garage',
  'repairRefuel',
] as const;
export type CaptureEndpointName = (typeof REST_ENDPOINTS)[number];

export interface CaptureReport {
  schema: typeof LMU_CAPTURE_SCHEMA;
  capturedAt: string; // ISO 8601
  restBase: string | null;
  /** Per REST endpoint: did it respond, and what keys did it carry. */
  endpoints: Record<CaptureEndpointName, CaptureEndpoint>;
  /** Raw REST payloads, verbatim, for offline field-name mapping. */
  rest: RestSnapshot;
  /** Parsed `.svm`: section → key names (+ the raw text), or null when none was captured. */
  svm: { name: string; sections: Record<string, string[]>; raw: string } | null;
  /** What to confirm from this capture (points at the tolerant readers' candidate lists). */
  checklist: string[];
}

const CHECKLIST = [
  'Virtual Energy: confirm the current-level + per-lap keys in strategyUsage / repairRefuel → narrow virtualEnergyFromRest LEVEL_KEYS/PER_LAP_KEYS.',
  'Aids: confirm the TC / ABS / engine-map index keys in garage / repairRefuel → narrow aidsFromRest TC_KEYS/ABS_KEYS/ENGINE_MAP_KEYS.',
  'Setup: confirm the .svm section/key names and which map to TC/ABS/brake-bias/aero/mechanical.',
  'Note any non-GET (write) operations seen in Swagger and add them to the avoid-list (we only GET).',
];

/** Build the capture report from already-fetched REST + setup data. Pure + deterministic. */
export const buildCaptureReport = (input: {
  rest: RestSnapshot;
  svm: { name: string; text: string } | null;
  capturedAtMs: number;
}): CaptureReport => {
  const endpoints = {} as Record<CaptureEndpointName, CaptureEndpoint>;
  for (const ep of REST_ENDPOINTS) {
    const payload = input.rest[ep];
    endpoints[ep] = {
      responded: payload !== null && payload !== undefined,
      keys: topLevelKeys(payload),
    };
  }

  let svm: CaptureReport['svm'] = null;
  if (input.svm !== null) {
    // The rig `.svm` parser returns a flat entry list (each carries its `section`); group by section
    // into the key index the capture report surfaces.
    const sections: Record<string, string[]> = {};
    for (const entry of parseSvm(input.svm.text).entries) {
      (sections[entry.section] ??= []).push(entry.key);
    }
    svm = { name: input.svm.name, sections, raw: input.svm.text };
  }

  return {
    schema: LMU_CAPTURE_SCHEMA,
    capturedAt: new Date(input.capturedAtMs).toISOString(),
    restBase: input.rest.base,
    endpoints,
    rest: input.rest,
    svm,
    checklist: CHECKLIST,
  };
};
