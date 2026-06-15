import { multiClassTrafficState } from '@race-engineer/core/fixtures';
import { computeFuelPlan, estimatePerLapConsumption } from '@race-engineer/strategy';
import { describe, expect, it } from 'vitest';
import { ASK_FALLBACK, askEngineer } from '../ask';
import type { RaceContext } from '../context';
import { templateAnswer } from '../template';

const fuelPlan = computeFuelPlan({
  fuelLiters: 20,
  consumption: estimatePerLapConsumption({ greenLapFuelDeltas: [2.6, 2.6, 2.6] }),
  race: { remainingS: 3600, avgGreenLapS: 200 },
});
const ctx: RaceContext = { raceState: multiClassTrafficState, fuelPlan };

describe('askEngineer (free, no-key answering entry point)', () => {
  it('returns the template answer verbatim when an intent matches', () => {
    expect(askEngineer("how's my fuel?", ctx)).toBe(templateAnswer("how's my fuel?", ctx));
  });

  it('falls back to a short guiding prompt when no intent matches', () => {
    expect(templateAnswer('tell me a joke', ctx)).toBeNull();
    expect(askEngineer('tell me a joke', ctx)).toBe(ASK_FALLBACK);
  });

  it('always returns a non-empty string (never null) so the UI always has something to show', () => {
    for (const q of ['fuel', 'tyres', 'where am I', 'asdfghjkl', '']) {
      expect(askEngineer(q, ctx)).toBeTruthy();
    }
  });
});
