import { createCanonicalNormalizer, runPipeline } from '@race-engineer/core';
import type { GameAdapter, RaceState } from '@race-engineer/core';
import {
  defaultSyntheticConfig,
  readReplayFile,
  replayAdapter,
  scriptedScenario,
  syntheticAdapter,
} from '@race-engineer/adapter-sim-replay';

/**
 * `pnpm inspect <synthetic|replay>` — drives the tick pipeline (Adapter → Normalizer →
 * RaceState stream) from an offline source and prints the evolving canonical state. A dev
 * tool to eyeball the pipeline with no game running (build-plan T0.5).
 */

const usage = `Usage:
  pnpm inspect synthetic [--scenario scripted|default] [--every N] [--limit N]
  pnpm inspect replay <file.jsonl> [--every N] [--limit N]`;

interface Flags {
  every: number;
  limit: number;
  scenario: string;
}

const parseFlags = (args: string[]): Flags => {
  const flags: Flags = { every: 30, limit: Number.POSITIVE_INFINITY, scenario: 'scripted' };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const next = args[i + 1] ?? '';
    if (arg === '--every') {
      flags.every = Math.max(1, Number.parseInt(next, 10) || flags.every);
      i += 1;
    } else if (arg === '--limit') {
      flags.limit = Math.max(1, Number.parseInt(next, 10) || flags.limit);
      i += 1;
    } else if (arg === '--scenario') {
      flags.scenario = next || flags.scenario;
      i += 1;
    }
  }
  return flags;
};

const buildAdapter = async (
  mode: string | undefined,
  argv: string[],
  flags: Flags,
): Promise<GameAdapter<RaceState> | null> => {
  if (mode === 'synthetic') {
    const config = flags.scenario === 'default' ? defaultSyntheticConfig() : scriptedScenario();
    return syntheticAdapter(config);
  }
  if (mode === 'replay') {
    const file = argv[1];
    if (file === undefined || file.startsWith('--')) return null;
    return replayAdapter(await readReplayFile(file));
  }
  return null;
};

const formatLine = (s: RaceState): string => {
  const fuel = s.player.fuel;
  const perLap = fuel.perLapAvgLiters === null ? '  —' : fuel.perLapAvgLiters.toFixed(2);
  const rem = fuel.lapsRemainingEst === null ? ' —' : fuel.lapsRemainingEst.toFixed(1);
  const leader = s.cars.find((c) => c.position === 1);
  return [
    `t=${s.session.elapsedS.toFixed(0).padStart(4)}s`,
    `tick=${String(s.tick).padStart(4)}`,
    `lap=${s.player.lapsCompleted}`,
    `P${s.player.position}`,
    `fuel=${fuel.liters.toFixed(1).padStart(5)}L`,
    `perLap=${perLap}`,
    `rem=${rem}`,
    `leader=${leader?.driverName ?? '?'}`,
  ].join('  ');
};

const main = async (): Promise<void> => {
  const argv = process.argv.slice(2);
  const mode = argv[0];
  const flags = parseFlags(argv.slice(1));

  const adapter = await buildAdapter(mode, argv, flags);
  if (!adapter) {
    console.error(usage);
    process.exitCode = 1;
    return;
  }

  const normalizer = createCanonicalNormalizer();
  const caps = adapter.capabilities();
  let total = 0;
  let printed = 0;

  const onState = (s: RaceState): void => {
    if (total === 0) {
      console.log(
        `# source=${adapter.id}  track=${s.track.name}  phase=${s.session.phase}  multiClass=${s.session.multiClass}`,
      );
      console.log(`# capabilities: ${JSON.stringify({ ...caps, fields: [...caps.fields] })}`);
    }
    total += 1;
    if ((total === 1 || s.tick % flags.every === 0) && printed < flags.limit) {
      console.log(formatLine(s));
      printed += 1;
    }
  };

  await runPipeline({ adapter, normalizer, onState });
  console.log(`# done: ${total} frames, ${printed} printed`);
};

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
