import type { EngineerBridge } from '@race-engineer/engineer-core';
import {
  buildDashboardModel,
  type AlertReading,
  type DashboardModel,
  type Reading,
  type RivalReading,
} from '../src/dashboard/model';

/**
 * Renderer (build-plan T6.2). Subscribes to throttled snapshots via the preload-exposed read-only
 * {@link EngineerBridge}, builds the pure {@link DashboardModel} (docs/09 §A), and paints a
 * glanceable, colour-coded dashboard. Redraws are bounded by the Core's upstream ~12 Hz snapshot
 * throttle (docs/09 §performance — the renderer is a dumb consumer). Everything is built with
 * `textContent`/elements (never `innerHTML`) so telemetry-derived strings can't inject markup.
 *
 * The classification/formatting lives in `../src/dashboard/model` (unit-tested); the styling layer
 * (Tailwind/shadcn) is a follow-up reskin of this same model.
 */
declare global {
  interface Window {
    engineer: EngineerBridge;
  }
}

const el = (tag: string, className?: string, text?: string): HTMLElement => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

/** A label + value pair; the value carries the severity colour + a non-colour `data-severity`. */
const metric = (label: string, reading: Reading): HTMLElement => {
  const wrap = el('div', 'metric');
  wrap.append(el('div', 'metric-label', label));
  const value = el('div', `metric-value sev-${reading.severity}`, reading.value);
  value.dataset['severity'] = reading.severity; // CSS adds a glyph for caution/critical (a11y)
  wrap.append(value);
  return wrap;
};

const card = (title: string, ...body: HTMLElement[]): HTMLElement => {
  const c = el('section', 'card');
  c.append(el('h2', 'card-title', title));
  c.append(...body);
  return c;
};

const CORNER_LABELS = ['FL', 'FR', 'RL', 'RR'] as const;

const fuelCard = (m: DashboardModel['fuel']): HTMLElement => {
  const big = el('div', 'fuel-big');
  const laps = el('div', `fuel-laps sev-${m.lapsRemaining.severity}`, m.lapsRemaining.value);
  laps.dataset['severity'] = m.lapsRemaining.severity;
  big.append(laps, el('div', 'fuel-laps-label', 'laps left'));
  const grid = el('div', 'grid-2');
  grid.append(
    metric('In tank', m.liters),
    metric('Per lap', m.perLap),
    metric('Add at stop', m.addAtStop),
  );
  return card('Fuel', big, grid);
};

const cornerGrid = (
  readings: readonly Reading[],
  pick: (r: Reading, i: number) => HTMLElement,
): HTMLElement => {
  const grid = el('div', 'grid-2');
  readings.forEach((r, i) => grid.append(pick(r, i)));
  return grid;
};

const tyresCard = (m: DashboardModel['tyres']): HTMLElement => {
  const grid = el('div', 'grid-2');
  m.corners.forEach((corner, i) => {
    const cell = el('div', 'corner');
    cell.append(el('div', 'corner-pos', CORNER_LABELS[i]));
    const temp = el('div', `corner-main sev-${corner.temp.severity}`, corner.temp.value);
    temp.dataset['severity'] = corner.temp.severity;
    cell.append(temp);
    const wear = el('div', `corner-sub sev-${corner.wear.severity}`, `wear ${corner.wear.value}`);
    wear.dataset['severity'] = corner.wear.severity;
    cell.append(wear, el('div', 'corner-sub', corner.pressure.value));
    grid.append(cell);
  });
  return card(`Tyres${m.compound ? ` · ${m.compound}` : ''}`, grid);
};

const brakesCard = (m: DashboardModel['brakes']): HTMLElement =>
  card(
    'Brakes',
    cornerGrid(m.corners, (r, i) => {
      const cell = el('div', 'corner');
      cell.append(el('div', 'corner-pos', CORNER_LABELS[i]));
      const v = el('div', `corner-main sev-${r.severity}`, r.value);
      v.dataset['severity'] = r.severity;
      cell.append(v);
      return cell;
    }),
  );

