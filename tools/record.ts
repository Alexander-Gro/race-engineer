import { LmuAdapter, createLmuNormalizer, openShmReader } from '@race-engineer/adapter-lmu';
import { Recorder } from '@race-engineer/adapter-sim-replay';
import { runPipeline } from '@race-engineer/core';

/**
 * `pnpm record [--frames N] [--hz H] [--out file]` — capture a live LMU session to a replay
 * file (build-plan T2.4). Wires Adapter → Normalizer → Recorder and saves canonical `RaceState`
 * frames that `pnpm replay <file>` reads back through the full pipeline. Use it to record a real
 * stint and commit a trimmed version as a fixture, replacing synthetic data (docs/03).
 *
 * Windows-only (needs LMU running with the plugin enabled); strictly read-only.
 */

interface Flags {
  frames: number;
  hz: number;
  out: string;
}

const parseFlags = (args: string[]): Flags => {
  const flags: Flags = { frames: 600, hz: 50, out: 'recording.jsonl' };
  for (let i = 0; i < args.length; i += 1) {
    const next = args[i + 1] ?? '';
    if (args[i] === '--frames') {
      flags.frames = Math.max(1, Number.parseInt(next, 10) || flags.frames);
      i += 1;
    } else if (args[i] === '--hz') {
      flags.hz = Math.max(1, Number.parseInt(next, 10) || flags.hz);
      i += 1;
    } else if (args[i] === '--out') {
      if (next) flags.out = next;
      i += 1;
    }
  }
  return flags;
};

const main = async (): Promise<void> => {
  const flags = parseFlags(process.argv.slice(2));

  // Fail fast if the game isn't up, rather than spinning forever with no frames.
  const probe = openShmReader();
  const available = probe.available.telemetry || probe.available.scoring;
  probe.close();
  if (!available) {
    console.error(
      'LMU shared memory not found. Is LMU running with the rF2 Shared Memory Map plugin ' +
        'installed + enabled? See docs/03 §S1.',
    );
    process.exitCode = 1;
    return;
  }

  const adapter = new LmuAdapter({ hz: flags.hz });
  const normalizer = createLmuNormalizer();
  const recorder = new Recorder({ maxFrames: flags.frames });
  console.log(`# recording up to ${flags.frames} frames @ ${flags.hz}Hz -> ${flags.out}`);

  await runPipeline({
    adapter,
    normalizer,
    onState: (state) => {
      recorder.add(state);
      if (recorder.count % 25 === 0) {
        process.stdout.write(`\r  captured ${recorder.count}/${flags.frames}`);
      }
      if (recorder.count >= flags.frames) void adapter.stop();
    },
  });

  await recorder.save(flags.out);
  console.log(`\n# saved ${recorder.count} frames to ${flags.out}`);
  if (recorder.truncated) {
    console.log(`# note: hit the ${flags.frames}-frame cap — pass --frames N for a longer stint`);
  }
  console.log(`# replay with:  pnpm replay ${flags.out}`);
};

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
