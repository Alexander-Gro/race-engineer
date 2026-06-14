import type { CarState, PlayerCar, RaceState, Tire } from '@race-engineer/core';
import type { EngineerSnapshot } from '@race-engineer/engineer-core';

/**
 * Live-dashboard view-model (build-plan T6.2, docs/09 §A). A **pure** function from an
 * {@link EngineerSnapshot} to a flat, display-ready model — every value already formatted and
 * classified by the docs/09 colour language (green = good, amber = caution, red = act-now), with a
 * distinct `unknown` for missing data so the renderer can be a thin, dumb painter. Kept pure (no
 * DOM, no React) so the *what to show + how to classify* logic is unit-tested offline against the
 * canonical fixtures; the styling/markup layer (Tailwind/shadcn) and Playwright visual tests sit on
 * top of this and are a follow-up.
 *
 * State honesty (docs/09): a `null` field renders as `—` with `unknown` severity — **never** a
 * fabricated `0` or a misleading colour. Informational values that carry no good/bad judgement
 * (aids, pressures, lap times, position, gaps) are `neutral`, not green.
 */

/** green / amber / red, plus `neutral` (known but unjudged) and `unknown` (no data). */
export type Severity = 'good' | 'caution' | 'critical' | 'neutral' | 'unknown';

export interface Reading {
  /** Formatted for a glance; `—` when unknown. */
  value: string;
  severity: Severity;
}

const UNKNOWN: Reading = { value: '—', severity: 'unknown' };

export interface DashboardThresholds {
  /** Fuel laps-remaining: ≤critical = red, ≤caution = amber. */
  fuelLapsCritical: number;
  fuelLapsCaution: number;
  /** Tyre operating-temperature window (°C, representative temp). */
  tyreTempWindow: { minC: number; maxC: number };
  /** Tyre wear (wear01, 1 = new): ≤critical = red, ≤caution = amber. */
  tyreWearCritical: number;
  tyreWearCaution: number;
  /** Brake disc-temperature window (°C). */
  brakeTempWindow: { minC: number; maxC: number };
  /** |closingRateMps| above this counts as approaching / leaving (else steady). */
  closingMps: number;
  /** A different-class car behind, closing, within this time gap → faster-class warning strip. */
  fasterClassHorizonS: number;
}

export const DEFAULT_THRESHOLDS: DashboardThresholds = {
  fuelLapsCritical: 2,
  fuelLapsCaution: 5,
  tyreTempWindow: { minC: 80, maxC: 100 },
  tyreWearCritical: 0.2,
  tyreWearCaution: 0.4,
  brakeTempWindow: { minC: 200, maxC: 650 },
  closingMps: 0.5,
  fasterClassHorizonS: 5,
};

// --- formatting -------------------------------------------------------------------------------

const num = (n: number | null, digits = 1, unit = ''): Reading =>
  n === null || !Number.isFinite(n)
    ? UNKNOWN
    : { value: `${n.toFixed(digits)}${unit}`, severity: 'neutral' };

/** Signed display that never shows a misleading `-0.0`: a value rounding to zero carries no sign. */
const signedStr = (n: number, digits: number, unit: string): string => {
  const rounded = Number.parseFloat(n.toFixed(digits));
  const sign = rounded > 0 ? '+' : rounded < 0 ? '-' : '';
  return `${sign}${Math.abs(rounded).toFixed(digits)}${unit}`;
};

const signed = (n: number | null, digits = 1, unit = 's'): Reading =>
  n === null || !Number.isFinite(n)
    ? UNKNOWN
    : { value: signedStr(n, digits, unit), severity: 'neutral' };

/** mm:ss for a duration, for the session clock. */
const clock = (s: number | null): Reading => {
  if (s === null || !Number.isFinite(s) || s < 0) return UNKNOWN;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return { value: `${m}:${sec.toString().padStart(2, '0')}`, severity: 'neutral' };
};

const representativeTempC = (tempC: Tire['tempC']): number =>
  typeof tempC === 'number' ? tempC : (tempC.inner + tempC.center + tempC.outer) / 3;

// --- classification ---------------------------------------------------------------------------

const fuelLaps = (laps: number | null, t: DashboardThresholds): Reading => {
  if (laps === null || !Number.isFinite(laps)) return UNKNOWN;
  const severity: Severity =
    laps <= t.fuelLapsCritical ? 'critical' : laps <= t.fuelLapsCaution ? 'caution' : 'good';
  return { value: laps.toFixed(1), severity };
};

