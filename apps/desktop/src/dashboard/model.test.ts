import {
  lowFuelState,
  makeCarState,
  midStintState,
  multiClassTrafficState,
  raceStartState,
} from '@race-engineer/core/fixtures';
import type { RaceState } from '@race-engineer/core';
import type { EngineerSnapshot } from '@race-engineer/engineer-core';
import { describe, expect, it } from 'vitest';
import { buildDashboardModel, type Severity } from './model';

const snap = (raceState: RaceState, seq = 1): EngineerSnapshot => ({
  seq,
  monotonicMs: raceState.monotonicMs,
  raceState,
});

const VALID: Severity[] = ['good', 'caution', 'critical', 'neutral', 'unknown'];

describe('fuel state honesty', () => {
  it('flags under-two-laps fuel as critical with the real number', () => {
    const m = buildDashboardModel(snap(lowFuelState));
    expect(m.fuel.lapsRemaining).toEqual({ value: '1.1', severity: 'critical' });
  });

  it('shows comfortable fuel as good', () => {
    const m = buildDashboardModel(snap(midStintState)); // 13.5 laps
    expect(m.fuel.lapsRemaining.severity).toBe('good');
    expect(m.fuel.lapsRemaining.value).toBe('13.5');
  });

  it('renders unknown fuel as — / unknown, never a fabricated 0 (race start: perLap & laps are null)', () => {
    const m = buildDashboardModel(snap(raceStartState));
    expect(m.fuel.lapsRemaining).toEqual({ value: '—', severity: 'unknown' });
    expect(m.fuel.perLap).toEqual({ value: '—', severity: 'unknown' });
    expect(m.fuel.liters.value).toBe('78.0 L'); // a real reading is still shown
    expect(m.fuel.addAtStop).toEqual({ value: '—', severity: 'unknown' }); // no strategy plan yet
    expect(m.fuel.nextPit).toEqual({ value: '—', severity: 'unknown' });
  });

  it('surfaces the Core strategy engine fuel + stint plan (add-at-stop, next pit) when present', () => {
    const withStrategy: EngineerSnapshot = {
      ...snap(midStintState),
      strategy: {
        fuelPlan: {
          perLapLiters: 2.6,
          lapsRemainingOnFuel: 16,
          lapsToFinish: 20,
          litersToFinish: 52,
          litersToAddNextStop: 12.5,
          fuelSaveTargetLitersPerLap: null,
          perLapEnergy01: null,
          lapsRemainingOnEnergy: null,
          energyToFinish01: null,
          energyToAddNextStop01: null,
          energySaveTargetPerLap01: null,
          bindingConstraint: null,
          confidence01: 0.8,
        },
        stintPlan: {
          stints: [
            {
              index: 0,
              startLap: 9,
              endLap: 18,
              fuelAddLiters: 50,
              tireCompound: null,
              expectedDegradation01: 0,
            },
          ],
          pitWindows: [{ earliestLap: 18, latestLap: 24, reason: 'fuel-limited' }],
          mandatoryStopsRemaining: null,
        },
      },
    };
    const m = buildDashboardModel(withStrategy);
    expect(m.fuel.addAtStop.value).toBe('12.5 L');
    expect(m.fuel.nextPit.value).toBe('18–24');
  });
});

describe('tyres & brakes', () => {
  it('classifies cold race-start tyres as caution and fresh wear as good', () => {
    const m = buildDashboardModel(snap(raceStartState)); // ~66° avg, wear 0.99
    expect(m.tyres.corners[0]!.temp.severity).toBe('caution'); // below the 80° window
    expect(m.tyres.corners[0]!.wear.severity).toBe('good');
    expect(m.tyres.corners[0]!.wear.value).toBe('99%');
  });

  it('flags worn tyres as caution (low-fuel fixture, fronts ~38%)', () => {
    const m = buildDashboardModel(snap(lowFuelState));
    expect(m.tyres.corners[0]!.wear.severity).toBe('caution'); // 0.38 ≤ 0.40
    expect(m.tyres.compound).toBe('medium');
  });

  it('shows brake temps as unknown when the adapter has not populated them', () => {
    const m = buildDashboardModel(snap(midStintState));
    expect(m.brakes.corners.every((c) => c.value === '—' && c.severity === 'unknown')).toBe(true);
  });
});

describe('standings & traffic', () => {
  it('picks the nearest car ahead and behind, with class and closing direction', () => {
    const m = buildDashboardModel(snap(multiClassTrafficState));
    expect(m.standings.position).toBe('P8 (class P2 LMP2)');
    expect(m.standings.ahead?.name).toBe('Leader'); // gap −94 s
    expect(m.standings.ahead?.gap.value).toBe('-94.0s');
    expect(m.standings.ahead?.closing).toBe('unknown'); // leader has no closing rate
    expect(m.standings.behind?.name).toBe('Lapper'); // gap +0.8 s, closing 12.5
    expect(m.standings.behind?.gap.value).toBe('+0.8s');
    expect(m.standings.behind?.closing).toBe('approaching');
  });

  it('raises the faster-class-approaching strip for a different-class car closing from behind', () => {
    expect(buildDashboardModel(snap(multiClassTrafficState)).standings.fasterClassApproaching).toBe(
      true,
    );
  });

  it('does not warn when the only nearby car is the same class', () => {
    // Same-class car closing from behind → not a multi-class traffic warning.
    const sameClass: RaceState = {
      ...lowFuelState,
      cars: [
        lowFuelState.player,
        { ...lowFuelState.cars[1]!, className: 'Hypercar', gapToPlayerS: 1.2, closingRateMps: 4 },
      ],
    };
    expect(buildDashboardModel(snap(sameClass)).standings.fasterClassApproaching).toBe(false);
  });
});

