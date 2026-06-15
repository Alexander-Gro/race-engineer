import type { EngineerBridge } from '@race-engineer/engineer-core';
import { buildOverlayModel, type OverlayModel } from '../src/overlay-model';

/**
 * In-race overlay renderer (build-plan T6.4, docs/09 §Overlay). A tiny, peripheral HUD that subscribes
 * to the **same read-only snapshot stream** as the main window (via the shared preload `EngineerBridge`)
 * and paints the minimal {@link OverlayModel}. The window itself (transparent, always-on-top,
 * click-through, default off) is created by `electron/main.ts`. Read-only/advisory — it only displays
 * snapshots; there is no path to the game. Built with `textContent`/elements (never `innerHTML`).
 */
declare global {
  interface Window {
    engineer: EngineerBridge;
  }
}

const text = (id: string, value: string, severity?: OverlayModel['fuelLaps']['severity']): void => {
  const node = document.getElementById(id);
  if (!node) return;
  node.textContent = value;
  if (severity) node.className = node.className.replace(/\bsev-\w+\b/, '') + ` sev-${severity}`;
};

const render = (m: OverlayModel): void => {
  text('fuel', m.fuelLaps.value, m.fuelLaps.severity);
  text('pos', m.position);
  text('ahead', m.ahead ? m.ahead.text : '—', m.ahead?.severity);
  text('behind', m.behind ? m.behind.text : '—', m.behind?.severity);
  text('last', m.lastLap.value, m.lastLap.severity);
  text('flagpit', `${m.flag.value} · ${m.nextPit.value}`);

  const warn = document.getElementById('warn');
  if (warn) warn.hidden = !m.fasterClassApproaching;

  const alert = document.getElementById('alert');
  if (alert) {
    if (m.alert) {
      alert.hidden = false;
      alert.textContent = m.alert.label;
      alert.className = `alert sev-${m.alert.severity}`;
    } else {
      alert.hidden = true;
    }
  }
};

window.engineer.onSnapshot((snapshot) => render(buildOverlayModel(snapshot)));
