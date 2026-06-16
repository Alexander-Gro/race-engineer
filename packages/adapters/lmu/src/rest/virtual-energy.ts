import type { PlayerCar, RaceState } from '@race-engineer/core';
import { findNumber } from './probe';

/**
 * Map LMU's REST Virtual-Energy data into the canonical `PlayerCar.virtualEnergy` (build-plan
 * T11.3, docs/03 §S2.4). VE is an LMU-specific concept **absent from the rF2 shared-memory layout**,
 * so REST is its only source — the current level comes from `/rest/garage/UIScreen/RepairAndRefuel`
 * and the per-lap usage from `/rest/strategy/usage` (docs/03 §S2).
 *
 * **Field names + shape confirmed against a live rig capture (2026-06-16, docs/03 §S2):** the level is
 * the raw `fuelInfo.currentVirtualEnergy / maxVirtualEnergy` ratio. The mapper stays **tolerant** (leads
 * with the confirmed keys, keeps fallbacks, navigates one level of nesting) and **returns null when it
 * can't find a VE level** rather than inventing one (CLAUDE.md rule 1 / state-honesty).
 *
 * Read-only: this only *reads* raw REST payloads the GET-only client already fetched (rule 5).
 */

type VirtualEnergy = NonNullable<PlayerCar['virtualEnergy']>;

/**
 * **Confirmed against a live rig capture (2026-06-16, docs/03 §S2):** LMU reports VE on
 * `/rest/garage/UIScreen/RepairAndRefuel` as a raw **current/max pair** under `fuelInfo`
 * (`currentVirtualEnergy` / `maxVirtualEnergy`, e.g. 668372288 / 673000000 ≈ 0.993) — NOT a percentage
 * or a pre-normalized fraction. So the canonical level is the ratio `current / max`. The candidate lists
 * lead with the confirmed keys + keep tolerant fallbacks for other builds.
 */
const CURRENT_KEYS = ['currentVirtualEnergy', 'virtualEnergy', 'energyLevel', 'energy'] as const;
const MAX_KEYS = ['maxVirtualEnergy'] as const;

/** Candidate keys for per-lap VE consumption (a %/lap, or a 0..1 fraction). LIVE-VERIFY. */
const PER_LAP_KEYS = [
  'virtualEnergyPerLap',
  'energyPerLap',
  'usagePerLap',
  'perLap',
  'perLapUsage',
  'consumptionPerLap',
] as const;

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/**
 * Normalize a VE value that may arrive as a percentage (0..100) or already a fraction (0..1) into a
 * 0..1 fraction. Heuristic: anything above 1.5 is treated as a percentage. Used only for the per-lap
 * usage and the single-value fallback; the confirmed level path is the `current / max` ratio.
 */
const toFraction01 = (v: number | null): number | null =>
  v === null ? null : clamp01(v > 1.5 ? v / 100 : v);

/** The current VE level as a 0..1 fraction: `current / max` (confirmed), else a single normalized value. */
const levelFromRest = (strategyUsage: unknown, repairRefuel: unknown): number | null => {
  const current = findNumber(repairRefuel, CURRENT_KEYS) ?? findNumber(strategyUsage, CURRENT_KEYS);
  if (current === null) return null;
  const max = findNumber(repairRefuel, MAX_KEYS) ?? findNumber(strategyUsage, MAX_KEYS);
  if (max !== null && max > 0) return clamp01(current / max);
  // No max → trust the value only if it's already a plausible % / fraction (don't guess from raw units).
  return current <= 100 ? toFraction01(current) : null;
};

/**
 * Build the canonical `virtualEnergy` block from the raw REST payloads, or null when no VE level is
 * present (no VE data → null, never a fabricated value). The level is `current / max`; per-lap usage is
 * left to the live `StrategyEngine` to learn from the level stream (like fuel) unless REST exposes it.
 */
export const virtualEnergyFromRest = (
  strategyUsage: unknown,
  repairRefuel?: unknown,
): PlayerCar['virtualEnergy'] => {
  const level01 = levelFromRest(strategyUsage, repairRefuel);
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
