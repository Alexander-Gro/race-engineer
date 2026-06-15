import type { FuelPlan, RaceState, StintPlan } from '@race-engineer/core';
import type { EngineerSnapshot } from '@race-engineer/engineer-core';
import type { ClosingDirection, Reading, Severity } from './model';

/**
 * Strategy-panel + rival-tracker view-model (build-plan T7.8, docs/05/09). A **pure** function from a
 * snapshot to a display-ready strategy view: the full stint plan (boundaries, fuel loads, pit windows,
 * expected degradation) the Core already computes (T7.3), plus a multi-class rival tracker (nearest
 * cars ahead/behind with gap + closing). Mirrors `buildDashboardModel`'s style — formatted + severity-
 * classified, state-honest (`—`/`unknown` for missing data), no DOM — so it's unit-tested offline and
 * the renderer stays a thin painter. The LLM/strategy math produced these numbers; this only presents.
 */

const UNKNOWN: Reading = { value: '—', severity: 'unknown' };

/** |closingRateMps| above this counts as approaching/leaving (matches the dashboard threshold). */
const CLOSING_MPS = 0.5;
/** How many cars to show on each side of the player by default. */
const DEFAULT_NEARBY = 3;

const lapRange = (a: number, b: number): string => `${a}–${b}`; // en-dash

const liters = (n: number, digits = 0): Reading => ({
  value: `${n.toFixed(digits)} L`,
  severity: 'neutral',
});

const signedGap = (n: number): Reading => {
  const rounded = Number.parseFloat(n.toFixed(1));
  const sign = rounded > 0 ? '+' : rounded < 0 ? '-' : '';
  return { value: `${sign}${Math.abs(rounded).toFixed(1)}s`, severity: 'neutral' };
};

/** Expected degradation 0..1 (1 = fully worn): higher is worse, so it escalates caution→critical. */
const degradation = (deg01: number): Reading => {
  const severity: Severity = deg01 >= 0.66 ? 'critical' : deg01 >= 0.33 ? 'caution' : 'good';
  return { value: `${Math.round(deg01 * 100)}%`, severity };
};

const closingOf = (rate: number | null): ClosingDirection => {
  if (rate === null || !Number.isFinite(rate)) return 'unknown';
  if (rate > CLOSING_MPS) return 'approaching';
  if (rate < -CLOSING_MPS) return 'leaving';
  return 'steady';
};

export interface StintRow {
  /** 1-based for display. */
  index: number;
  laps: string;
  fuelAdd: Reading;
  compound: string;
  degradation: Reading;
  /** The stint the player's current lap falls in (the one being run now). */
  current: boolean;
}

export interface PitWindowRow {
  laps: string;
  reason: string;
}

export interface StrategyRivalRow {
  relation: 'ahead' | 'behind';
  position: string;
  name: string;
  className: string | null;
  /** Same class as the player — a direct competitor (vs. lapped/lapping traffic). */
  sameClass: boolean;
  gap: Reading;
  closing: ClosingDirection;
}

export interface StrategyModel {
  /** A usable stint plan exists (consumption learned). */
  hasPlan: boolean;
  stints: StintRow[];
  pitWindows: PitWindowRow[];
  mandatoryStops: Reading;
  lapsToFinish: Reading;
  fuelSaveTarget: Reading;
  rivals: StrategyRivalRow[];
  seq: number;
}

const buildStints = (plan: StintPlan | null, playerLap: number): StintRow[] => {
  if (!plan) return [];
  return plan.stints.map((s) => ({
    index: s.index + 1,
    laps: lapRange(s.startLap, s.endLap),
    fuelAdd: liters(s.fuelAddLiters),
    compound: s.tireCompound ?? '—',
    degradation: degradation(s.expectedDegradation01),
    current: playerLap >= s.startLap && playerLap <= s.endLap,
  }));
};

const sameClassAs = (player: RaceState['player'], className: string | null): boolean =>
  player.className !== null && className !== null && player.className === className;

/** Nearest `count` cars ahead (gap<0) and behind (gap>0), each ordered nearest-to-the-player first. */
const buildRivals = (state: RaceState, count: number): StrategyRivalRow[] => {
  const others = state.cars.filter(
    (c) => !c.isPlayer && c.id !== state.player.id && c.gapToPlayerS !== null,
  );
  const ahead = others
    .filter((c) => c.gapToPlayerS! < 0)
    .sort((a, b) => b.gapToPlayerS! - a.gapToPlayerS!) // closest ahead (nearest 0) first
    .slice(0, count);
  const behind = others
    .filter((c) => c.gapToPlayerS! > 0)
    .sort((a, b) => a.gapToPlayerS! - b.gapToPlayerS!) // closest behind first
    .slice(0, count);
  const row =
    (relation: 'ahead' | 'behind') =>
    (c: (typeof others)[number]): StrategyRivalRow => ({
      relation,
      position: `P${c.position}`,
      name: c.driverName ?? '—',
      className: c.className,
      sameClass: sameClassAs(state.player, c.className),
      gap: signedGap(c.gapToPlayerS!),
      closing: closingOf(c.closingRateMps),
    });
  return [...ahead.map(row('ahead')), ...behind.map(row('behind'))];
};

const intReading = (n: number | null): Reading =>
  n === null || !Number.isFinite(n) ? UNKNOWN : { value: String(n), severity: 'neutral' };

const fuelToFinish = (plan: FuelPlan | null): Reading =>
  plan === null || plan.lapsToFinish === null
    ? UNKNOWN
    : { value: `${plan.lapsToFinish.toFixed(0)} laps`, severity: 'neutral' };

const saveTarget = (plan: FuelPlan | null): Reading =>
  plan === null || plan.fuelSaveTargetLitersPerLap === null
    ? UNKNOWN
    : { value: `${plan.fuelSaveTargetLitersPerLap.toFixed(2)} L/lap`, severity: 'caution' };

/** Build the strategy + rival-tracker view-model for one snapshot. Pure, deterministic. */
export const buildStrategyModel = (
  snapshot: EngineerSnapshot,
  nearbyCount: number = DEFAULT_NEARBY,
): StrategyModel => {
  const state = snapshot.raceState;
  const stintPlan = snapshot.strategy?.stintPlan ?? null;
  const fuelPlan = snapshot.strategy?.fuelPlan ?? null;
  const playerLap = state.player.lapsCompleted + 1; // the lap currently being run
  const stints = buildStints(stintPlan, playerLap);

  return {
    hasPlan: stints.length > 0,
    stints,
    pitWindows: (stintPlan?.pitWindows ?? []).map((w) => ({
      laps: lapRange(w.earliestLap, w.latestLap),
      reason: w.reason,
    })),
    mandatoryStops: intReading(stintPlan?.mandatoryStopsRemaining ?? null),
    lapsToFinish: fuelToFinish(fuelPlan),
    fuelSaveTarget: saveTarget(fuelPlan),
    rivals: buildRivals(state, nearbyCount),
    seq: snapshot.seq,
  };
};
