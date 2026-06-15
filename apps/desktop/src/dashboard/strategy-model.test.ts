import type { StintPlan } from '@race-engineer/core';
import { multiClassTrafficState } from '@race-engineer/core/fixtures';
import type { EngineerSnapshot } from '@race-engineer/engineer-core';
import { computeFuelPlan, estimatePerLapConsumption, planStints } from '@race-engineer/strategy';
import { describe, expect, it } from 'vitest';
import { buildStrategyModel } from './strategy-model';

const snap = (
  stintPlan: StintPlan | null,
  fuelPlan: ReturnType<typeof computeFuelPlan> | null = null,
): EngineerSnapshot => ({
  seq: 1,
  monotonicMs: 1000,
  raceState: multiClassTrafficState,
  strategy: { fuelPlan, stintPlan },
});

// 30 laps, 60 L tank, 2.6 L/lap → pit window lap 8–22 (mirrors the template-answer worked example).
const stintPlan = planStints({ raceLaps: 30, tankCapacityLiters: 60, perLapFuelLiters: 2.6 });
const fuelPlan = computeFuelPlan({
  fuelLiters: 20,
  consumption: estimatePerLapConsumption({ greenLapFuelDeltas: [2.6, 2.6, 2.6] }),
  race: { remainingS: 3600, avgGreenLapS: 200 }, // 18 laps to finish
  lapsUntilPlannedStop: 10, // only 7.7 laps of fuel → a save target is set to stretch to the stop
});

const handPlan = (deg01: number): StintPlan => ({
  stints: [
    {
      index: 0,
      startLap: 1,
      endLap: 15,
      fuelAddLiters: 50,
      tireCompound: 'medium',
      expectedDegradation01: deg01,
    },
  ],
  pitWindows: [],
  mandatoryStopsRemaining: null,
});

describe('buildStrategyModel — stint plan', () => {
  it('surfaces the stint plan, marking exactly the stint the player is currently running', () => {
    const m = buildStrategyModel(snap(stintPlan));
    expect(m.hasPlan).toBe(true);
    expect(m.stints.length).toBeGreaterThan(0);
    // The player is on lap 10 (lapsCompleted 9 + 1). Exactly one stint should be flagged current.
    const current = m.stints.filter((s) => s.current);
    expect(current).toHaveLength(1);
    const [a, b] = current[0]!.laps.split('–').map(Number);
    expect(10).toBeGreaterThanOrEqual(a!);
    expect(10).toBeLessThanOrEqual(b!);
  });

  it('formats the pit window as a lap range with its reason', () => {
    const m = buildStrategyModel(snap(stintPlan));
    expect(m.pitWindows[0]?.laps).toBe('8–22');
    expect(m.pitWindows[0]?.reason).toBeTruthy();
  });

  it('classifies expected degradation: higher is worse (good → caution → critical)', () => {
    expect(buildStrategyModel(snap(handPlan(0.1))).stints[0]!.degradation).toMatchObject({
      value: '10%',
      severity: 'good',
    });
    expect(buildStrategyModel(snap(handPlan(0.5))).stints[0]!.degradation.severity).toBe('caution');
    expect(buildStrategyModel(snap(handPlan(0.8))).stints[0]!.degradation.severity).toBe(
      'critical',
    );
  });

  it('reports no plan honestly when consumption is not yet known', () => {
    const m = buildStrategyModel(snap(null));
    expect(m.hasPlan).toBe(false);
    expect(m.stints).toEqual([]);
    expect(m.pitWindows).toEqual([]);
    expect(m.mandatoryStops).toMatchObject({ severity: 'unknown' });
  });

  it('surfaces fuel-to-finish and a save target from the fuel plan', () => {
    const m = buildStrategyModel(snap(stintPlan, fuelPlan));
    expect(m.lapsToFinish.value).toBe('18 laps');
    // Can't reach the planned stop on 20 L → a save target is set (2.6 − 20/10 = 0.60 L/lap).
    expect(m.fuelSaveTarget.value).toBe('0.60 L/lap');
  });
});

describe('buildStrategyModel — rival tracker', () => {
  it('lists nearest cars ahead and behind with class + gap + closing', () => {
    const rivals = buildStrategyModel(snap(null)).rivals;
    // Fixture: Leader (Hypercar) -94.0s ahead; Lapper (Hypercar) +0.8s behind closing fast;
    // GT Battle is exactly alongside (gap 0.0) → neither ahead nor behind.
    const ahead = rivals.filter((r) => r.relation === 'ahead');
    const behind = rivals.filter((r) => r.relation === 'behind');
    expect(ahead.map((r) => r.name)).toEqual(['Leader']);
    expect(behind.map((r) => r.name)).toEqual(['Lapper']);

    expect(ahead[0]).toMatchObject({ className: 'Hypercar', sameClass: false });
    expect(ahead[0]!.gap.value).toBe('-94.0s');
    expect(behind[0]).toMatchObject({ name: 'Lapper', sameClass: false, closing: 'approaching' });
    expect(behind[0]!.gap.value).toBe('+0.8s');
  });

  it('honors the nearby-count cap on each side', () => {
    const rivals = buildStrategyModel(snap(null), 0).rivals;
    expect(rivals).toEqual([]);
  });
});
