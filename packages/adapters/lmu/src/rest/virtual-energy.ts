import type { PlayerCar, RaceState } from '@race-engineer/core';
import { findNumber } from './probe';

/**
 * Map LMU's REST Virtual-Energy data into the canonical `PlayerCar.virtualEnergy` (build-plan
 * T11.3, docs/03 §S2.4). VE is an LMU-specific concept **absent from the rF2 shared-memory layout**,
 * so REST is its only source — the current level comes from `/rest/garage/UIScreen/RepairAndRefuel`
 * and the per-lap usage from `/rest/strategy/usage` (docs/03 §S2).
 *
 * **The exact JSON field names are LIVE-VERIFY** (only the running game's Swagger is authoritative,
 * docs/03 §S2). So this mapper is deliberately **tolerant**: it probes a documented set of plausible
 * key names (case-insensitive, one level of nesting) and, crucially, **returns null when it can't
 * find a VE level** rather than inventing one (CLAUDE.md rule 1 / state-honesty). Once a rig capture
 * pins the real field names, narrow the candidate lists to the confirmed keys.
 *
 * Read-only: this only *reads* raw REST payloads the GET-only client already fetched (rule 5).
 */

type VirtualEnergy = NonNullable<PlayerCar['virtualEnergy']>;

/** Candidate keys for the *current* VE level (a %, or already a 0..1 fraction). LIVE-VERIFY. */
const LEVEL_KEYS = [
  'virtualEnergy',
  'virtualenergy',
  'fuelEnergy',
  'energy',
  'energyLevel',
  'currentVirtualEnergy',
  'level',
  'remaining',
] as const;

/** Candidate keys for per-lap VE consumption (a %/lap, or a 0..1 fraction). LIVE-VERIFY. */
const PER_LAP_KEYS = [
  'virtualEnergyPerLap',
  'energyPerLap',
  'usagePerLap',
  'perLap',
  'perLapUsage',
  'consumptionPerLap',
  'usage',
  'consumption',
] as const;

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/**
 * Normalize a VE value that may arrive as a percentage (0..100) or already a fraction (0..1) into a
 * 0..1 fraction. Heuristic: anything above 1.5 is treated as a percentage. Both a full tank (85 →
 * 0.85) and a per-lap burn (5 → 0.05) normalize correctly; values already in 0..1 pass through.
 */
const toFraction01 = (v: number | null): number | null =>
  v === null ? null : clamp01(v > 1.5 ? v / 100 : v);

/**
 * Build the canonical `virtualEnergy` block from the raw REST payloads, or null when no VE level is
 * present (no VE data → null, never a fabricated value). `strategyUsage` carries the per-lap usage;
 * the current level usually comes from `repairRefuel` (fall back to `strategyUsage` if absent).
 */
export const virtualEnergyFromRest = (
  strategyUsage: unknown,
  repairRefuel?: unknown,
): PlayerCar['virtualEnergy'] => {
  const level01 = toFraction01(
    findNumber(repairRefuel, LEVEL_KEYS) ?? findNumber(strategyUsage, LEVEL_KEYS),
  );
  if (level01 === null) return null; // can't construct a VE block without a current level

  const perLapAvg01 = toFraction01(
    findNumber(strategyUsage, PER_LAP_KEYS) ?? findNumber(repairRefuel, PER_LAP_KEYS),
  );
  const lapsRemainingEst = perLapAvg01 !== null && perLapAvg01 > 0 ? level01 / perLapAvg01 : null;

  return { level01, perLapAvg01, lapsRemainingEst } satisfies VirtualEnergy;
};

/**
 * Merge REST Virtual Energy into a (SHM-derived) `RaceState`, returning a new state with
 * `player.virtualEnergy` filled. When REST has no VE the state is returned unchanged (its
 * `virtualEnergy` stays whatever the SHM normalizer set — null). This is the seam the live
 * REST+SHM host wiring calls; it is pure so it's fully testable offline.
 */
export const withVirtualEnergyFromRest = (
  state: RaceState,
  rest: { strategyUsage: unknown; repairRefuel?: unknown },
): RaceState => {
  const ve = virtualEnergyFromRest(rest.strategyUsage, rest.repairRefuel);
  if (ve === null) return state;
  return { ...state, player: { ...state.player, virtualEnergy: ve } };
};
