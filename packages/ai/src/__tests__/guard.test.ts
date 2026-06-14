import { multiClassTrafficState } from '@race-engineer/core/fixtures';
import { computeFuelPlan, estimatePerLapConsumption } from '@race-engineer/strategy';
import { describe, expect, it } from 'vitest';
import type { RaceContext } from '../context';
import { checkSpokenNumbers, extractNumbers } from '../guard';
import { FakeProvider, runRadioTurn } from '../index';
import type { ExecutedToolCall } from '../orchestrator';

const call = (name: string, result: unknown): ExecutedToolCall => ({ name, args: {}, result });

describe('extractNumbers', () => {
  it('pulls digit-form numbers with the precision the speaker used', () => {
    expect(extractNumbers('P8, 14.2 laps, gap 1.5')).toEqual([
      { value: 8, text: '8', decimals: 0 },
      { value: 14.2, text: '14.2', decimals: 1 },
      { value: 1.5, text: '1.5', decimals: 1 },
    ]);
    expect(extractNumbers('box this lap')).toEqual([]);
  });

  it('parses thousands-grouped numbers and treats a hyphen as punctuation, not a sign', () => {
    expect(extractNumbers('7,000 rpm')).toEqual([{ value: 7000, text: '7,000', decimals: 0 }]);
    expect(extractNumbers('lap-2, gap -1.5')).toEqual([
      { value: 2, text: '2', decimals: 0 },
      { value: 1.5, text: '1.5', decimals: 1 },
    ]);
  });
});

describe('checkSpokenNumbers (hallucination guard)', () => {
  it('passes when every spoken number is a tool number', () => {
    expect(
      checkSpokenNumbers({
        text: 'Fuel is good, 14.2 laps in the tank.',
        toolCalls: [call('get_fuel_plan', { lapsRemainingOnFuel: 14.2 })],
      }),
    ).toEqual({ grounded: true, ungrounded: [], checked: 1 });
  });

  it('tolerates the model rounding a tool figure (14.18 → "14.2")', () => {
    expect(
      checkSpokenNumbers({
        text: '14.2 laps left.',
        toolCalls: [call('get_fuel_plan', { lapsRemainingOnFuel: 14.18 })],
      }).grounded,
    ).toBe(true);
  });

  it('is sign-insensitive — gaps are signed in tools, spoken unsigned with direction in words', () => {
    expect(
      checkSpokenNumbers({
        text: "He's 1.5 ahead.",
        toolCalls: [call('get_rivals', { ahead: [{ gapToPlayerS: -1.5 }] })],
      }).grounded,
    ).toBe(true);
  });

  it('finds numbers nested inside tool results', () => {
    expect(
      checkSpokenNumbers({
        text: 'Car behind is 0.8 back.',
        toolCalls: [call('get_rivals', { behind: [{ driverName: 'Lapper', gapToPlayerS: 0.8 }] })],
      }).grounded,
    ).toBe(true);
  });

  it('FAILS a planted hallucination — a spoken number with no tool source', () => {
    const r = checkSpokenNumbers({
      text: 'You have 9 laps of fuel, plenty.',
      toolCalls: [call('get_fuel_plan', { lapsRemainingOnFuel: 14.2 })],
    });
    expect(r.grounded).toBe(false);
    expect(r.ungrounded.map((u) => u.value)).toEqual([9]);
  });

  it('grounds a thousands-grouped quote against the plain tool number', () => {
    expect(
      checkSpokenNumbers({
        text: 'Revs are at 7,000.',
        toolCalls: [call('get_engine', { rpm: 7000 })],
      }).grounded,
    ).toBe(true);
  });

  it('treats a reply with no numbers as grounded', () => {
    expect(checkSpokenNumbers({ text: "I don't have that.", toolCalls: [] })).toEqual({
      grounded: true,
      ungrounded: [],
      checked: 0,
    });
  });
});

describe('guard over a real runRadioTurn result (end-to-end provenance)', () => {
  const ctx: RaceContext = {
    raceState: multiClassTrafficState,
    fuelPlan: computeFuelPlan({
      fuelLiters: 38,
      consumption: estimatePerLapConsumption({ greenLapFuelDeltas: [2.6, 2.6, 2.6] }),
    }),
  };

  it('passes when the model quotes the tool number verbatim', async () => {
    const provider = new FakeProvider([
      { tools: [{ name: 'get_fuel_plan' }] },
      {
        text: (res) => {
          const plan = res.get_fuel_plan as { lapsRemainingOnFuel: number };
          return `Fuel's good, ${plan.lapsRemainingOnFuel.toFixed(1)} laps.`;
        },
      },
    ]);
    const result = await runRadioTurn({
      provider,
      context: () => ctx,
      userMessage: "how's my fuel",
    });
    expect(checkSpokenNumbers(result).grounded).toBe(true);
  });

  it('fails when the model invents a figure the tools never returned', async () => {
    const provider = new FakeProvider([
      { tools: [{ name: 'get_fuel_plan' }] },
      { text: 'Only 99 laps of fuel — plenty.' }, // fabricated; the tool figure is ~14.6
    ]);
    const result = await runRadioTurn({
      provider,
      context: () => ctx,
      userMessage: "how's my fuel",
    });
    const report = checkSpokenNumbers(result);
    expect(report.grounded).toBe(false);
    expect(report.ungrounded.some((u) => u.value === 99)).toBe(true);
  });
});
