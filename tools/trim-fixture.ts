import { readFileSync, writeFileSync } from 'node:fs';
import { parseReplay } from '@race-engineer/adapter-sim-replay';
import { RaceStateSchema, type RaceState } from '@race-engineer/core';

/**
 * `pnpm tsx tools/trim-fixture.ts <in.jsonl> <out.jsonl> [opts]` — turn a large `pnpm record` capture
 * into a small, committable test fixture (build-plan T1.5). A raw live frame is ~24 KB (53 cars), so a
 * multi-lap stint is hundreds of MB; this **downsamples** (stride) and **prunes `cars[]`** to the player
 * plus the nearest few per class, keeping every frame schema-valid canonical `RaceState` while shrinking
 * it ~10× for git. The `player` block (fuel/laps/tyres — what the fuel/strategy evals read) is untouched.
 *
 * Strictly read-only with respect to the game — it only reshapes an already-captured replay file.
 *
 *   --stride N          keep every Nth frame (default 1)
 *   --from F --to T     frame index slice [F, T) applied before stride (default whole file)
 *   --cars-per-class K  keep the player + K nearest cars per class (by |gapToPlayerM|); default keep all
 */

interface Opts {
  stride: number;
  from: number;
  to: number;
  carsPerClass: number | null;
}

const parseOpts = (args: string[]): Opts => {
  const opts: Opts = { stride: 1, from: 0, to: Infinity, carsPerClass: null };
  for (let i = 0; i < args.length; i += 1) {
    const next = args[i + 1] ?? '';
    if (args[i] === '--stride') opts.stride = Math.max(1, Number.parseInt(next, 10) || 1);
    else if (args[i] === '--from') opts.from = Math.max(0, Number.parseInt(next, 10) || 0);
    else if (args[i] === '--to') opts.to = Number.parseInt(next, 10) || Infinity;
    else if (args[i] === '--cars-per-class')
      opts.carsPerClass = Math.max(0, Number.parseInt(next, 10) || 0);
  }
  return opts;
};

/**
 * Redact the human player's driver name to a placeholder — a committed public fixture must not carry
 * a real person's name (the evals never read it). AI rivals keep their (public, shipped) names.
 */
const scrubPlayerName = (frame: RaceState): RaceState => ({
  ...frame,
  player: { ...frame.player, driverName: 'Player' },
  cars: frame.cars.map((c) => (c.isPlayer ? { ...c, driverName: 'Player' } : c)),
});

/** Keep the player car + the `k` nearest cars of each class (by absolute along-track gap). */
const pruneCars = (frame: RaceState, k: number): RaceState => {
  const byClass = new Map<string | null, RaceState['cars']>();
  for (const car of frame.cars) {
    const list = byClass.get(car.className) ?? [];
    list.push(car);
    byClass.set(car.className, list);
  }
  // Nearest by absolute along-track gap; a null gap (unknown) sorts last.
  const dist = (c: RaceState['cars'][number]): number =>
    c.gapToPlayerM === null ? Infinity : Math.abs(c.gapToPlayerM);
  const kept = [...byClass.values()].flatMap((list) =>
    [...list]
      .sort((a, b) => dist(a) - dist(b))
      .slice(0, k + 1) // +1 so the player's own row (gap 0) never crowds out a real rival
      .concat(list.filter((c) => c.isPlayer)),
  );
  // De-dupe (the player may appear via both the nearest-slice and the isPlayer concat) by id.
  const seen = new Set<number>();
  const cars = kept.filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)));
  return { ...frame, cars };
};

const main = (): void => {
  const [inPath, outPath, ...rest] = process.argv.slice(2);
  if (!inPath || !outPath) {
    console.error(
      'Usage: pnpm tsx tools/trim-fixture.ts <in.jsonl> <out.jsonl> [--stride N] [--from F] [--to T] [--cars-per-class K]',
    );
    process.exitCode = 1;
    return;
  }
  const opts = parseOpts(rest);
  const all = parseReplay(readFileSync(inPath, 'utf8'));

  const out: RaceState[] = [];
  for (let i = opts.from; i < Math.min(all.length, opts.to); i += opts.stride) {
    const frame = all[i];
    if (!frame) continue;
    const named = scrubPlayerName(frame); // redact the human player's name before anything else
    const pruned = opts.carsPerClass === null ? named : pruneCars(named, opts.carsPerClass);
    RaceStateSchema.parse(pruned); // never write a frame that won't replay back
    out.push(pruned);
  }

  writeFileSync(outPath, out.map((f) => JSON.stringify(f)).join('\n') + '\n');
  const laps = new Set(out.map((f) => f.player.lapsCompleted));
  console.log(
    `# wrote ${out.length} frames (from ${all.length}) -> ${outPath}\n` +
      `#   lapsCompleted span: ${Math.min(...laps)}..${Math.max(...laps)} (${laps.size} distinct)`,
  );
};

main();
