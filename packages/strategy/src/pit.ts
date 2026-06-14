/**
 * Pit-stop time model (docs/05 §3). Pure, deterministic — the LLM calls these as tools and
 * phrases the result; it never reproduces the math (CLAUDE.md rule 1).
 *
 *   pitLoss     = pitLaneTimeLoss + serviceTime
 *   serviceTime = max(refuelTime, tireChangeTime if changing, repairTime)
 *   refuelTime  = fuelToAdd / refuelRateLitersPerSec
 *
 * The pit-crew operations run **in parallel** (the rig refuels while tyres are changed), so the
 * stationary time is the *longest* single operation — `max`, not a sum. `pitLaneTimeLoss` (the
 * transit penalty vs staying out, EXCLUDING the stationary service) is a per-track constant
 * measured from telemetry; `estimatePitLaneTimeLossS` derives it from one observed pit pass.
 *
 * Output feeds the stint planner (T7.3): one fewer stop saves exactly one `totalPitLossS`, to be
 * weighed against the tyre-degradation cost of the longer stint (`degLossOverStintS`, tires.ts).
 */

/** What will be done at the stop (drives the stationary service time). */
export interface PitService {
  /** Litres of fuel to add this stop (≤0 ⇒ no refuel). */
  fuelToAddLiters?: number;
  /** Whether all four tyres will be changed this stop. */
  changeTires?: boolean;
  /** Estimated stationary repair time (s); 0 ⇒ no damage to fix. */
  repairTimeS?: number;
}

/** Car/series-specific service rates & fixed times (LMU fuel rigs/tyre guns are series-specific). */
export interface PitServiceRates {
  /** Refuel rate (L/s). */
  refuelRateLitersPerSec: number;
  /** Fixed stationary time to change all four tyres (s). */
  tireChangeTimeS: number;
}

/** Which stationary operation set the service time — useful for the engineer to phrase the stop. */
export type PitBottleneck = 'refuel' | 'tires' | 'repair' | 'none';

export interface PitLossInput {
  /** Per-track transit penalty vs staying out, EXCLUDING service (s). See `estimatePitLaneTimeLossS`. */
  pitLaneTimeLossS: number;
  service: PitService;
  rates: PitServiceRates;
}

export interface PitLoss {
  /** Transit penalty component (the per-track constant), passed through. */
  pitLaneTimeLossS: number;
  /** Stationary service time = max of the parallel operations. */
  serviceTimeS: number;
  /** Which operation dominated the stationary time (`none` when nothing is serviced). */
  bottleneck: PitBottleneck;
  /** Total time lost vs staying out: `pitLaneTimeLossS + serviceTimeS`. */
  totalPitLossS: number;
}

/**
 * Refuel time for a given fuel add (docs/05 §3): `fuelToAdd / refuelRate`. Returns 0 when there
 * is no fuel to add or no usable rate (kept finite — never NaN/Infinity).
 */
export const refuelTimeS = (fuelToAddLiters: number, refuelRateLitersPerSec: number): number => {
  const liters = Math.max(0, fuelToAddLiters);
  if (liters === 0 || !(refuelRateLitersPerSec > 0)) return 0;
  return liters / refuelRateLitersPerSec;
};

/**
 * Stationary service time = the longest of the parallel operations (refuel ∥ tyres ∥ repair),
 * with the operation that set it. The crew works concurrently, so total stationary time is the
 * `max`, not the sum (docs/05 §3).
 */
export const serviceTimeS = (
  service: PitService,
  rates: PitServiceRates,
): { serviceTimeS: number; bottleneck: PitBottleneck } => {
  const refuel = refuelTimeS(service.fuelToAddLiters ?? 0, rates.refuelRateLitersPerSec);
  const tires = service.changeTires ? Math.max(0, rates.tireChangeTimeS) : 0;
  const repair = Math.max(0, service.repairTimeS ?? 0);

  const ops: ReadonlyArray<{ label: PitBottleneck; t: number }> = [
    { label: 'refuel', t: refuel },
    { label: 'tires', t: tires },
    { label: 'repair', t: repair },
  ];
  const winner = ops.reduce((best, op) => (op.t > best.t ? op : best), {
    label: 'none' as PitBottleneck,
    t: 0,
  });
  return { serviceTimeS: winner.t, bottleneck: winner.label };
};

/** Total pit-stop time loss = `pitLaneTimeLoss + serviceTime` (docs/05 §3). */
export const computePitLoss = (input: PitLossInput): PitLoss => {
  const pitLaneTimeLossS = Math.max(0, input.pitLaneTimeLossS);
  const { serviceTimeS: service, bottleneck } = serviceTimeS(input.service, input.rates);
  return {
    pitLaneTimeLossS,
    serviceTimeS: service,
    bottleneck,
    totalPitLossS: pitLaneTimeLossS + service,
  };
};

/** One observed pass through the pit lane, used to measure the per-track transit penalty. */
export interface PitLaneObservation {
  /** Wall-clock from the pit-entry timing line to the pit-exit timing line (s). */
  pitLaneTransitS: number;
  /** Time the same stretch of track would take at racing speed, i.e. the staying-out reference (s). */
  onTrackEquivalentS: number;
  /** Stationary service time observed on this pass, stripped out so the result is transit-only (s). */
  stationaryServiceS?: number;
}

/**
 * Estimate the per-track `pitLaneTimeLoss` (transit penalty, EXCLUDING service) from one measured
 * pit pass (docs/05 §3): `pitLaneTransit − stationaryService − onTrackEquivalent`. Clamped to ≥0
 * (the pit lane is never faster than the track) so a noisy measurement can't produce a negative
 * penalty.
 */
export const estimatePitLaneTimeLossS = (obs: PitLaneObservation): number => {
  const loss = obs.pitLaneTransitS - (obs.stationaryServiceS ?? 0) - obs.onTrackEquivalentS;
  return Math.max(0, loss);
};
