import {
  diagnoseHandling,
  type BalanceTendency,
  type CamberHint,
  type PressureHint,
} from '@race-engineer/strategy';
import type { EngineerSnapshot } from '@race-engineer/engineer-core';
import type { Reading, Severity } from './model';

/**
 * Handling-card view-model (build-plan T9.2 follow-up, docs/08 §3 / docs/09). A **pure** function from
 * a snapshot to a display-ready handling read: axle balance (understeer/oversteer), front/rear tyre
 * temps, and per-corner camber + pressure hints — all from the deterministic `diagnoseHandling`
 * (the LLM/strategy math produced these; this only presents). State-honest: single-value temps ⇒
 * `unknown`/`—`, and a `confidence` that reflects how much 3-zone data backed the read. No DOM, so the
 * what-to-show + how-to-classify logic is unit-tested offline and the renderer stays a thin painter.
 */

const UNKNOWN: Reading = { value: '—', severity: 'unknown' };

const tempReading = (c: number | null): Reading =>
  c === null || !Number.isFinite(c) ? UNKNOWN : { value: `${Math.round(c)}°`, severity: 'neutral' };

const signedDelta = (c: number | null): Reading => {
  if (c === null || !Number.isFinite(c)) return UNKNOWN;
  const rounded = Number.parseFloat(c.toFixed(1));
  const sign = rounded > 0 ? '+' : rounded < 0 ? '-' : '';
  return { value: `${sign}${Math.abs(rounded).toFixed(1)}°`, severity: 'neutral' };
};

const BALANCE_TEXT: Record<BalanceTendency, string> = {
  understeer: 'Understeer',
  oversteer: 'Oversteer',
  neutral: 'Neutral',
  unknown: '—',
};

/** Neutral balance is good; a lean to under/oversteer is a caution; no data is unknown. */
const balanceReading = (tendency: BalanceTendency): Reading => {
  const severity: Severity =
    tendency === 'neutral' ? 'good' : tendency === 'unknown' ? 'unknown' : 'caution';
  return { value: BALANCE_TEXT[tendency], severity };
};

const CAMBER_TEXT: Record<CamberHint, string> = {
  balanced: 'Balanced',
  'inner-hot': 'Inner hot',
  'outer-hot': 'Outer hot',
  unknown: '—',
};

const PRESSURE_TEXT: Record<PressureHint, string> = {
  balanced: 'Balanced',
  over: 'Over-inflated',
  under: 'Under-inflated',
  unknown: '—',
};

/** Balanced reads are good; a directional signal is a caution; no zone data is unknown. */
const hintReading = (text: string, hint: string): Reading => {
  const severity: Severity =
    hint === 'balanced' ? 'good' : hint === 'unknown' ? 'unknown' : 'caution';
  return { value: text, severity };
};

const confidenceReading = (confidence01: number): Reading =>
  confidence01 <= 0
    ? UNKNOWN
    : {
        value: `${Math.round(confidence01 * 100)}%`,
        severity: confidence01 >= 0.75 ? 'good' : 'caution',
      };

export type CornerLabel = 'FL' | 'FR' | 'RL' | 'RR';
const CORNERS: readonly CornerLabel[] = ['FL', 'FR', 'RL', 'RR'];

export interface HandlingCornerRow {
  corner: CornerLabel;
  camber: Reading;
  pressure: Reading;
}

export interface HandlingModel {
  /** A usable read exists (at least an axle-balance read from the tyre temps). */
  available: boolean;
  balance: Reading;
  frontTemp: Reading;
  rearTemp: Reading;
  /** front-avg − rear-avg (°C), signed; positive = fronts hotter. */
  frontRearDelta: Reading;
  corners: [HandlingCornerRow, HandlingCornerRow, HandlingCornerRow, HandlingCornerRow];
  /** Fraction of corners with 3-zone temps, as a %; `—` when none (balance-only read). */
  confidence: Reading;
  seq: number;
}

/** Build the handling-card view-model for one snapshot. Pure, deterministic. */
export const buildHandlingModel = (snapshot: EngineerSnapshot): HandlingModel => {
  const d = diagnoseHandling(snapshot.raceState.player.tires);
  const corners = CORNERS.map((corner, i): HandlingCornerRow => {
    const cam = d.camber[i];
    const pre = d.pressure[i];
    return {
      corner,
      camber: hintReading(CAMBER_TEXT[cam?.hint ?? 'unknown'], cam?.hint ?? 'unknown'),
      pressure: hintReading(PRESSURE_TEXT[pre?.hint ?? 'unknown'], pre?.hint ?? 'unknown'),
    };
  }) as [HandlingCornerRow, HandlingCornerRow, HandlingCornerRow, HandlingCornerRow];

  return {
    available: d.balance.frontAvgC !== null || d.balance.rearAvgC !== null,
    balance: balanceReading(d.balance.tendency),
    frontTemp: tempReading(d.balance.frontAvgC),
    rearTemp: tempReading(d.balance.rearAvgC),
    frontRearDelta: signedDelta(d.balance.deltaC),
    corners,
    confidence: confidenceReading(d.confidence01),
    seq: snapshot.seq,
  };
};
