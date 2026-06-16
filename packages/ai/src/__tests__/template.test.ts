import { multiClassTrafficState } from '@race-engineer/core/fixtures';
import type { RaceState } from '@race-engineer/core';
import {
  computeFuelPlan,
  estimatePerLapConsumption,
  estimatePerLapEnergy,
  planStints,
} from '@race-engineer/strategy';
import { describe, expect, it } from 'vitest';
import type { RaceContext } from '../context';
import { templateAnswer } from '../template';

const fuelPlan = computeFuelPlan({
  fuelLiters: 20,
  consumption: estimatePerLapConsumption({ greenLapFuelDeltas: [2.6, 2.6, 2.6] }), // 2.6 L/lap
  race: { remainingS: 3600, avgGreenLapS: 200 }, // 18 laps to finish
});
// 30 laps, 60 L tank, 2.6 L/lap → window lap 8–22, recommended (end of first stint) 15.
const stintPlan = planStints({ raceLaps: 30, tankCapacityLiters: 60, perLapFuelLiters: 2.6 });
const ctx: RaceContext = { raceState: multiClassTrafficState, fuelPlan, stintPlan };

// An energy-limited context (plenty of fuel, VE the bind) for the Virtual Energy intents.
const veState: RaceState = {
  ...multiClassTrafficState,
  player: {
    ...multiClassTrafficState.player,
    virtualEnergy: { level01: 0.5, perLapAvg01: 0.05, lapsRemainingEst: 10 },
  },
};
const veFuelPlan = computeFuelPlan({
  fuelLiters: 60, // ≈ 23 laps on fuel
  consumption: estimatePerLapConsumption({ greenLapFuelDeltas: [2.6, 2.6, 2.6] }),
  energy: {
    level01: 0.5, // 10 laps on VE → energy binds
    consumption: estimatePerLapEnergy({ greenLapEnergyDeltas01: [0.05, 0.05, 0.05] }),
  },
});
const veCtx: RaceContext = { raceState: veState, fuelPlan: veFuelPlan, stintPlan };

