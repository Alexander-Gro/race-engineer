import { describe, expect, it } from 'vitest';
import {
  computePitLoss,
  estimatePitLaneTimeLossS,
  refuelTimeS,
  serviceTimeS,
  type PitServiceRates,
} from '../pit';

/**
 * Worked examples (docs/05 §3). A representative LMU endurance stop:
 *   refuel rate 2.5 L/s, four-tyre change 25 s, pit-lane transit penalty 22 s.
 *   serviceTime = max(refuel, tyres, repair); pitLoss = pitLaneTimeLoss + serviceTime.
 */
const RATES: PitServiceRates = { refuelRateLitersPerSec: 2.5, tireChangeTimeS: 25 };
const PIT_LANE_LOSS = 22;

describe('refuelTimeS', () => {
  it('is fuelToAdd / rate (worked example: 60 L @ 2.5 L/s = 24 s)', () => {
    expect(refuelTimeS(60, 2.5)).toBeCloseTo(24, 6);
    expect(refuelTimeS(20, 2.5)).toBeCloseTo(8, 6);
  });

  it('returns 0 (finite, never NaN/Infinity) with no fuel or no usable rate', () => {
    expect(refuelTimeS(0, 2.5)).toBe(0);
    expect(refuelTimeS(-5, 2.5)).toBe(0); // clamps negative fuel
    expect(refuelTimeS(60, 0)).toBe(0); // no rate ⇒ contributes nothing, stays finite
    expect(Number.isFinite(refuelTimeS(60, 0))).toBe(true);
  });
});

describe('serviceTimeS', () => {
  it('takes the max of the parallel operations and names the bottleneck (tyres dominate)', () => {
    // refuel 60 L = 24 s, tyres 25 s, no repair → max 25 s, tyres.
    expect(serviceTimeS({ fuelToAddLiters: 60, changeTires: true }, RATES)).toEqual({
      serviceTimeS: 25,
      bottleneck: 'tires',
    });
  });

  it('lets refuel dominate on a big splash with no tyre change', () => {
    // splash 80 L = 32 s > no tyres → refuel.
    expect(serviceTimeS({ fuelToAddLiters: 80, changeTires: false }, RATES)).toEqual({
      serviceTimeS: 32,
      bottleneck: 'refuel',
    });
  });

  it('lets repair dominate when damage is the long pole', () => {
    // refuel 40 L = 16 s, tyres 25 s, repair 40 s → max 40 s, repair.
    expect(
      serviceTimeS({ fuelToAddLiters: 40, changeTires: true, repairTimeS: 40 }, RATES),
    ).toEqual({ serviceTimeS: 40, bottleneck: 'repair' });
  });

  it('is 0 / none when nothing is serviced (a drive-through)', () => {
    expect(serviceTimeS({}, RATES)).toEqual({ serviceTimeS: 0, bottleneck: 'none' });
  });
});

describe('computePitLoss', () => {
  it('adds the transit penalty to the service time (worked example: 22 + 25 = 47 s)', () => {
    const loss = computePitLoss({
      pitLaneTimeLossS: PIT_LANE_LOSS,
      service: { fuelToAddLiters: 60, changeTires: true },
      rates: RATES,
    });
    expect(loss).toEqual({
      pitLaneTimeLossS: 22,
      serviceTimeS: 25,
      bottleneck: 'tires',
      totalPitLossS: 47,
    });
  });

  it('a fuel-only splash-and-dash: 22 + 8 = 30 s, refuel-limited', () => {
    const loss = computePitLoss({
      pitLaneTimeLossS: PIT_LANE_LOSS,
      service: { fuelToAddLiters: 20, changeTires: false },
      rates: RATES,
    });
    expect(loss.serviceTimeS).toBeCloseTo(8, 6);
    expect(loss.bottleneck).toBe('refuel');
    expect(loss.totalPitLossS).toBeCloseTo(30, 6);
  });

  it('a drive-through (no service) costs only the pit-lane time loss', () => {
    const loss = computePitLoss({ pitLaneTimeLossS: PIT_LANE_LOSS, service: {}, rates: RATES });
    expect(loss).toEqual({
      pitLaneTimeLossS: 22,
      serviceTimeS: 0,
      bottleneck: 'none',
      totalPitLossS: 22,
    });
  });

  it('clamps a negative pit-lane loss to 0', () => {
    const loss = computePitLoss({
      pitLaneTimeLossS: -5,
      service: { changeTires: true },
      rates: RATES,
    });
    expect(loss.pitLaneTimeLossS).toBe(0);
    expect(loss.totalPitLossS).toBe(25);
  });
});

describe('estimatePitLaneTimeLossS', () => {
  it('is transit − service − on-track equivalent (worked example: 50 − 25 − 3 = 22 s)', () => {
    expect(
      estimatePitLaneTimeLossS({
        pitLaneTransitS: 50,
        onTrackEquivalentS: 3,
        stationaryServiceS: 25,
      }),
    ).toBeCloseTo(22, 6);
  });

  it('defaults service to 0 (a drive-through measurement)', () => {
    expect(estimatePitLaneTimeLossS({ pitLaneTransitS: 25, onTrackEquivalentS: 3 })).toBeCloseTo(
      22,
      6,
    );
  });

  it('clamps a noisy negative measurement to 0', () => {
    expect(estimatePitLaneTimeLossS({ pitLaneTransitS: 10, onTrackEquivalentS: 12 })).toBe(0);
  });
});

describe('properties', () => {
  it('refuel time is monotonic non-decreasing in fuel added', () => {
    let prev = -1;
    for (const liters of [0, 5, 10, 25, 50, 80]) {
      const t = refuelTimeS(liters, RATES.refuelRateLitersPerSec);
      expect(t).toBeGreaterThanOrEqual(prev);
      prev = t;
    }
  });

  it('total pit loss is always ≥ the pit-lane loss and ≥ the service time; no NaN/Infinity', () => {
    const cases = [
      { fuelToAddLiters: 0, changeTires: false },
      { fuelToAddLiters: 30, changeTires: false },
      { fuelToAddLiters: 70, changeTires: true },
      { fuelToAddLiters: 40, changeTires: true, repairTimeS: 60 },
    ];
    for (const service of cases) {
      const loss = computePitLoss({ pitLaneTimeLossS: PIT_LANE_LOSS, service, rates: RATES });
      expect(loss.totalPitLossS).toBeGreaterThanOrEqual(loss.pitLaneTimeLossS);
      expect(loss.totalPitLossS).toBeGreaterThanOrEqual(loss.serviceTimeS);
      expect(loss.totalPitLossS).toBeCloseTo(loss.pitLaneTimeLossS + loss.serviceTimeS, 6);
      for (const v of [loss.pitLaneTimeLossS, loss.serviceTimeS, loss.totalPitLossS]) {
        expect(Number.isFinite(v)).toBe(true);
      }
    }
  });

  it('service time equals the max of its individual operations', () => {
    const service = { fuelToAddLiters: 50, changeTires: true, repairTimeS: 15 };
    const refuel = refuelTimeS(service.fuelToAddLiters, RATES.refuelRateLitersPerSec); // 20
    const tires = RATES.tireChangeTimeS; // 25
    const repair = service.repairTimeS; // 15
    const { serviceTimeS: total } = serviceTimeS(service, RATES);
    expect(total).toBe(Math.max(refuel, tires, repair));
  });
});
