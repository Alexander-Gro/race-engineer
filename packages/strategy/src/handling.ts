import type { Tire } from '@race-engineer/core';

/**
 * Telemetry-driven handling diagnosis (build-plan T9.2, docs/08 §3 "Telemetry-driven handling
 * diagnosis"). Pure, explainable indicators derived from the canonical tyre temps — the *directional*
 * reads the setup/coaching advice is built on:
 *
 *  - **Camber** — inner-vs-outer temperature spread across a tyre.
 *  - **Pressure** — centre-vs-edges spread across a tyre (centre hot ⇒ over-inflated).
 *  - **Balance** — front-axle vs rear-axle average temp ⇒ understeer / oversteer tendency.
 *
 * The *directions* are conventional tyre theory (not rig-specific); the magnitude thresholds are
 * options the rig can calibrate per car/compound. State-honest: a single-value temp (no zones) yields
 * `unknown` camber/pressure, and `confidence01` reflects how much zone data backed the read
 * (docs/05 §8 "trustworthy or silent"). Pure/deterministic, depends on `core` only — the LLM phrases
 * this; it never computes it. Read-only/advisory.
 */

export interface HandlingThresholds {
  /** |inner − outer| (°C) above which a tyre shows a camber signal. Default 8. */
  camberDeltaC: number;
  /** |centre − edge-mean| (°C) above which a tyre shows a pressure signal. Default 6. */
  pressureDeltaC: number;
  /** |front-avg − rear-avg| (°C) above which the axle balance leans under/oversteer. Default 6. */
  balanceDeltaC: number;
}

export const DEFAULT_HANDLING_THRESHOLDS: HandlingThresholds = {
  camberDeltaC: 8,
  pressureDeltaC: 6,
  balanceDeltaC: 6,
};

export type CamberHint = 'balanced' | 'inner-hot' | 'outer-hot' | 'unknown';
export type PressureHint = 'balanced' | 'over' | 'under' | 'unknown';
export type BalanceTendency = 'understeer' | 'oversteer' | 'neutral' | 'unknown';

export interface CornerRead<Hint> {
  /** The signed temperature delta the read is based on (°C), or null when not derivable. */
  deltaC: number | null;
  hint: Hint;
}

export interface HandlingDiagnosis {
  /** Per-corner camber read (FL, FR, RL, RR). */
  camber: [
    CornerRead<CamberHint>,
    CornerRead<CamberHint>,
    CornerRead<CamberHint>,
    CornerRead<CamberHint>,
  ];
  /** Per-corner pressure read (FL, FR, RL, RR). */
  pressure: [
    CornerRead<PressureHint>,
    CornerRead<PressureHint>,
    CornerRead<PressureHint>,
    CornerRead<PressureHint>,
  ];
  balance: {
    frontAvgC: number | null;
    rearAvgC: number | null;
    /** front-avg − rear-avg (°C); positive = fronts hotter. */
    deltaC: number | null;
    tendency: BalanceTendency;
  };
  /** Fraction of corners with 3-zone temps (the rich signal). 0 ⇒ coarse balance read only. */
  confidence01: number;
}

interface Zones {
  inner: number;
  center: number;
  outer: number;
}

const zonesOf = (tempC: Tire['tempC']): Zones | null => (typeof tempC === 'number' ? null : tempC);

/** A tyre's representative temperature for axle-balance (centre zone, or the single value). */
const representativeC = (tempC: Tire['tempC']): number =>
  typeof tempC === 'number' ? tempC : tempC.center;

const camberRead = (tire: Tire | undefined, tol: number): CornerRead<CamberHint> => {
  const z = tire ? zonesOf(tire.tempC) : null;
  if (z === null) return { deltaC: null, hint: 'unknown' };
  const deltaC = z.inner - z.outer;
  const hint: CamberHint =
    Math.abs(deltaC) <= tol ? 'balanced' : deltaC > 0 ? 'inner-hot' : 'outer-hot';
  return { deltaC, hint };
};

const pressureRead = (tire: Tire | undefined, tol: number): CornerRead<PressureHint> => {
  const z = tire ? zonesOf(tire.tempC) : null;
  if (z === null) return { deltaC: null, hint: 'unknown' };
  const deltaC = z.center - (z.inner + z.outer) / 2;
  const hint: PressureHint = Math.abs(deltaC) <= tol ? 'balanced' : deltaC > 0 ? 'over' : 'under';
  return { deltaC, hint };
};

const avg = (xs: number[]): number | null =>
  xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length;

/**
 * Diagnose handling from the 4-corner tyre temps (FL, FR, RL, RR — the canonical wheel order).
 * `tires` shorter than 4 degrades gracefully (missing corners read `unknown`).
 */
export const diagnoseHandling = (
  tires: readonly Tire[],
  thresholds: Partial<HandlingThresholds> = {},
): HandlingDiagnosis => {
  const t = { ...DEFAULT_HANDLING_THRESHOLDS, ...thresholds };
  const [fl, fr, rl, rr] = tires;

  const camber: HandlingDiagnosis['camber'] = [
    camberRead(fl, t.camberDeltaC),
    camberRead(fr, t.camberDeltaC),
    camberRead(rl, t.camberDeltaC),
    camberRead(rr, t.camberDeltaC),
  ];
  const pressure: HandlingDiagnosis['pressure'] = [
    pressureRead(fl, t.pressureDeltaC),
    pressureRead(fr, t.pressureDeltaC),
    pressureRead(rl, t.pressureDeltaC),
    pressureRead(rr, t.pressureDeltaC),
  ];

  const frontAvgC = avg(
    [fl, fr].filter((x): x is Tire => x !== undefined).map((x) => representativeC(x.tempC)),
  );
  const rearAvgC = avg(
    [rl, rr].filter((x): x is Tire => x !== undefined).map((x) => representativeC(x.tempC)),
  );
  const deltaC = frontAvgC !== null && rearAvgC !== null ? frontAvgC - rearAvgC : null;
  const tendency: BalanceTendency =
    deltaC === null
      ? 'unknown'
      : Math.abs(deltaC) <= t.balanceDeltaC
        ? 'neutral'
        : deltaC > 0
          ? 'understeer' // fronts working harder / hotter → push
          : 'oversteer';

  const zonesPresent = tires.slice(0, 4).filter((tire) => zonesOf(tire.tempC) !== null).length;

  return {
    camber,
    pressure,
    balance: { frontAvgC, rearAvgC, deltaC, tendency },
    confidence01: zonesPresent / 4,
  };
};
