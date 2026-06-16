import type { CarState, RaceState } from '@race-engineer/core';
import { diagnoseHandling } from '@race-engineer/strategy';
import type { RaceContext } from './context';
import type { ToolSpec } from './types';

/**
 * Read-only tools the AI Engineer calls to get numbers (docs/06 §Tools). **Every tool is
 * read-only — there is no tool that writes to the game** (CLAUDE.md rule 5). Each returns
 * structured, unit-labelled JSON with `confidence01` where relevant; the model quotes these
 * verbatim and never recomputes them (CLAUDE.md rule 1).
 *
 * Only the tools with real backing today are implemented (RaceState fields + the fuel/stint
 * models). `get_stint_plan` + `project_pit_window` read the precomputed stint plan (T7.3);
 * `get_handling_diagnosis` runs the deterministic tyre-temp diagnosis (T9.2). The rest of docs/06's
 * surface (`evaluate_undercut` — needs per-rival tyre-gain/pit-loss context fields the Core doesn't
 * expose yet; `get_setup_summary`, `verify_change` — M9 setup features needing the setup-file read)
 * still lands with the features that back them; exposing them now would mean inventing numbers.
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

/** Express a 0..1 fraction as a percentage for the tool surface (LMU shows VE as a %), or null. */
const asPct = (v: number | null): number | null => (v === null ? null : v * 100);

const WHEELS = ['FL', 'FR', 'RL', 'RR'] as const;

export const READ_ONLY_TOOLS: ToolDef[] = [
  {
    name: 'get_race_state',
    description:
      'Compact race briefing: session phase, position/class, laps and time remaining, last/best lap, fuel summary, Virtual Energy summary (LMU, as a %; null if not exposed), flags, and the gaps to the cars immediately ahead and behind.',
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
        // Virtual Energy (LMU) as a percentage of the per-stint budget; null when not exposed.
        virtualEnergy:
          p.virtualEnergy === null
            ? null
            : {
                levelPct: asPct(p.virtualEnergy.level01),
                perLapAvgPct: asPct(p.virtualEnergy.perLapAvg01),
                lapsRemainingEst: p.virtualEnergy.lapsRemainingEst,
              },
        flag: s.flags.global,
        carAheadGapS: ahead?.gapToPlayerS ?? null,
        carBehindGapS: behind?.gapToPlayerS ?? null,
        units: {
          fuel: 'liters',
          energy: 'percent',
          temp: 'C',
          gap: 's',
          distance: 'm',
          speed: 'm/s',
        },
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
      'The current fuel + Virtual-Energy plan from the strategy engine: per-lap fuel use, laps remaining on fuel, fuel to finish, liters to add at the next stop, any fuel-save target, and (LMU) the Virtual Energy figures as percentages. `bindingConstraint` says which resource runs out first — `energy` means the stint is energy-limited, not fuel-limited (advise on the binding one). `virtualEnergy` is null when the series has no VE. Returns available:false while consumption is still being learned.',
    parameters: NO_ARGS,
    handler: (_args, ctx) => {
      const fp = ctx.fuelPlan;
      if (!fp) {
        return {
          available: false,
          reason: 'Fuel consumption not yet established',
          confidence01: 0,
        };
      }
      return {
        available: true,
        perLapLiters: fp.perLapLiters,
        lapsRemainingOnFuel: fp.lapsRemainingOnFuel,
        lapsToFinish: fp.lapsToFinish,
        litersToFinish: fp.litersToFinish,
        litersToAddNextStop: fp.litersToAddNextStop,
        fuelSaveTargetLitersPerLap: fp.fuelSaveTargetLitersPerLap,
        // Which resource limits the stint: 'fuel' | 'energy' | null (no VE / still learning).
        bindingConstraint: fp.bindingConstraint,
        // Virtual Energy as percentages (the LMU convention), so figures are quoted directly;
        // null when the series doesn't expose VE — then plan on fuel alone.
        virtualEnergy:
          fp.perLapEnergy01 === null
            ? null
            : {
                lapsRemainingOnEnergy: fp.lapsRemainingOnEnergy,
                perLapEnergyPct: asPct(fp.perLapEnergy01),
                energyToFinishPct: asPct(fp.energyToFinish01),
                energyToAddNextStopPct: asPct(fp.energyToAddNextStop01),
                energySaveTargetPctPerLap: asPct(fp.energySaveTargetPerLap01),
              },
        confidence01: fp.confidence01,
        units: { fuel: 'liters', energy: 'percent of the per-stint VE budget', laps: 'count' },
      };
    },
  },
  {
    name: 'get_stint_plan',
    description:
      'The current stint plan from the strategy engine: per-stint lap boundaries, fuel to load, expected tyre degradation and compound, the pit windows, and mandatory stops remaining. Returns available:false until a plan has been computed.',
    parameters: NO_ARGS,
    handler: (_args, ctx) => {
      const plan = ctx.stintPlan ?? null;
      if (!plan) {
        return { available: false, reason: 'No stint plan computed yet' };
      }
      return { available: true, ...plan, units: { fuel: 'liters', laps: 'count' } };
    },
  },
  {
    name: 'project_pit_window',
    description:
      'The next pit window from the stint plan: the earliest and latest lap to pit, the recommended (balanced) lap, and why the window is bounded (fuel/tyre/mandatory). Returns available:false when no stop is planned.',
    parameters: NO_ARGS,
    handler: (_args, ctx) => {
      const plan = ctx.stintPlan ?? null;
      const window = plan?.pitWindows[0] ?? null;
      if (!plan || !window) {
        return { available: false, reason: 'No pit stop planned' };
      }
      return {
        available: true,
        earliestLap: window.earliestLap,
        latestLap: window.latestLap,
        // The balanced/nominal stop = the end of the stint this window closes (the first stint).
        recommendedLap: plan.stints[0]?.endLap ?? window.earliestLap,
        reason: window.reason,
        units: { laps: 'count' },
      };
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
    name: 'get_handling_diagnosis',
    description:
      'Deterministic handling read from tyre temps (docs/08 §3): per-corner camber (inner-vs-outer spread) and pressure (centre-vs-edges; centre hot = over-inflated), plus axle balance (front-vs-rear avg → understeer/oversteer). confidence01 = fraction of corners with 3-zone temps; advise from this, never invent.',
    parameters: NO_ARGS,
    handler: (_args, ctx) => {
      const d = diagnoseHandling(ctx.raceState.player.tires);
      const byCorner = <T extends { deltaC: number | null; hint: string }>(reads: readonly T[]) =>
        reads.map((r, i) => ({ corner: WHEELS[i] ?? `W${i}`, hint: r.hint, deltaC: r.deltaC }));
      return {
        balance: d.balance.tendency,
        frontAvgTempC: d.balance.frontAvgC,
        rearAvgTempC: d.balance.rearAvgC,
        frontRearDeltaC: d.balance.deltaC,
        camber: byCorner(d.camber),
        pressure: byCorner(d.pressure),
        confidence01: d.confidence01,
        units: { temp: 'C' },
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
