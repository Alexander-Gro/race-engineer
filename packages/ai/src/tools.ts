import type { CarState, RaceState } from '@race-engineer/core';
import type { RaceContext } from './context';
import type { ToolSpec } from './types';

/**
 * Read-only tools the AI Engineer calls to get numbers (docs/06 §Tools). **Every tool is
 * read-only — there is no tool that writes to the game** (CLAUDE.md rule 5). Each returns
 * structured, unit-labelled JSON with `confidence01` where relevant; the model quotes these
 * verbatim and never recomputes them (CLAUDE.md rule 1).
 *
 * Only the tools with real backing today are implemented (RaceState fields + the fuel model).
 * The rest of docs/06's surface (`get_stint_plan`, `project_pit_window`, `evaluate_undercut`,
 * `get_setup_summary`, `get_handling_diagnosis`, `verify_change`) lands with the strategy /
 * setup features that back them (M7/M9) — exposing them now would mean inventing numbers.
 */

export interface ToolDef {
  name: string;
  description: string;
  /** JSON Schema for arguments. All current tools take none. */
  parameters: Record<string, unknown>;
  /** Pure read of the context → JSON-serializable result. MUST NOT mutate `ctx`. */
  handler: (args: Record<string, unknown>, ctx: RaceContext) => unknown;
}

const NO_ARGS = { type: 'object', properties: {}, additionalProperties: false } as const;

const otherCars = (s: RaceState): CarState[] =>
  s.cars.filter((c) => !c.isPlayer && c.id !== s.player.id);

/** Nearest rival ahead (gapToPlayerS < 0, closest to 0) — docs/04 sign: +behind / −ahead. */
const nearestAhead = (s: RaceState): CarState | null => {
  const ahead = otherCars(s).filter((c) => c.gapToPlayerS !== null && c.gapToPlayerS < 0);
  ahead.sort((a, b) => (b.gapToPlayerS ?? -Infinity) - (a.gapToPlayerS ?? -Infinity));
  return ahead[0] ?? null;
};

/** Nearest rival behind (gapToPlayerS > 0, smallest). */
const nearestBehind = (s: RaceState): CarState | null => {
  const behind = otherCars(s).filter((c) => c.gapToPlayerS !== null && c.gapToPlayerS > 0);
  behind.sort((a, b) => (a.gapToPlayerS ?? Infinity) - (b.gapToPlayerS ?? Infinity));
  return behind[0] ?? null;
};

const rivalJson = (c: CarState) => ({
  id: c.id,
  driverName: c.driverName,
  className: c.className,
  gapToPlayerS: c.gapToPlayerS,
  gapToPlayerM: c.gapToPlayerM,
  closingRateMps: c.closingRateMps,
});

const WHEELS = ['FL', 'FR', 'RL', 'RR'] as const;

export const READ_ONLY_TOOLS: ToolDef[] = [
  {
    name: 'get_race_state',
    description:
      'Compact race briefing: session phase, position/class, laps and time remaining, last/best lap, fuel summary, flags, and the gaps to the cars immediately ahead and behind.',
    parameters: NO_ARGS,
    handler: (_args, ctx) => {
      const s = ctx.raceState;
      const p = s.player;
      const ahead = nearestAhead(s);
      const behind = nearestBehind(s);
      return {
        phase: s.session.phase,
        timed: s.session.isTimed,
        remainingS: s.session.remainingS,
        totalLaps: s.session.totalLaps,
        multiClass: s.session.multiClass,
        position: p.position,
        classPosition: p.classPosition,
        className: p.className,
        lapsCompleted: p.lapsCompleted,
        lastLapS: p.lastLapS,
        bestLapS: p.bestLapS,
        fuel: {
          liters: p.fuel.liters,
          perLapAvgLiters: p.fuel.perLapAvgLiters,
          lapsRemainingEst: p.fuel.lapsRemainingEst,
        },
        flag: s.flags.global,
        carAheadGapS: ahead?.gapToPlayerS ?? null,
        carBehindGapS: behind?.gapToPlayerS ?? null,
        units: { fuel: 'liters', temp: 'C', gap: 's', distance: 'm', speed: 'm/s' },
      };
    },
  },
  {
    name: 'get_rivals',
    description:
      'The nearest cars ahead of and behind the player (up to 3 each side), with class, time/distance gap, and closing rate — for traffic and undercut judgement.',
    parameters: NO_ARGS,
    handler: (_args, ctx) => {
      const s = ctx.raceState;
      const rivals = otherCars(s);
      const ahead = rivals
        .filter((c) => c.gapToPlayerS !== null && c.gapToPlayerS < 0)
        .sort((a, b) => (b.gapToPlayerS ?? -Infinity) - (a.gapToPlayerS ?? -Infinity))
        .slice(0, 3);
      const behind = rivals
        .filter((c) => c.gapToPlayerS !== null && c.gapToPlayerS > 0)
        .sort((a, b) => (a.gapToPlayerS ?? Infinity) - (b.gapToPlayerS ?? Infinity))
        .slice(0, 3);
      return {
        ahead: ahead.map(rivalJson),
        behind: behind.map(rivalJson),
        units: { gap: 's', distance: 'm', closingRate: 'm/s' },
      };
    },
  },
  {
    name: 'get_fuel_plan',
    description:
      'The current fuel plan from the strategy engine: per-lap use, laps remaining on fuel, fuel to finish, liters to add at the next stop, any fuel-save target, and a confidence. Returns available:false while consumption is still being learned.',
    parameters: NO_ARGS,
    handler: (_args, ctx) => {
      if (!ctx.fuelPlan) {
        return {
          available: false,
          reason: 'Fuel consumption not yet established',
          confidence01: 0,
        };
      }
      return { available: true, ...ctx.fuelPlan, units: { fuel: 'liters' } };
    },
  },
  {
    name: 'get_tire_status',
    description:
      'Per-wheel tire state ([FL, FR, RL, RR]): temperatures, pressure, wear (0=worn, 1=new), surface temp, and compound.',
    parameters: NO_ARGS,
    handler: (_args, ctx) => {
      const p = ctx.raceState.player;
      return {
        wheels: p.tires.map((t, i) => ({
          label: WHEELS[i] ?? `W${i}`,
          tempC: t.tempC,
          pressureKpa: t.pressureKpa,
          wear01: t.wear01,
          surfaceTempC: t.surfaceTempC,
          compound: t.compound,
        })),
        units: { temp: 'C', pressure: 'kPa', wear: '0..1 (1=new)' },
      };
    },
  },
  {
    name: 'get_current_aids',
    description:
      'Current driver-aid baseline (read-only): traction control, ABS, front brake-bias %, and engine map. Use this to advise a specific change for the driver to make — the app never changes it.',
    parameters: NO_ARGS,
    handler: (_args, ctx) => {
      const p = ctx.raceState.player;
      return {
        tc: p.aids.tc,
        abs: p.aids.abs,
        brakeBiasFrontPct: p.aids.brakeBias.frontPct,
        engineMap: p.engine.map,
        note: 'read-only baseline — advise the driver; the app never writes aids',
      };
    },
  },
];

/** Index tools by name for execution. */
export const toolRegistry = (tools: readonly ToolDef[] = READ_ONLY_TOOLS): Map<string, ToolDef> =>
  new Map(tools.map((t) => [t.name, t]));

/** Provider-facing schema for the tool set. */
export const toToolSpecs = (tools: readonly ToolDef[] = READ_ONLY_TOOLS): ToolSpec[] =>
  tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }));