describe('templateAnswer (free, no-LLM reactive answering)', () => {
  it('answers fuel questions from the precomputed plan, quoting the numbers verbatim', () => {
    const a = templateAnswer("how's my fuel?", ctx)!;
    expect(a).toMatch(/8 laps of fuel left/);
    expect(a).toMatch(/2\.60 per lap/);
    expect(a).toMatch(/add 29 litres/); // 46.8 to finish − 20 in tank + reserve
  });

  it('answers virtual-energy questions, quoting VE % and the binding constraint', () => {
    const a = templateAnswer("how's my virtual energy?", veCtx)!;
    expect(a).toMatch(/10 laps of virtual energy left/); // 0.5 / 0.05
    expect(a).toMatch(/5\.0% a lap/);
    expect(a).toMatch(/Energy's your limit/); // VE (10) binds before fuel (23)
  });

  it('makes the fuel answer VE-aware when energy is the tighter limit (the flagged gap)', () => {
    const a = templateAnswer("how's my fuel?", veCtx)!;
    expect(a).toMatch(/23 laps of fuel left/);
    expect(a).toMatch(/energy's the tighter limit/);
    expect(a).toMatch(/10 laps on VE/);
  });

  it('stays honest about VE when the source has none', () => {
    // The default ctx fuelPlan carries no VE → "no reading yet", never a fabricated %.
    expect(templateAnswer('how much energy do I have?', ctx)).toMatch(
      /[Nn]o virtual-energy reading/,
    );
  });

  it('answers pit-timing from the stint plan (checked before fuel)', () => {
    expect(templateAnswer('when should I box?', ctx)).toBe(
      'Next pit window is lap 8 to 22, aim for lap 15.',
    );
  });

  it('answers tyre questions from the most-worn corner + compound', () => {
    expect(templateAnswer('how are my tyres?', ctx)).toBe(
      'medium tyres, most-worn corner around 78%.',
    );
  });

  it('answers position/gap questions', () => {
    const a = templateAnswer('what position am I in?', ctx)!;
    expect(a).toMatch(/You're P8 \(P2 in class\)/);
    expect(a).toMatch(/0\.8s to the one behind/); // the lapping Hypercar +0.8 s
  });

  it('answers lap-time questions', () => {
    expect(templateAnswer("what's my last lap?", ctx)).toBe('Last lap 218.7, best 217.2.');
  });

  it('answers handling questions from the tyre-temp diagnosis, quoting the temps', () => {
    // Fixture tyres are uniform → neutral balance, fronts == rears == 89°.
    const a = templateAnswer("how's the handling?", ctx)!;
    expect(a).toMatch(/neutral/);
    expect(a).toContain('89');
  });

  it('gives advisory setup-change advice when asked how to fix the balance', () => {
    const hot = { inner: 105, center: 105, outer: 105 };
    const cool = { inner: 85, center: 85, outer: 85 };
    const tyre = (t: typeof hot) => ({
      tempC: t,
      pressureKpa: null,
      wear01: null,
      compound: null,
      surfaceTempC: null,
    });
    const understeer: RaceState = {
      ...multiClassTrafficState,
      player: {
        ...multiClassTrafficState.player,
        tires: [tyre(hot), tyre(hot), tyre(cool), tyre(cool)],
      },
    };
    const a = templateAnswer('how do I fix the understeer?', {
      raceState: understeer,
      fuelPlan: null,
    })!;
    expect(a).toMatch(/front/i); // free up the front
  });

  it('gives integrated coaching ("what should I focus on") linking the domains', () => {
    const hot = { inner: 105, center: 105, outer: 105 };
    const cool = { inner: 85, center: 85, outer: 85 };
    const tyre = (t: typeof hot) => ({
      tempC: t,
      pressureKpa: null,
      wear01: null,
      compound: null,
      surfaceTempC: null,
    });
    // Understeer (fronts hot) + energy-limited → the lift-earlier win-win note.
    const veFuelPlan = computeFuelPlan({
      fuelLiters: 60,
      consumption: estimatePerLapConsumption({ greenLapFuelDeltas: [2.6, 2.6, 2.6] }),
      energy: {
        level01: 0.5,
        consumption: estimatePerLapEnergy({ greenLapEnergyDeltas01: [0.05, 0.05, 0.05] }),
      },
    });
    const ctxVe: RaceContext = {
      raceState: {
        ...multiClassTrafficState,
        player: {
          ...multiClassTrafficState.player,
          tires: [tyre(hot), tyre(hot), tyre(cool), tyre(cool)],
        },
      },
      fuelPlan: veFuelPlan,
    };
    const a = templateAnswer('what should I focus on?', ctxVe)!;
    expect(a).toMatch(/lift/i);
    expect(a).toMatch(/energy/i); // links the energy + handling domains
  });

  it('says nothing to change when the balance reads settled', () => {
    // ctx's fixture tyres are uniform → balanced → no suggestion.
    expect(templateAnswer('what should I change in the setup?', ctx)).toMatch(
      /nothing I'?d change|settled/i,
    );
  });

  it('answers aid-baseline questions', () => {
    expect(templateAnswer("what's my brake bias?", ctx)).toBe(
      'TC 6, ABS 4, brake bias 55.0%, map 4.',
    );
  });

  it('stays honest when consumption is still being learned', () => {
    const learning: RaceContext = { raceState: multiClassTrafficState, fuelPlan: null };
    expect(templateAnswer('fuel?', learning)).toMatch(/[Ss]till learning/);
  });

  it('returns null when no intent matches, so a caller can fall back to the LLM', () => {
    expect(templateAnswer('tell me a joke', ctx)).toBeNull();
  });

  it('does not false-match unrelated words (review: word boundaries)', () => {
    // 'temp' inside 'tempo'/'attempts', bare 'stop', and 'how much <not fuel>' must NOT match.
    for (const q of [
      'should I keep up the tempo',
      'what attempts have I logged',
      'should I stop pushing',
      'how much time is left',
    ]) {
      expect(templateAnswer(q, ctx)).toBeNull();
    }
  });

  it('never invents numbers — every figure traces to a read-only tool result', () => {
    // The fuel answer's numbers are exactly the plan's (no recomputation).
    const a = templateAnswer('fuel', ctx)!;
    expect(a).toContain(fuelPlan!.perLapLiters.toFixed(2));
    expect(a).toContain(Math.round(fuelPlan!.litersToAddNextStop!).toString());
  });
});
