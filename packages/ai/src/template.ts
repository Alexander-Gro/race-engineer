import type { RaceContext } from './context';
import { toolRegistry } from './tools';

/**
 * Template-mode reactive answering (docs/15 §free routes) — the **free, offline, no-key** default
 * for "ask the engineer". A pure, deterministic responder: it matches a typed/spoken question to an
 * intent, reads the **read-only tools** (the same ones the LLM uses), and phrases a short answer that
 * quotes the tool numbers **verbatim**. No LLM, so no hallucination risk and nothing to pay for
 * (CLAUDE.md rule 1 holds trivially — the strategy math is the tools', never invented here).
 *
 * Returns `null` when no intent matches, so a caller can fall back to a configured LLM (Ollama/cloud)
 * or a "didn't catch that". Read-only/advisory throughout.
 */

const registry = toolRegistry();
const tool = (name: string, ctx: RaceContext): Record<string, unknown> =>
  registry.get(name)!.handler({}, ctx) as Record<string, unknown>;

const n = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const round = (v: unknown, digits = 0): string => {
  const x = n(v);
  return x === null ? '—' : x.toFixed(digits);
};

interface Intent {
  readonly test: RegExp;
  readonly respond: (ctx: RaceContext) => string;
}

const INTENTS: readonly Intent[] = [
  {
    // Pit / stint timing — check before "fuel" so "when do I pit" routes here. Bare "stop" is too
    // ambiguous ("stop saving", "stop pushing"), so it's left to fall through to the LLM.
    test: /\b(pit|box|stint)\b/,
    respond: (ctx) => {
      const pw = tool('project_pit_window', ctx);
      if (pw.available) {
        const target = n(pw.recommendedLap);
        return `Next pit window is lap ${round(pw.earliestLap)} to ${round(pw.latestLap)}${
          target !== null ? `, aim for lap ${round(target)}` : ''
        }.`;
      }
      if (tool('get_stint_plan', ctx).available) {
        return 'On the current plan you can run to the flag without another stop.';
      }
      return "No pit plan yet — I'm still working out your consumption.";
    },
  },
  {
    // Virtual Energy (LMU) — checked before "fuel" so an energy question never routes to fuel.
    test: /\bvirtual\s*energy\b|\benergy\b/,
    respond: (ctx) => {
      const fp = tool('get_fuel_plan', ctx);
      const ve = fp.available ? (fp.virtualEnergy as Record<string, unknown> | null) : null;
      if (!ve) {
        return "No virtual-energy reading yet — this car may not use it, or I'm still learning.";
      }
      let s = `About ${round(ve.lapsRemainingOnEnergy)} laps of virtual energy left, ${round(ve.perLapEnergyPct, 1)}% a lap.`;
      if (fp.bindingConstraint === 'energy') s += " Energy's your limit, not fuel.";
      else if (fp.bindingConstraint === 'fuel')
        s += " Fuel runs out first, so energy isn't the limit.";
      if (n(ve.energySaveTargetPctPerLap) !== null) {
        s += ` Save ${round(ve.energySaveTargetPctPerLap, 1)}% a lap to stretch it.`;
      }
      return s;
    },
  },
  {
    test: /\bfuel\b|laps?\s+(of\s+fuel|left|remaining)|how\s+much\s+fuel/,
    respond: (ctx) => {
      const fp = tool('get_fuel_plan', ctx);
      if (!fp.available) return 'Still learning your fuel use — give me a couple more green laps.';
      let s = `About ${round(fp.lapsRemainingOnFuel)} laps of fuel left, ${round(fp.perLapLiters, 2)} per lap.`;
      if (n(fp.litersToAddNextStop) !== null) {
        s += ` Plan to add ${round(fp.litersToAddNextStop)} litres at the next stop.`;
      }
      if (n(fp.fuelSaveTargetLitersPerLap) !== null) {
        s += ` Save ${round(fp.fuelSaveTargetLitersPerLap, 2)} a lap to stretch it.`;
      }
      // In LMU the stint can be energy-limited even with fuel to spare — say so (the user-flagged gap).
      if (fp.bindingConstraint === 'energy') {
        const ve = fp.virtualEnergy as Record<string, unknown> | null;
        if (ve)
          s += ` But energy's the tighter limit — about ${round(ve.lapsRemainingOnEnergy)} laps on VE.`;
      }
      return s;
    },
  },
  {
    // Word-bounded so it can't fire inside "attempts" / "tempo" / "swear".
    test: /\b(tyre|tire|wear|temp)s?\b/,
    respond: (ctx) => {
      const wheels = tool('get_tire_status', ctx).wheels as Array<Record<string, unknown>>;
      const wears = wheels.map((w) => n(w.wear01)).filter((x): x is number => x !== null);
      const compound = wheels[0]?.compound;
      const worst = wears.length > 0 ? Math.min(...wears) : null;
      const prefix = typeof compound === 'string' ? `${compound} tyres` : 'Tyres';
      return worst === null
        ? `${prefix} — no wear reading yet.`
        : `${prefix}, most-worn corner around ${Math.round(worst * 100)}%.`;
    },
  },
  {
    test: /\b(position|where\s+am\s+i|gap|ahead|behind|rival|who'?s?)\b/,
    respond: (ctx) => {
      const rs = tool('get_race_state', ctx);
      let s = `You're P${round(rs.position)}`;
      if (n(rs.classPosition) !== null) s += ` (P${round(rs.classPosition)} in class)`;
      s += '.';
      if (n(rs.carAheadGapS) !== null)
        s += ` ${round(Math.abs(n(rs.carAheadGapS)!), 1)}s to the car ahead.`;
      if (n(rs.carBehindGapS) !== null)
        s += ` ${round(n(rs.carBehindGapS), 1)}s to the one behind.`;
      return s;
    },
  },
  {
    test: /\b(last\s+lap|best\s+lap|lap\s+time|pace)\b/,
    respond: (ctx) => {
      const rs = tool('get_race_state', ctx);
      if (n(rs.lastLapS) === null) return 'No lap time yet.';
      let s = `Last lap ${round(rs.lastLapS, 1)}`;
      if (n(rs.bestLapS) !== null) s += `, best ${round(rs.bestLapS, 1)}`;
      return `${s}.`;
    },
  },
  {
    // Setup-change advice — checked before the handling *read* so "how do I fix the understeer"
    // gets a suggestion, while "how's the handling" still describes the balance.
    test: /\bset-?up\b|what should i change|how (do|can) i fix|fix.{0,8}(under|over)steer|reduce.{0,14}(under|over)steer/,
    respond: (ctx) => {
      const r = tool('propose_setup_change', ctx);
      const suggestions = (r.suggestions as Array<Record<string, unknown>>) ?? [];
      const top = suggestions[0];
      return top
        ? String(top.change)
        : "Balance looks settled — nothing I'd change from the tyre temps right now.";
    },
  },
  {
    // Handling/balance — distinct keywords from the tyre-wear intent above (no overlap).
    test: /\b(handling|understeer|oversteer|rotate|balance|camber)\b/,
    respond: (ctx) => {
      const d = tool('get_handling_diagnosis', ctx);
      const balance = d.balance as string;
      if (balance === 'unknown') return 'Not enough tyre-temp data to read the handling yet.';
      const front = round(d.frontAvgTempC);
      const rear = round(d.rearAvgTempC);
      if (balance === 'neutral') return `Balance looks neutral — fronts ${front}°, rears ${rear}°.`;
      const hotter = balance === 'understeer' ? 'fronts' : 'rears';
      return `Looks like ${balance} — ${hotter} are running hotter (${front}° front, ${rear}° rear).`;
    },
  },
  {
    test: /\b(tc|abs|traction|brake\s*bias|engine\s*map|aids?)\b/,
    respond: (ctx) => {
      const a = tool('get_current_aids', ctx);
      const tc = a.tc as { value?: unknown } | null;
      const abs = a.abs as { value?: unknown } | null;
      return `TC ${round(tc?.value)}, ABS ${round(abs?.value)}, brake bias ${round(a.brakeBiasFrontPct, 1)}%, map ${round(a.engineMap)}.`;
    },
  },
];

/**
 * Answer a question from the read-only tools without an LLM (docs/15 template mode), or `null` when
 * no intent matches. Numbers are quoted verbatim from the tools — never recomputed.
 */
export const templateAnswer = (question: string, ctx: RaceContext): string | null => {
  const q = question.toLowerCase();
  for (const intent of INTENTS) {
    if (intent.test.test(q)) return intent.respond(ctx);
  }
  return null;
};
