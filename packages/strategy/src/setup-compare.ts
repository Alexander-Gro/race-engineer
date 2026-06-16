import type { BalanceTendency, HandlingDiagnosis } from './handling';

/**
 * Before/after setup comparison (build-plan T9.5, docs/08 §3). After the driver applies a setup
 * change in the garage (advised by T9.4), this answers the question that closes the loop: **did it
 * work?** It compares the handling diagnosis from before the change to one from after (a few laps on
 * the new setup) and reports whether the balance moved toward neutral, stayed, or worsened.
 *
 * The *what changed* half is the read-only `.svm` setup read (T1.4 `parseSvm`/`extractSetupBaseline`);
 * this is the *did-it-help* half, judged from the front-vs-rear tyre-temp gap (smaller = closer to
 * balanced). Pure/
 * deterministic over two diagnoses; reads the numbers the diagnosis already computed (CLAUDE.md rule 1)
 * and is read-only/advisory — it evaluates the driver's own change, it never makes one (rule 5).
 */

export type BalanceShift = 'improved' | 'unchanged' | 'worsened' | 'unknown';

export interface HandlingComparison {
  before: BalanceTendency;
  after: BalanceTendency;
  shift: BalanceShift;
  /** Front−rear average-temp gap (°C) before/after; |gap| shrinking = nearer balanced. */
  beforeDeltaC: number | null;
  afterDeltaC: number | null;
  /** A short, driver-facing read-out. */
  summary: string;
}

export interface CompareOptions {
  /** °C change in |front−rear gap| below which the balance is treated as unchanged. Default 1.5. */
  deadbandC?: number;
}

const abs = (v: number): number => Math.abs(v);
const round = (v: number): string => String(Math.round(abs(v)));

/**
 * Compare two handling diagnoses (before vs after a setup change). `shift` is judged from the change
 * in the |front−rear| temp gap — a tendency flip (understeer↔oversteer) falls out of the magnitude
 * naturally (a smaller gap is still an improvement; an overcorrection to a bigger gap is worse).
 */
export const compareHandling = (
  before: HandlingDiagnosis,
  after: HandlingDiagnosis,
  opts: CompareOptions = {},
): HandlingComparison => {
  const deadband = opts.deadbandC ?? 1.5;
  const b = before.balance;
  const a = after.balance;
  const result = (shift: BalanceShift, summary: string): HandlingComparison => ({
    before: b.tendency,
    after: a.tendency,
    shift,
    beforeDeltaC: b.deltaC,
    afterDeltaC: a.deltaC,
    summary,
  });

  if (
    b.tendency === 'unknown' ||
    a.tendency === 'unknown' ||
    b.deltaC === null ||
    a.deltaC === null
  ) {
    return result('unknown', "Can't compare — not enough tyre-temp data before and after.");
  }

  const change = abs(a.deltaC) - abs(b.deltaC); // negative = gap shrank = nearer balanced
  if (change < -deadband) {
    const flipped = b.tendency !== a.tendency && a.tendency !== 'neutral';
    return result(
      'improved',
      `Better — balance moved toward neutral (front-rear gap ${round(b.deltaC)}° → ${round(a.deltaC)}°)${
        flipped ? `, now a touch of ${a.tendency}` : ''
      }.`,
    );
  }
  if (change > deadband) {
    const flipped = b.tendency !== a.tendency && a.tendency !== 'neutral';
    return result(
      'worsened',
      flipped
        ? `Worse — overcorrected into ${a.tendency} (gap ${round(b.deltaC)}° → ${round(a.deltaC)}°).`
        : `Worse — balance moved further off (gap ${round(b.deltaC)}° → ${round(a.deltaC)}°).`,
    );
  }
  return result('unchanged', `No real change in the balance (gap ~${round(a.deltaC)}°).`);
};
