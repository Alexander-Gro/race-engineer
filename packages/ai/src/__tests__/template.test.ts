import { multiClassTrafficState } from '@race-engineer/core/fixtures';
import { computeFuelPlan, estimatePerLapConsumption, planStints } from '@race-engineer/strategy';
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

describe('templateAnswer (free, no-LLM reactive answering)', () => {
  it('answers fuel questions from the precomputed plan, quoting the numbers verbatim', () => {
    const a = templateAnswer("how's my fuel?", ctx)!;
    expect(a).toMatch(/8 laps of fuel left/);
    expect(a).toMatch(/2\.60 per lap/);
    expect(a).toMatch(/add 29 litres/); // 46.8 to finish − 20 in tank + reserve
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