const tyreTemp = (tempC: Tire['tempC'] | null, t: DashboardThresholds): Reading => {
  if (tempC === null) return UNKNOWN;
  const temp = representativeTempC(tempC);
  const severity: Severity =
    temp > t.tyreTempWindow.maxC ? 'critical' : temp < t.tyreTempWindow.minC ? 'caution' : 'good';
  return { value: `${Math.round(temp)}°`, severity };
};

const tyreWear = (wear01: number | null, t: DashboardThresholds): Reading => {
  if (wear01 === null || !Number.isFinite(wear01)) return UNKNOWN;
  const severity: Severity =
    wear01 <= t.tyreWearCritical ? 'critical' : wear01 <= t.tyreWearCaution ? 'caution' : 'good';
  return { value: `${Math.round(wear01 * 100)}%`, severity };
};

const brakeTemp = (discTempC: number | null, t: DashboardThresholds): Reading => {
  if (discTempC === null || !Number.isFinite(discTempC)) return UNKNOWN;
  const severity: Severity =
    discTempC > t.brakeTempWindow.maxC
      ? 'critical'
      : discTempC < t.brakeTempWindow.minC
        ? 'caution'
        : 'good';
  return { value: `${Math.round(discTempC)}°`, severity };
};

const FLAG_SEVERITY: Record<RaceState['flags']['global'], Severity> = {
  green: 'good',
  yellow: 'caution',
  fcy: 'caution',
  safetyCar: 'caution',
  red: 'critical',
  checkered: 'neutral',
  none: 'unknown',
};

// --- corners / standings ----------------------------------------------------------------------

export interface CornerTyre {
  temp: Reading;
  wear: Reading;
  pressure: Reading;
}

export type ClosingDirection = 'approaching' | 'leaving' | 'steady' | 'unknown';

const closingOf = (closingRateMps: number | null, t: DashboardThresholds): ClosingDirection => {
  if (closingRateMps === null || !Number.isFinite(closingRateMps)) return 'unknown';
  if (closingRateMps > t.closingMps) return 'approaching';
  if (closingRateMps < -t.closingMps) return 'leaving';
  return 'steady';
};

export interface RivalReading {
  name: string;
  className: string | null;
  gap: Reading;
  closing: ClosingDirection;
}

const rival = (car: CarState | null, t: DashboardThresholds): RivalReading | null =>
  car === null
    ? null
    : {
        name: car.driverName ?? '—',
        className: car.className,
        gap: signed(car.gapToPlayerS, 1, 's'),
        closing: closingOf(car.closingRateMps, t),
      };

/** Nearest car ahead (gap < 0) and behind (gap > 0) of the player, by |gap|. */
const nearestRivals = (state: RaceState): { ahead: CarState | null; behind: CarState | null } => {
  let ahead: CarState | null = null;
  let behind: CarState | null = null;
  for (const car of state.cars) {
    if (car.isPlayer || car.id === state.player.id || car.gapToPlayerS === null) continue;
    if (car.gapToPlayerS < 0) {
      if (ahead === null || car.gapToPlayerS > ahead.gapToPlayerS!) ahead = car;
    } else if (car.gapToPlayerS > 0) {
      if (behind === null || car.gapToPlayerS < behind.gapToPlayerS!) behind = car;
    }
  }
  return { ahead, behind };
};

// --- the model --------------------------------------------------------------------------------

export interface DashboardModel {
  session: { phase: string; multiClass: boolean; flag: Reading; remaining: Reading };
  fuel: { lapsRemaining: Reading; liters: Reading; perLap: Reading; addAtStop: Reading };
  tyres: { compound: string | null; corners: [CornerTyre, CornerTyre, CornerTyre, CornerTyre] };
  brakes: { corners: [Reading, Reading, Reading, Reading] };
  aids: { tc: Reading; abs: Reading; brakeBias: Reading; engineMap: Reading };
  standings: {
    position: string;
    ahead: RivalReading | null;
    behind: RivalReading | null;
    /** A different-class car closing from behind within the horizon — the docs/09 warning strip. */
    fasterClassApproaching: boolean;
  };
  timing: { lastLap: Reading; bestLap: Reading; deltaToBest: Reading };
  seq: number;
  elapsedS: number;
}

const aidValue = (v: number | null | undefined): Reading =>
  v === null || v === undefined || !Number.isFinite(v)
    ? UNKNOWN
    : { value: String(v), severity: 'neutral' };

