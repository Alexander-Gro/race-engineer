import { basename } from 'node:path';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { LmuRestClient, buildCaptureReport } from '@race-engineer/adapter-lmu';

/**
 * `pnpm capture [--svm <path>] [--out <file>]` — one-shot rig capture of LMU's read-only REST payloads
 * (+ an optional `.svm` setup file) into a single JSON report. Run it on the Windows rig with LMU in a
 * session; paste the report back so the tolerant REST/setup mappers (Virtual Energy, aids, `.svm`) can
 * have their LIVE-VERIFY field names confirmed and narrowed in one pass (docs/03 §S2–S4).
 *
 * **Windows-only + read-only:** it issues only GET requests (the `LmuRestClient` is GET-only) and opens
 * the `.svm` read-only — no write path. Off the rig (no LMU/REST), it writes a report showing every
 * endpoint as not-responded, which is harmless.
 */

interface Flags {
  svm: string | null;
  out: string;
}

const parseFlags = (args: string[]): Flags => {
  const flags: Flags = { svm: null, out: 'lmu-capture.json' };
  for (let i = 0; i < args.length; i += 1) {
    const next = args[i + 1] ?? '';
    if (args[i] === '--svm' && next) {
      flags.svm = next;
      i += 1;
    } else if (args[i] === '--out' && next) {
      flags.out = next;
      i += 1;
    }
  }
  return flags;
};

const main = async (): Promise<void> => {
  const flags = parseFlags(process.argv.slice(2));
  const client = new LmuRestClient();
  const rest = await client.snapshot();

  let svm: { name: string; text: string } | null = null;
  if (flags.svm) {
    if (existsSync(flags.svm)) {
      svm = { name: basename(flags.svm), text: readFileSync(flags.svm, 'utf8') };
    } else {
      console.warn(`capture: --svm path not found, skipping: ${flags.svm}`);
    }
  }

  const report = buildCaptureReport({ rest, svm, capturedAtMs: Date.now() });
  writeFileSync(flags.out, JSON.stringify(report, null, 2));

  const responded = Object.entries(report.endpoints)
    .filter(([, e]) => e.responded)
    .map(([name]) => name);
  console.log(`capture: REST base ${report.restBase ?? '(none — is LMU running?)'}`);
  console.log(`capture: endpoints responded: ${responded.length ? responded.join(', ') : 'none'}`);
  for (const [name, e] of Object.entries(report.endpoints)) {
    if (e.responded)
      console.log(`  ${name}: ${e.keys.slice(0, 12).join(', ')}${e.keys.length > 12 ? ' …' : ''}`);
  }
  if (report.svm) {
    console.log(
      `capture: .svm ${report.svm.name} — sections: ${Object.keys(report.svm.sections).join(', ')}`,
    );
  }
  console.log(`capture: wrote ${flags.out} — paste it back to confirm the field names.`);
};

main().catch((err: unknown) => {
  console.error('capture failed:', err);
  process.exitCode = 1;
});
