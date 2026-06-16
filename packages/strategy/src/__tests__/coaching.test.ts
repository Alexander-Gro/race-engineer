import { describe, expect, it } from 'vitest';
import type { FuelPlan, Tire } from '@race-engineer/core';
import { diagnoseHandling } from '../handling';
import { integratedCoaching } from '../coaching';

const zone = (c: number): Tire => ({
  tempC: { inner: c, center: c, outer: c },
  pressureKpa: null,
  wear01: null,
  compound: null,
  surfaceTempC: null,
});

const handling = (frontC: number, rearC: number) =>
  diagnoseHandling([zone(frontC), zone(frontC), zone(rearC), zone(rearC)]);

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

const understeer = handling(104, 86);
const oversteer = handling(86, 104);
const neutral = handling(90, 90);

describe('integratedCoaching', () => {
  it('understeer + energy-limited → lift earlier, linking energy + handling', () => {
    const notes = integratedCoaching({
      handling: understeer,
      fuelPlan: plan({ bindingConstraint: 'energy' }),
    });
    expect(notes[0]?.focus).toMatch(/lift/i);
    expect(notes[0]?.links).toEqual(expect.arrayContaining(['energy', 'handling']));
    expect(notes[0]?.rationale).toMatch(/energy/);
  });

  it('understeer alone → ease the entry, linking handling + tyres (no energy claim)', () => {
    const notes = integratedCoaching({ handling: understeer, fuelPlan: plan() });
    expect(notes[0]?.focus).toMatch(/brake.*earlier|ease the entry/i);
    expect(notes[0]?.links).toEqual(['handling', 'tyres']);
  });

  it('oversteer → gentler throttle; adds a short-shift note when energy-limited', () => {
    const plain = integratedCoaching({ handling: oversteer, fuelPlan: plan() });
    expect(plain[0]?.focus).toMatch(/throttle/i);
    expect(plain).toHaveLength(1);
    const limited = integratedCoaching({
      handling: oversteer,
      fuelPlan: plan({ bindingConstraint: 'energy' }),
    });
    expect(limited).toHaveLength(2);
    expect(limited[1]?.focus).toMatch(/short-shift/i);
  });

  it('says nothing when the balance is neutral (no cross-domain signal to link)', () => {
    expect(
      integratedCoaching({ handling: neutral, fuelPlan: plan({ bindingConstraint: 'energy' }) }),
    ).toEqual([]);
  });

  it('carries the diagnosis confidence and tolerates a null fuel plan', () => {
    const notes = integratedCoaching({ handling: understeer, fuelPlan: null });
    expect(notes[0]?.confidence01).toBe(understeer.confidence01);
    expect(notes[0]?.links).not.toContain('energy'); // no plan → not an energy note
  });
});
