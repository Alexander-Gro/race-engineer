import type { RaceState } from '@race-engineer/core';
import {
  defaultSyntheticConfig,
  readReplayFile,
  scriptedScenario,
  synthesizeFrames,
} from '@race-engineer/adapter-sim-replay';
import { LATENCY_BUDGET_MS, evalEventCorrectness, evalFuelAccuracy } from '@race-engineer/eval';

/**
 * `pnpm eval <synthetic|replay <file>>` — runs the accuracy + correctness eval suites over an
 * offline telemetry source and prints a human-readable report (build-plan T10.4, docs/10
 * acceptance gates). The same evals run in CI as tests; this is the dev-loop view. Read-only.
 *
 * The latency gate (Tier-2 first-audio < budget) is a radio-loop measurement and runs in the test
 * suite (`packages/eval/src/__tests__/latency.test.ts`); the budgets are printed here for reference.
 */

const usage = `Usage:
  pnpm eval synthetic [--scenario scripted|default|stint]
  pnpm eval replay <file.jsonl>`;

const buildFrames = async (
  mode: string | undefined,
  argv: string[],
): Promise<RaceState[] | null> => {
  if (mode === 'synthetic') {
    const scenario = argv.includes('--scenario')
      ? (argv[argv.indexOf('--scenario') + 1] ?? '')
      : '';
    if (scenario === 'default') return synthesizeFrames(defaultSyntheticConfig());
    if (scenario === 'stint') {
      // A longer multi-lap burn so the fuel-accuracy convergence is visible end-to-end.
      return synthesizeFrames({ ...defaultSyntheticConfig(), baseLapTimeS: 20, hz: 2, ticks: 400 });
    }
    return synthesizeFrames(scriptedScenario());
  }
  if (mode === 'replay') {
    const file = argv[1];
    if (file === undefined || file.startsWith('--')) return null;
    return readReplayFile(file);
  }
  return null;
};

const fmt = (v: number | null, digits = 2): string => (v === null ? '—' : v.toFixed(digits));

const main = async (): Promise<void> => {
  const argv = process.argv.slice(2);
  const frames = await buildFrames(argv[0], argv);
  if (!frames) {
    console.error(usage);
    process.exitCode = 1;
    return;
  }
  console.log(`# eval over ${frames.length} frames (source=${argv[0]})\n`);

  // --- Accuracy: fuel-to-finish (docs/10 Phase-2 gate) ---
  const fuel = evalFuelAccuracy(frames);
  console.log('## Fuel accuracy (docs/10: ±1 lap by mid-stint)');
  if (fuel.silent) {
    console.log('  silent — no completed green laps with fuel burn (model rightly says nothing)\n');
  } else {
    console.log(`  ground-truth per-lap : ${fmt(fuel.groundTruthPerLapLiters)} L`);
    console.log(`  completed green laps : ${fuel.completedGreenLaps}`);
    console.log(`  max confidence       : ${fmt(fuel.maxConfidence01)}`);
    console.log(`  mid-stint lap        : ${fuel.midStintLap ?? '—'}`);
    console.log(`  max laps-error ≥ mid : ${fmt(fuel.midStintMaxLapsErrorAbs)}`);
    console.log(`  WITHIN ±1 BY MID     : ${fuel.withinToleranceByMidStint ? 'PASS' : 'FAIL'}\n`);
  }

  // --- Correctness: events on the stream (docs/04) ---
  const events = evalEventCorrectness(frames);
  console.log('## Event correctness');
  console.log(`  total events         : ${events.totalEvents}`);
  console.log(`  by type              : ${JSON.stringify(events.countsByType)}`);
  console.log(
    `  lap markers match    : ${events.lapMarkersMatch ? 'PASS' : 'FAIL'} ` +
      `(${events.lapCompletedEvents} events / ${events.actualLapBoundaries} boundaries)`,
  );
  console.log(
    `  all well-formed      : ${events.allWellFormed ? 'PASS' : `FAIL (${events.malformed.length})`}`,
  );
  console.log(`  max events / tick    : ${events.maxEventsPerTick}\n`);

  // --- Latency: budgets for reference (gate runs in the test suite) ---
  console.log('## Latency budgets (ms to first audio, docs/01)');
  console.log(`  ${JSON.stringify(LATENCY_BUDGET_MS)}`);
  console.log('  (Tier-2 conversational gate runs in packages/eval/src/__tests__/latency.test.ts)');
};

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