const corner = (tyre: Tire, t: DashboardThresholds): CornerTyre => ({
  temp: tyreTemp(tyre.tempC, t),
  wear: tyreWear(tyre.wear01, t),
  pressure: num(tyre.pressureKpa, 0, ' kPa'),
});

/**
 * Is ANY different-class car closing from behind within the horizon (docs/09 warning strip)? Scans
 * the whole field — not just the nearest car behind — so a faster-class car isn't missed when a
 * same-class car happens to be marginally closer (mirrors the canonical traffic rule, T7.5).
 */
const fasterClassBehind = (state: RaceState, t: DashboardThresholds): boolean =>
  state.cars.some((car) => {
    if (car.isPlayer || car.id === state.player.id) return false;
    if (car.gapToPlayerS === null || car.closingRateMps === null) return false;
    if (!(car.gapToPlayerS > 0 && car.gapToPlayerS <= t.fasterClassHorizonS)) return false;
    if (car.closingRateMps <= t.closingMps) return false;
    return (
      state.player.className === null ||
      car.className === null ||
      state.player.className !== car.className
    );
  });

const deltaToBest = (player: PlayerCar): Reading => {
  if (player.lastLapS === null || player.bestLapS === null) return UNKNOWN;
  const delta = Number.parseFloat((player.lastLapS - player.bestLapS).toFixed(1));
  // Faster-than-or-equal-to best is good; slower is neutral context, not "bad". No misleading -0.0.
  return { value: signedStr(delta, 1, 's'), severity: delta <= 0 ? 'good' : 'neutral' };
};

/** Build the display model for one snapshot (docs/09 §A). Pure, deterministic. */
export const buildDashboardModel = (
  snapshot: EngineerSnapshot,
  thresholds: DashboardThresholds = DEFAULT_THRESHOLDS,
): DashboardModel => {
  const s = snapshot.raceState;
  const p = s.player;
  const fuelPlan = snapshot.strategy?.fuelPlan ?? null; // from the Core's always-on strategy engine
  const { ahead, behind } = nearestRivals(s);
  const [fl, fr, rl, rr] = p.tires;

  const classPos =
    p.classPosition === null ? '' : ` (class P${p.classPosition} ${p.className ?? ''})`;

  return {
    session: {
      phase: s.session.phase,
      multiClass: s.session.multiClass,
      flag: { value: s.flags.global, severity: FLAG_SEVERITY[s.flags.global] },
      remaining: s.session.isTimed
        ? clock(s.session.remainingS)
        : s.session.totalLaps === null
          ? UNKNOWN
          : { value: `${s.session.totalLaps} laps`, severity: 'neutral' },
    },
    fuel: {
      lapsRemaining: fuelLaps(p.fuel.lapsRemainingEst, thresholds),
      liters: num(p.fuel.liters, 1, ' L'),
      perLap: num(p.fuel.perLapAvgLiters, 2, ' L'),
      // Strategy: fuel to add at the next stop to reach the flag (null until pace/consumption known).
      addAtStop: num(fuelPlan?.litersToAddNextStop ?? null, 1, ' L'),
    },
    tyres: {
      compound: fl?.compound ?? null,
      corners: [
        corner(fl!, thresholds),
        corner(fr!, thresholds),
        corner(rl!, thresholds),
        corner(rr!, thresholds),
      ],
    },
    brakes: {
      corners: [
        brakeTemp(p.brakes[0]?.discTempC ?? null, thresholds),
        brakeTemp(p.brakes[1]?.discTempC ?? null, thresholds),
        brakeTemp(p.brakes[2]?.discTempC ?? null, thresholds),
        brakeTemp(p.brakes[3]?.discTempC ?? null, thresholds),
      ],
    },
    aids: {
      tc: aidValue(p.aids.tc?.value),
      abs: aidValue(p.aids.abs?.value),
      brakeBias:
        p.aids.brakeBias.frontPct === null
          ? UNKNOWN
          : { value: `${p.aids.brakeBias.frontPct.toFixed(1)}%`, severity: 'neutral' },
      engineMap: aidValue(p.engine.map),
    },
    standings: {
      position: `P${p.position}${classPos}`,
      ahead: rival(ahead, thresholds),
      behind: rival(behind, thresholds),
      fasterClassApproaching: fasterClassBehind(s, thresholds),
    },
    timing: {
      lastLap: num(p.lastLapS, 1, 's'),
      bestLap: num(p.bestLapS, 1, 's'),
      deltaToBest: deltaToBest(p),
    },
    seq: snapshot.seq,
    elapsedS: s.session.elapsedS,
  };
};