const aidsCard = (m: DashboardModel['aids']): HTMLElement => {
  const grid = el('div', 'grid-2');
  grid.append(
    metric('TC', m.tc),
    metric('ABS', m.abs),
    metric('Brake bias', m.brakeBias),
    metric('Engine map', m.engineMap),
  );
  return card('Aids', grid);
};

const CLOSING_GLYPH: Record<RivalReading['closing'], string> = {
  approaching: '▲ closing',
  leaving: '▼ dropping',
  steady: '— steady',
  unknown: '',
};

const rivalRow = (label: string, rival: RivalReading | null): HTMLElement => {
  const row = el('div', 'rival');
  row.append(el('div', 'rival-label', label));
  if (rival === null) {
    row.append(el('div', 'rival-empty', '—'));
    return row;
  }
  const name = `${rival.name}${rival.className ? ` (${rival.className})` : ''}`;
  row.append(el('div', 'rival-name', name));
  row.append(el('div', 'rival-gap', rival.gap.value));
  if (CLOSING_GLYPH[rival.closing])
    row.append(el('div', 'rival-closing', CLOSING_GLYPH[rival.closing]));
  return row;
};

const standingsCard = (m: DashboardModel['standings']): HTMLElement => {
  const body: HTMLElement[] = [el('div', 'position', m.position)];
  if (m.fasterClassApproaching) body.push(el('div', 'warn-strip', '⚠ Faster class approaching'));
  body.push(rivalRow('Ahead', m.ahead), rivalRow('Behind', m.behind));
  return card('Position', ...body);
};

const timingCard = (m: DashboardModel['timing']): HTMLElement => {
  const grid = el('div', 'grid-2');
  grid.append(
    metric('Last lap', m.lastLap),
    metric('Best lap', m.bestLap),
    metric('Δ to best', m.deltaToBest),
  );
  return card('Timing', grid);
};

const sessionCard = (m: DashboardModel['session']): HTMLElement => {
  const grid = el('div', 'grid-2');
  grid.append(
    metric('Phase', { value: m.phase, severity: 'neutral' }),
    metric('Flag', m.flag),
    metric('Remaining', m.remaining),
    metric('Field', { value: m.multiClass ? 'multi-class' : 'single', severity: 'neutral' }),
  );
  return card('Session', grid);
};

// A short rolling feed of the engineer's most recent call-outs (events are transient per snapshot).
const MAX_ALERTS = 6;
let recentAlerts: AlertReading[] = [];

const alertsStrip = (alerts: readonly AlertReading[]): HTMLElement => {
  const strip = el('div', 'alerts');
  for (const a of alerts) {
    const chip = el('div', `alert-chip sev-${a.severity}`, a.label);
    chip.dataset['severity'] = a.severity;
    strip.append(chip);
  }
  return strip;
};

const render = (model: DashboardModel): void => {
  const app = document.getElementById('app');
  if (!app) return;
  if (model.alerts.length > 0)
    recentAlerts = [...model.alerts, ...recentAlerts].slice(0, MAX_ALERTS);

  const root = el('div');
  if (recentAlerts.length > 0) root.append(alertsStrip(recentAlerts));
  const cards = el('div', 'cards');
  cards.append(
    fuelCard(model.fuel),
    standingsCard(model.standings),
    tyresCard(model.tyres),
    brakesCard(model.brakes),
    aidsCard(model.aids),
    timingCard(model.timing),
    sessionCard(model.session),
  );
  root.append(cards);
  app.replaceChildren(root);
  const meta = document.getElementById('meta');
  if (meta) meta.textContent = `snapshot #${model.seq} · t=${model.elapsedS.toFixed(0)} s`;
};

window.engineer.onSnapshot((snapshot) => render(buildDashboardModel(snapshot)));
