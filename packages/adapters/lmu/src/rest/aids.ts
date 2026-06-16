import type { AidLevel, RaceState } from '@race-engineer/core';
import { findNumber } from './probe';

/**
 * Read the current driver-aid indices (TC / ABS / engine map) from LMU's REST garage payloads into
 * the canonical schema (build-plan T8.1, spike S3, docs/03 §S2.4 / docs/08 §3). These are **not in the
 * rF2 shared memory** (S1 finding) — SHM carries brake bias (`mRearBrakeBias`, live-confirmed) but not
 * the aid indices — so REST (`/rest/garage/getPlayerGarageData` or a `/rest/garage/UIScreen/*` screen)
 * is the candidate source; the setup file (S4) is the fallback once that parser lands (T9.1).
 *
 * **Field names are LIVE-VERIFY** (docs/03 §S2): this is deliberately **tolerant** — it probes
 * documented candidate keys and returns `null` for anything it can't find, never a guessed index
 * (CLAUDE.md rule 1). It only reads what the engineer advises *from*; it never writes an aid
 * (rule 5 — the driver makes every change). Brake bias is intentionally **not** taken from REST here:
 * SHM owns it (prefer-SHM, docs/03 §S2.4), and the front/rear-% convention is itself LIVE-VERIFY.
 */

/** Candidate keys per aid (case-insensitive, one level of nesting). LIVE-VERIFY on the rig. */
const TC_KEYS = ['tractionControl', 'tc', 'tractionControlLevel', 'tcLevel', 'tractionControlMap'];
const ABS_KEYS = ['abs', 'antiLock', 'absLevel', 'antilockBrakes', 'absMap'];
const ENGINE_MAP_KEYS = ['engineMap', 'engineMix', 'engineMixture', 'mixture', 'mapLevel', 'map'];

/** Build a canonical {@link AidLevel} from a bare index — REST exposes the value, not its range. */
const aidLevel = (value: number | null): AidLevel | null =>
  value === null ? null : { value, min: null, max: null };

export interface RestAids {
  tc: AidLevel | null;
  abs: AidLevel | null;
  /** Engine map index (carried under `PlayerCar.engine.map`, not `aids`). */
  engineMap: number | null;
}

/** Map the raw REST garage payload(s) → the current aid indices, or nulls when not found. */
export const aidsFromRest = (garage: unknown, repairRefuel?: unknown): RestAids => {
  const find = (keys: readonly string[]): number | null =>
    findNumber(garage, keys) ?? findNumber(repairRefuel, keys);
  return {
    tc: aidLevel(find(TC_KEYS)),
    abs: aidLevel(find(ABS_KEYS)),
    engineMap: find(ENGINE_MAP_KEYS),
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
