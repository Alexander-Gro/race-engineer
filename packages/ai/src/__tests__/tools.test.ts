import { multiClassTrafficState } from '@race-engineer/core/fixtures';
import { computeFuelPlan, estimatePerLapConsumption, planStints } from '@race-engineer/strategy';
import { describe, expect, it } from 'vitest';
import type { RaceContext } from '../context';
import { READ_ONLY_TOOLS, toolRegistry } from '../tools';

const fuelPlan = computeFuelPlan({
  fuelLiters: 38,
  consumption: estimatePerLapConsumption({ greenLapFuelDeltas: [2.6, 2.6, 2.6] }),
});
// 30 laps, 60 L tank, 2.6 L/lap → 2 stints [0,15][15,30]; one fuel-limited window [8, 22].
const stintPlan = planStints({ raceLaps: 30, tankCapacityLiters: 60, perLapFuelLiters: 2.6 });
const ctx: RaceContext = { raceState: multiClassTrafficState, fuelPlan, stintPlan };
const registry = toolRegistry();
const run = (name: string, c: RaceContext = ctx): Record<string, unknown> =>
  registry.get(name)!.handler({}, c) as Record<string, unknown>;

describe('read-only tools', () => {
  it('get_fuel_plan returns the strategy plan verbatim, with units', () => {
    const r = run('get_fuel_plan');
    expect(r.available).toBe(true);
    expect(r.perLapLiters).toBeCloseTo(2.6, 6);
    expect(r.lapsRemainingOnFuel).toBeCloseTo(38 / 2.6, 6);
    expect(r.confidence01).toBe(fuelPlan?.confidence01);
    expect((r.units as Record<string, unknown>).fuel).toBe('liters');
  });

  it('get_fuel_plan reports unavailable when nothing is learned yet', () => {
    const r = run('get_fuel_plan', { raceState: multiClassTrafficState, fuelPlan: null });
    expect(r.available).toBe(false);
    expect(r.confidence01).toBe(0);
  });

  it('get_stint_plan returns the strategy plan verbatim, or unavailable when none', () => {
    const r = run('get_stint_plan');
    expect(r.available).toBe(true);
    expect((r.stints as unknown[]).length).toBe(2);
    expect(r.mandatoryStopsRemaining).toBeNull();
    expect(run('get_stint_plan', { raceState: multiClassTrafficState, fuelPlan }).available).toBe(
      false,
    ); // no stintPlan on the context
  });

  it('project_pit_window projects the next stop (earliest/latest/recommended/reason)', () => {
    const r = run('project_pit_window');
    expect(r).toMatchObject({
      available: true,
      earliestLap: 8,
      latestLap: 22,
      recommendedLap: 15, // end of the first stint
      reason: 'fuel-limited',
    });
    expect(
      run('project_pit_window', { raceState: multiClassTrafficState, fuelPlan }).available,
    ).toBe(false);
  });

  it('get_current_aids returns the read-only baseline', () => {
    const r = run('get_current_aids');
    const p = multiClassTrafficState.player;
    expect(r.tc).toEqual(p.aids.tc);
    expect(r.brakeBiasFrontPct).toBe(p.aids.brakeBias.frontPct);
    expect(r.engineMap).toBe(p.engine.map);
  });

  it('get_tire_status returns four wheels in [FL, FR, RL, RR] order', () => {
    const r = run('get_tire_status');
    const wheels = r.wheels as Array<Record<string, unknown>>;
    expect(wheels.map((w) => w.label)).toEqual(['FL', 'FR', 'RL', 'RR']);
    expect(wheels[0]?.compound).toBe('medium');
  });

  it('get_rivals splits cars ahead (−gap) and behind (+gap), nearest first', () => {
    const r = run('get_rivals');
    const ahead = r.ahead as Array<Record<string, unknown>>;
    const behind = r.behind as Array<Record<string, unknown>>;
    expect(ahead[0]?.id).toBe(1); // leader, −94 s
    expect(behind[0]?.id).toBe(4); // lapping Hypercar, +0.8 s
  });

  it('get_race_state summarizes the player and nearest gaps', () => {
    const r = run('get_race_state');
    expect(r.position).toBe(multiClassTrafficState.player.position);
    expect(r.className).toBe('LMP2');
    expect(r.carBehindGapS).toBe(0.8);
    expect(r.flag).toBe('green');
  });
});

describe('read-only invariant', () => {
  it('handlers never mutate the race state', () => {
    const before = JSON.stringify(multiClassTrafficState);
    for (const tool of READ_ONLY_TOOLS) tool.handler({}, ctx);
    expect(JSON.stringify(multiClassTrafficState)).toBe(before);
  });

  it('exposes only read-only getters/projections (no write/apply/set tool)', () => {
    const names = READ_ONLY_TOOLS.map((t) => t.name);
    expect(new Set(names)).toEqual(
      new Set([
        'get_race_state',
        'get_rivals',
        'get_fuel_plan',
        'get_stint_plan',
        'project_pit_window',
        'get_tire_status',
        'get_current_aids',
      ]),
    );
    // get_* reads, project_* derives — both read-only; no apply/set/write verb.
    for (const n of names) expect(n).toMatch(/^(get|project)_/);
  });
});
