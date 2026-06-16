import { describe, expect, it } from 'vitest';
import { EventDetector, strategistRule } from '../events';
import type { DetectionStrategy } from '../events';
import type { EngineerEvent, FuelPlan, RaceState } from '../schema';
import { raceStartState } from '../fixtures';

const frame = (opts: { monotonicMs?: number; inPitLane?: boolean } = {}): RaceState => ({
  ...raceStartState,
  tick: opts.monotonicMs ?? 0,
  monotonicMs: opts.monotonicMs ?? 0,
  player: {
    ...raceStartState.player,
    pit: { ...raceStartState.player.pit, inPitLane: opts.inPitLane ?? false },
  },
});

const plan = (over: Partial<FuelPlan> = {}): FuelPlan => ({
  perLapLiters: 2.6,
  lapsRemainingOnFuel: 10,
  lapsToFinish: null,
  litersToFinish: null,
  litersToAddNextStop: null,
  fuelSaveTargetLitersPerLap: null,
  perLapEnergy01: null,
  lapsRemainingOnEnergy: null,
  energyToFinish01: null,
  energyToAddNextStop01: null,
  energySaveTargetPerLap01: null,
  bindingConstraint: null,
  confidence01: 0.8,
  ...over,
});

const run = (frames: RaceState[], plans: (FuelPlan | null)[]): EngineerEvent[] => {
  const detector = new EventDetector([strategistRule()]);
  return frames.flatMap((f, i) => {
    const strategy: DetectionStrategy = { fuelPlan: plans[i] ?? null, stintPlan: null };
    return detector.process(f, strategy);
  });
};

describe('strategistRule (background strategist → strategy_update)', () => {
  it('volunteers an energy-save heads-up when energy binds and a VE-save is needed', () => {
    const events = run(
      [frame()],
      [plan({ bindingConstraint: 'energy', energySaveTargetPerLap01: 0.02 })],
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('strategy_update');
    expect(events[0]?.tier).toBe(2); // conversational, not a reflex
    expect(events[0]?.payload.kind).toBe('energy-save');
    expect(Number(events[0]?.payload.savePerLapPct)).toBeCloseTo(2); // 0.02 → 2%
  });

  it('volunteers a fuel-save heads-up when off the fuel plan', () => {
    const events = run(
      [frame()],
      [plan({ bindingConstraint: 'fuel', fuelSaveTargetLitersPerLap: 0.25 })],
    );
    expect(events[0]?.payload.kind).toBe('fuel-save');
    expect(Number(events[0]?.payload.savePerLapLiters)).toBeCloseTo(0.25);
  });

  it('prefers the energy headline when both apply and energy is the binding constraint', () => {
    const events = run(
      [frame()],
      [
        plan({
          bindingConstraint: 'energy',
          energySaveTargetPerLap01: 0.02,
          fuelSaveTargetLitersPerLap: 0.25,
        }),
      ],
    );
    expect(events[0]?.payload.kind).toBe('energy-save');
  });

  it('stays silent when on plan (no save targets)', () => {
    expect(run([frame()], [plan({ bindingConstraint: 'fuel' })])).toHaveLength(0);
  });

  it('stays silent below the confidence floor — never volunteers off a noisy early plan', () => {
    const noisy = plan({
      bindingConstraint: 'energy',
      energySaveTargetPerLap01: 0.02,
      confidence01: 0.2, // below the 0.4 floor
    });
    expect(run([frame()], [noisy])).toHaveLength(0);
  });

  it('carries confidence01 in the payload so downstream can hedge', () => {
    const events = run([frame()], [plan({ fuelSaveTargetLitersPerLap: 0.25, confidence01: 0.7 })]);
    expect(events[0]?.payload.confidence01).toBe(0.7);
  });

  it('stays silent when no fuel plan has been computed', () => {
    const detector = new EventDetector([strategistRule()]);
    expect(detector.process(frame())).toHaveLength(0); // no strategy passed at all
  });

  it('does not volunteer strategy while in the pit lane', () => {
    const events = run(
      [frame({ inPitLane: true })],
      [plan({ bindingConstraint: 'energy', energySaveTargetPerLap01: 0.02 })],
    );
    expect(events).toHaveLength(0);
  });

  it('speaks once per headline (cooldown), and re-fires when the headline changes', () => {
    const energy = plan({ bindingConstraint: 'energy', energySaveTargetPerLap01: 0.02 });
    const same = run([frame({ monotonicMs: 0 }), frame({ monotonicMs: 1000 })], [energy, energy]);
    expect(same).toHaveLength(1); // repeat within cooldown is suppressed

    const fuel = plan({ bindingConstraint: 'fuel', fuelSaveTargetLitersPerLap: 0.25 });
    const changed = run([frame({ monotonicMs: 0 }), frame({ monotonicMs: 1000 })], [energy, fuel]);
    expect(changed.map((e) => e.payload.kind)).toEqual(['energy-save', 'fuel-save']);
  });
});
