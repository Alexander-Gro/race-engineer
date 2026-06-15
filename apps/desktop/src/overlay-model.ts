import type { EngineerSnapshot } from '@race-engineer/engineer-core';
import {
  buildDashboardModel,
  type AlertReading,
  type Reading,
  type RivalReading,
} from './dashboard/model';

/**
 * In-race overlay view-model (build-plan T6.4, docs/09 §Overlay). The overlay is a tiny, peripheral,
 * always-on-top HUD over the (borderless) game — so it carries only the handful of readings worth a
 * 0.5 s glance mid-corner: **fuel laps remaining** (the hero number), the nearest car ahead/behind with
 * gap + class, the flag, the next pit window, last lap, and the most-recent engineer call-out.
 *
 * Pure and **reuses {@link buildDashboardModel}** — every value is already formatted, severity-classified
 * and state-honest there (null ⇒ `—`, never a fabricated 0), so the overlay never re-derives a number
 * (no duplicate formatting, no drift). Read-only/advisory: it only projects the snapshot the Core pushed;
 * there is no path to the game (CLAUDE.md rule 5).
 */

/** A compact, glanceable rival line for the overlay: "Verstappen (Hyper) +1.2s". */
export interface OverlayRival {
  text: string;
  /** The gap's severity (so a closing same-class car can be coloured). */
  severity: Reading['severity'];
}

export interface OverlayModel {
  /** Laps of fuel left — the overlay's hero number. */
  fuelLaps: Reading;
  /** Next pit window (lap range), `none`, or `—` while unknown. */
  nextPit: Reading;
  lastLap: Reading;
  flag: Reading;
  /** Overall + class position, pre-formatted by the dashboard model. */
  position: string;
  ahead: OverlayRival | null;
  behind: OverlayRival | null;
  /** A different-class car closing from behind within the horizon (the docs/09 warning strip). */
  fasterClassApproaching: boolean;
  /** The single most-recent engineer call-out this snapshot, or null. */
  alert: AlertReading | null;
}

const compactRival = (rival: RivalReading | null): OverlayRival | null => {
  if (rival === null) return null;
  const cls = rival.className ? ` (${rival.className})` : '';
  return { text: `${rival.name}${cls} ${rival.gap.value}`.trim(), severity: rival.gap.severity };
};

/** Project a snapshot to the minimal overlay model, reusing the dashboard model's tested formatting. */
export const buildOverlayModel = (snapshot: EngineerSnapshot): OverlayModel => {
  const d = buildDashboardModel(snapshot);
  return {
    fuelLaps: d.fuel.lapsRemaining,
    nextPit: d.fuel.nextPit,
    lastLap: d.timing.lastLap,
    flag: d.session.flag,
    position: d.standings.position,
    ahead: compactRival(d.standings.ahead),
    behind: compactRival(d.standings.behind),
    fasterClassApproaching: d.standings.fasterClassApproaching,
    alert: d.alerts[0] ?? null,
  };
};
