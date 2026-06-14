import type { EngineerBridge, EngineerSnapshot } from '@race-engineer/engineer-core';

/**
 * Renderer (build-plan T6.1, minimal). Subscribes to throttled snapshots via the preload-exposed
 * read-only {@link EngineerBridge} and paints the live values — the T6.1 verify ("renderer shows
 * live values from a synthetic source"). The styled dashboard (Tailwind + shadcn, 4-corner tires,
 * widgets) is T6.2; this proves the pipe end to end.
 */
declare global {
  interface Window {
    engineer: EngineerBridge;
  }
}

const fmt = (n: number | null, digits = 1): string => (n === null ? '—' : n.toFixed(digits));

const render = (snapshot: EngineerSnapshot): void => {
  const s = snapshot.raceState;
  const p = s.player;
  const rows: Array<[string, string]> = [
    ['Phase', s.session.phase],
    ['Position', `P${p.position} (class P${p.classPosition} ${p.className})`],
    ['Lap', String(p.lapsCompleted)],
    ['Last lap', `${fmt(p.lastLapS)} s`],
    ['Fuel', `${fmt(p.fuel.liters)} L`],
    ['Fuel / lap', `${fmt(p.fuel.perLapAvgLiters, 2)} L`],
    ['Laps left (fuel)', fmt(p.fuel.lapsRemainingEst)],
    ['Flag', s.flags.global],
  ];

  const dash = document.getElementById('dash');
  if (dash) {
    // Build with textContent (never innerHTML) so telemetry-derived strings — class names,
    // and driver names/transcript once the dashboard grows in T6.2 — can never inject markup.
    dash.replaceChildren(
      ...rows.flatMap(([k, v]) => {
        const label = document.createElement('div');
        label.className = 'label';
        label.textContent = k;
        const value = document.createElement('div');
        value.className = 'value';
        value.textContent = v;
        return [label, value];
      }),
    );
  }
  const meta = document.getElementById('meta');
  if (meta)
    meta.textContent = `snapshot #${snapshot.seq} · t=${(snapshot.monotonicMs / 1000).toFixed(1)} s`;
};

window.engineer.onSnapshot(render);
