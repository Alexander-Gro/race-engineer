import type { AidLevel, RaceState } from '@race-engineer/core';
import { finiteNumber, findRecord } from './probe';

/**
 * Read the current driver-aid indices (TC / ABS / engine map) from LMU's REST garage payloads into
 * the canonical schema (build-plan T8.1, spike S3, docs/03 §S2.4 / docs/08 §3). These are **not in the
 * rF2 shared memory** (S1 finding) — SHM carries brake bias (`mRearBrakeBias`, live-confirmed) but not
 * the aid indices — so REST (`/rest/garage/getPlayerGarageData`) is the source.
 *
 * **Confirmed against a live rig capture (2026-06-16, docs/03 §S2):** each aid is a `VM_*` object on the
 * garage payload carrying its own `value` + `minValue`/`maxValue` (so the canonical {@link AidLevel}
 * gets a real range, not nulls) and a display `stringValue`. Captured example: `VM_TRACTIONCONTROLMAP`
 * value 5 (0–12), `VM_ANTILOCKBRAKESYSTEMMAP` value 9 (0–10, "9 (Understeer)"), `VM_ENGINE_MIXTURE`
 * value 1 (0–2, "Race"). The candidate lists lead with the confirmed `VM_*` keys + keep tolerant
 * fallbacks for other builds; an absent aid stays `null`, never a guessed index (CLAUDE.md rule 1).
 *
 * Read-only: it only reads what the engineer advises *from*; it never writes an aid (rule 5 — the driver
 * makes every change). Brake bias is intentionally **not** taken from REST: SHM owns it (prefer-SHM).
 */

/** Candidate `VM_*` aid keys (confirmed first), case-insensitive, top-level or one level deep. */
const TC_KEYS = ['VM_TRACTIONCONTROLMAP', 'tractionControl', 'tc', 'tractionControlMap'];
const ABS_KEYS = ['VM_ANTILOCKBRAKESYSTEMMAP', 'abs', 'antiLock', 'absMap'];
const ENGINE_MAP_KEYS = ['VM_ENGINE_MIXTURE', 'engineMixture', 'engineMap', 'mixture', 'map'];

/**
 * Build a canonical {@link AidLevel} from a `VM_*` aid object: its `value` is the current index, and
 * `minValue`/`maxValue` give the real range (null when the field is absent). Returns null when no
 * object/value is found — never a guessed index.
 */
const aidLevelFrom = (aid: Record<string, unknown> | null): AidLevel | null => {
  if (aid === null) return null;
  const value = finiteNumber(aid['value']);
  if (value === null) return null;
  return { value, min: finiteNumber(aid['minValue']), max: finiteNumber(aid['maxValue']) };
};

export interface RestAids {
  tc: AidLevel | null;
  abs: AidLevel | null;
  /** Engine map/mixture index (carried under `PlayerCar.engine.map`, not `aids`). */
  engineMap: number | null;
}

/** Map the raw REST garage payload(s) → the current aid indices + ranges, or nulls when not found. */
export const aidsFromRest = (garage: unknown, repairRefuel?: unknown): RestAids => {
  const findAid = (keys: readonly string[]): Record<string, unknown> | null =>
    findRecord(garage, keys) ?? findRecord(repairRefuel, keys);
  const engine = findAid(ENGINE_MAP_KEYS);
  return {
    tc: aidLevelFrom(findAid(TC_KEYS)),
    abs: aidLevelFrom(findAid(ABS_KEYS)),
    engineMap: engine === null ? null : finiteNumber(engine['value']),
  };
};

/**
 * Merge REST aid indices into a (SHM-derived) `RaceState`, filling **only** the aid fields the SHM
 * normalizer left null (prefer-SHM where it has data). Returns the state unchanged when REST adds
 * nothing. Pure — so the live REST+SHM host wiring calls this and it stays testable offline.
 */
export const withAidsFromRest = (
  state: RaceState,
  rest: { garage: unknown; repairRefuel?: unknown },
): RaceState => {
  const a = aidsFromRest(rest.garage, rest.repairRefuel);
  const aids = state.player.aids;
  const tc = aids.tc ?? a.tc;
  const abs = aids.abs ?? a.abs;
  const map = state.player.engine.map ?? a.engineMap;

  if (tc === aids.tc && abs === aids.abs && map === state.player.engine.map) return state;
  return {
    ...state,
    player: {
      ...state.player,
      aids: { ...aids, tc, abs },
      engine: { ...state.player.engine, map },
    },
  };
};
