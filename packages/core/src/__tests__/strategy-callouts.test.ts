import { describe, expect, it } from 'vitest';
import { EventDetector, strategyCalloutRule, type DetectionStrategy } from '../events';
import { raceStartState } from '../fixtures';
import type { EngineerEvent, FuelPlan, RaceState, StintPlan } from '../schema';

/** A fuel plan at a given confidence (only `confidence01` matters to the rule's gate). */
const fuelPlanAt = (confidence01: number): FuelPlan => ({
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
  confidence01,
});

/** A frame at a given current lap (lapsCompleted = lap − 1), clock ms, and pit-lane state. */
const frame = (lap: number, ms: number, inPitLane = false): RaceState => ({
  ...raceStartState,
  tick: ms,
  monotonicMs: ms,
  player: {
    ...raceStartState.player,
    lapsCompleted: lap - 1,
    pit: { ...raceStartState.player.pit, inPitLane },
  },
});

/** A strategy with one pit window [earliest, latest] (confident by default); `null` plan = nothing learned. */
const strat = (
  window: { earliest: number; latest: number } | null,
  confidence01 = 0.9,
): DetectionStrategy => ({
  fuelPlan: window === null ? null : fuelPlanAt(confidence01),
  stintPlan:
    window === null
      ? null
      : ({
          stints: [],
          pitWindows: [{ earliestLap: window.earliest, latestLap: window.latest, reason: 'fuel' }],
          mandatoryStopsRemaining: null,
        } satisfies StintPlan),
});

/** Drive an arc of (lap, ms) frames through a detector with a fixed window; collect all events. */
const run = (
  laps: Array<[number, number]>,
  window: { earliest: number; latest: number } | null,
  opts: { inPitLane?: boolean; confidence01?: number } = {},
): EngineerEvent[] => {
  const detector = new EventDetector([strategyCalloutRule()]);
  const emitted: EngineerEvent[] = [];
  for (const [lap, ms] of laps) {
    emitted.push(
      ...detector.process(
        frame(lap, ms, opts.inPitLane ?? false),
        strat(window, opts.confidence01),
      ),
    );
  }
  return emitted;
};

const types = (events: EngineerEvent[]): string[] => events.map((e) => e.type);

describe('strategyCalloutRule', () => {
  const WINDOW = { earliest: 10, latest: 14 };

  it('fires pit_window_open once, on the lap the window opens', () => {
    const events = run(
      [
        [8, 0],
        [9, 1000], // still before the window
        [10, 2000], // crosses earliestLap → open
        [11, 3000], // inside the window — no repeat
        [12, 4000],
      ],
      WINDOW,
    );
    expect(types(events)).toEqual(['pit_window_open']);
    const open = events[0]!;
    expect(open.tier).toBe(2);
    expect(open.payload).toMatchObject({ earliestLap: 10, latestLap: 14 });
  });

  it('fires box_this_lap (Tier 1) when the window deadline is crossed', () => {
    const events = run(
      [
        [10, 0], // open fires here
        [13, 1000],
        [14, 2000], // crosses latestLap → box this lap
        [15, 3000], // already past — no repeat
      ],
      WINDOW,
    );
    expect(types(events)).toEqual(['pit_window_open', 'box_this_lap']);
    expect(events[1]!.tier).toBe(1);
    expect(events[1]!.payload).toMatchObject({ latestLap: 14 });
  });

  it('says nothing without a stint plan', () => {
    expect(
      run(
        [
          [10, 0],
          [14, 1000],
        ],
        null,
      ),
    ).toEqual([]);
  });

  it('stays silent while the driver is already in the pit lane', () => {
    expect(
      run(
        [
          [10, 0],
          [14, 1000],
        ],
        WINDOW,
        { inPitLane: true },
      ),
    ).toEqual([]);
  });

  it('stays silent until the fuel plan is confident enough (docs/05 §8)', () => {
    // Same crossing as the open test, but a low-confidence plan → no spoken call-out.
    const shaky = run(
      [
        [9, 0],
        [10, 1000],
      ],
      WINDOW,
      { confidence01: 0.1 },
    );
    expect(shaky).toEqual([]);
    // Once confident, the same crossing speaks.
    const confident = run(
      [
        [9, 0],
        [10, 1000],
      ],
      WINDOW,
      { confidence01: 0.8 },
    );
    expect(types(confident)).toEqual(['pit_window_open']);
  });

  it('does not re-announce an open window when joining mid-window', () => {
    // First observed lap is already inside the window → no crossing of earliestLap.
    const events = run(
      [
        [12, 0],
        [13, 1000],
      ],
      WINDOW,
    );
    expect(types(events)).toEqual([]);
  });
});