describe('flags, timing, aids', () => {
  it('maps flag severity (green→good, fcy→caution, red→critical)', () => {
    const withFlag = (global: RaceState['flags']['global']): Severity =>
      buildDashboardModel(snap({ ...raceStartState, flags: { ...raceStartState.flags, global } }))
        .session.flag.severity;
    expect(withFlag('green')).toBe('good');
    expect(withFlag('fcy')).toBe('caution');
    expect(withFlag('safetyCar')).toBe('caution');
    expect(withFlag('red')).toBe('critical');
  });

  it('shows delta-to-best (slower = neutral context, not red) and unknown lap times honestly', () => {
    const mid = buildDashboardModel(snap(midStintState)); // last 210.4, best 208.9
    expect(mid.timing.deltaToBest.value).toBe('+1.5s');
    expect(mid.timing.deltaToBest.severity).toBe('neutral');
    const start = buildDashboardModel(snap(raceStartState)); // no lap yet
    expect(start.timing.lastLap).toEqual({ value: '—', severity: 'unknown' });
    expect(start.timing.deltaToBest.severity).toBe('unknown');
  });

  it('shows aids as neutral readings (no good/bad colour), unknown when absent', () => {
    const m = buildDashboardModel(snap(lowFuelState));
    expect(m.aids.tc).toEqual({ value: '5', severity: 'neutral' });
    expect(m.aids.brakeBias).toEqual({ value: '54.0%', severity: 'neutral' });
    expect(m.aids.engineMap).toEqual({ value: '3', severity: 'neutral' });
  });
});

describe('engineer alerts', () => {
  it('formats snapshot events into alerts, dropping the lap_completed marker', () => {
    const withEvents: EngineerSnapshot = {
      ...snap(multiClassTrafficState),
      events: [
        { id: 'a', tick: 1, type: 'fuel_low', tier: 1, priority: 8, payload: {} },
        { id: 'b', tick: 1, type: 'car_left', tier: 0, priority: 90, payload: {} },
        { id: 'c', tick: 1, type: 'lap_completed', tier: 1, priority: 3, payload: {} },
      ],
    };
    expect(buildDashboardModel(withEvents).alerts).toEqual([
      { label: 'Fuel low', severity: 'caution' }, // Tier 1 → caution
      { label: 'Car left', severity: 'critical' }, // Tier 0 reflex → act-now
    ]);
  });

  it('has no alerts when the snapshot carries no events', () => {
    expect(buildDashboardModel(snap(raceStartState)).alerts).toEqual([]);
  });
});

describe('regression (pre-push review)', () => {
  it('faster-class strip scans the whole field, not just the nearest car behind', () => {
    // Nearest behind is same-class & slow; a different-class car closing fast is farther back.
    const state: RaceState = {
      ...raceStartState, // player is Hypercar
      cars: [
        raceStartState.player,
        makeCarState({
          id: 50,
          position: 6,
          className: 'Hypercar',
          gapToPlayerS: 0.5,
          closingRateMps: 1,
        }),
        makeCarState({
          id: 51,
          position: 7,
          className: 'LMP2',
          gapToPlayerS: 3.0,
          closingRateMps: 12,
        }),
      ],
    };
    expect(buildDashboardModel(snap(state)).standings.fasterClassApproaching).toBe(true);
  });

  it('never renders a misleading "-0.0" gap for a car rounding to alongside', () => {
    const state: RaceState = {
      ...raceStartState,
      cars: [
        raceStartState.player,
        makeCarState({ id: 60, position: 6, className: 'LMP2', gapToPlayerS: -0.04 }),
      ],
    };
    expect(buildDashboardModel(snap(state)).standings.ahead?.gap.value).toBe('0.0s');
  });

  it('never renders a "-0.0" delta-to-best; a clearly faster lap shows the negative', () => {
    const justUnder: RaceState = {
      ...midStintState,
      player: { ...midStintState.player, lastLapS: 208.87, bestLapS: 208.9 }, // −0.03 → rounds to 0
    };
    expect(buildDashboardModel(snap(justUnder)).timing.deltaToBest.value).toBe('0.0s');
    const faster: RaceState = {
      ...midStintState,
      player: { ...midStintState.player, lastLapS: 208.4, bestLapS: 208.9 }, // −0.5
    };
    expect(buildDashboardModel(snap(faster)).timing.deltaToBest).toEqual({
      value: '-0.5s',
      severity: 'good',
    });
  });
});

describe('properties', () => {
  it('every Reading carries a valid severity across all fixtures', () => {
    for (const state of [raceStartState, midStintState, lowFuelState, multiClassTrafficState]) {
      const m = buildDashboardModel(snap(state));
      const readings = [
        m.session.flag,
        m.session.remaining,
        m.fuel.lapsRemaining,
        m.fuel.liters,
        m.fuel.perLap,
        ...m.tyres.corners.flatMap((c) => [c.temp, c.wear, c.pressure]),
        ...m.brakes.corners,
        m.aids.tc,
        m.aids.abs,
        m.aids.brakeBias,
        m.aids.engineMap,
        m.timing.lastLap,
        m.timing.bestLap,
        m.timing.deltaToBest,
      ];
      for (const r of readings) {
        expect(VALID).toContain(r.severity);
        expect(typeof r.value).toBe('string');
        expect(r.value).not.toContain('NaN');
        if (r.severity === 'unknown') expect(r.value).toBe('—');
      }
    }
  });
});
