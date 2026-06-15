import type { EngineerBridge } from '@race-engineer/engineer-core';
import {
  applyOutputDevice,
  listOutputDevices,
  releaseStream,
  requestMicAccess,
  watchDeviceChanges,
} from '../src/audio-io';
import {
  buildDashboardModel,
  type AlertReading,
  type DashboardModel,
  type Reading,
  type RivalReading,
} from '../src/dashboard/model';
import {
  LLM_PROVIDER_IDS,
  PROACTIVITY_LEVELS,
  PROFILES,
  SECRET_SLOTS,
  type AppSettings,
} from '../src/settings';
import type { SettingsApi } from '../src/settings-bridge';

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
    settings: SettingsApi;
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
    metric('Next pit (lap)', m.nextPit),
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

/**
 * The free/no-key "ask the engineer" bar (Track A). Wired once — it lives outside `#app`, so the
 * snapshot redraw never clears the typed question or the answer. The question goes Core-side over the
 * read-only `ask` bridge (template mode answers it from the latest snapshot); we just show the reply.
 */
const wireAskBar = (): void => {
  const form = document.getElementById('ask-form') as HTMLFormElement | null;
  const input = document.getElementById('ask-input') as HTMLInputElement | null;
  const answer = document.getElementById('ask-answer');
  if (!form || !input || !answer) return;
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const question = input.value.trim();
    if (!question) return;
    answer.textContent = '…';
    void window.engineer
      .ask(question)
      .then((reply) => {
        answer.textContent = reply;
      })
      .catch(() => {
        answer.textContent = "Sorry — I couldn't answer that just now.";
      });
  });
};
wireAskBar();

/**
 * The voice-I/O affordances (T4.5 / docs/16 §1): a mic check that surfaces clear guidance (and an
 * "open settings" deep-link) when capture is denied — never a crash — and an output-device picker
 * that routes the engineer voice to a chosen device. Mic capture is read-only and gated; the text
 * box above is the always-available no-mic fallback.
 */
const wireVoiceBar = (): void => {
  const testBtn = document.getElementById('mic-test') as HTMLButtonElement | null;
  const status = document.getElementById('mic-status');
  const settingsBtn = document.getElementById('mic-settings') as HTMLButtonElement | null;
  const select = document.getElementById('output-device') as HTMLSelectElement | null;
  const audio = document.getElementById('engineer-audio') as HTMLAudioElement | null;
  if (!testBtn || !status || !settingsBtn || !select || !audio) return;

  const setStatus = (text: string, cls: '' | 'ok' | 'bad'): void => {
    status.textContent = text;
    status.className = `voice-status${cls ? ` ${cls}` : ''}`;
  };

  testBtn.addEventListener('click', () => {
    setStatus('Checking…', '');
    settingsBtn.hidden = true;
    void requestMicAccess(navigator.mediaDevices).then((access) => {
      if (access.ok) {
        releaseStream(access.stream); // PTT gates real capture; release the probe immediately
        setStatus('Mic OK', 'ok');
      } else {
        setStatus(access.message, 'bad');
        settingsBtn.hidden = !access.canOpenSettings;
      }
    });
  });

  settingsBtn.addEventListener('click', () => void window.engineer.openMicSettings());

  const refreshOutputs = (): void => {
    void listOutputDevices(navigator.mediaDevices).then((devices) => {
      const chosen = select.value;
      select.replaceChildren(
        ...devices.map((d) => {
          const opt = document.createElement('option');
          opt.value = d.deviceId;
          opt.textContent = d.label;
          return opt;
        }),
      );
      if (devices.some((d) => d.deviceId === chosen)) select.value = chosen;
    });
  };

  select.addEventListener('change', () => {
    if (!select.value) return; // ignore the placeholder before the real device list loads
    void applyOutputDevice(audio, select.value).then((r) => {
      if (!r.ok) setStatus(r.message, 'bad');
    });
  });

  watchDeviceChanges(navigator.mediaDevices, refreshOutputs);
  refreshOutputs();
};
wireVoiceBar();

/**
 * The settings panel (T6.3): profile / engineer (LLM) / proactivity persist via `window.settings`,
 * and cloud API keys are stored in OS secure storage — the renderer only ever sends a key (once) and
 * learns *which* slots are set, never a value (docs/15, rule 6). The free/template default needs no
 * key; this is opt-in BYO-key.
 */
const wireSettingsPanel = (): void => {
  const profile = document.getElementById('set-profile') as HTMLSelectElement | null;
  const llm = document.getElementById('set-llm') as HTMLSelectElement | null;
  const proactivity = document.getElementById('set-proactivity') as HTMLSelectElement | null;
  const slot = document.getElementById('set-slot') as HTMLSelectElement | null;
  const keyInput = document.getElementById('set-key') as HTMLInputElement | null;
  const save = document.getElementById('set-key-save') as HTMLButtonElement | null;
  const clear = document.getElementById('set-key-clear') as HTMLButtonElement | null;
  const keysLabel = document.getElementById('set-keys');
  if (!profile || !llm || !proactivity || !slot || !keyInput || !save || !clear || !keysLabel)
    return;

  const fill = (select: HTMLSelectElement, options: readonly string[]): void =>
    select.replaceChildren(
      ...options.map((value) => {
        const opt = document.createElement('option');
        opt.value = value;
        opt.textContent = value;
        return opt;
      }),
    );
  fill(profile, PROFILES);
  fill(llm, LLM_PROVIDER_IDS);
  fill(proactivity, PROACTIVITY_LEVELS);
  fill(slot, SECRET_SLOTS);

  let current: AppSettings | null = null;

  const persist = (): void => {
    if (!current) return;
    const next: AppSettings = {
      ...current,
      profile: profile.value as AppSettings['profile'],
      llm: { ...current.llm, provider: llm.value as AppSettings['llm']['provider'] },
      proactivity: proactivity.value as AppSettings['proactivity'],
    };
    void window.settings.save(next).then((saved) => {
      current = saved;
    });
  };

  const showKeys = (slots: readonly string[]): void => {
    keysLabel.textContent = slots.length > 0 ? `keys set: ${slots.join(', ')}` : 'no keys set';
  };

  for (const control of [profile, llm, proactivity]) control.addEventListener('change', persist);

  save.addEventListener('click', () => {
    const value = keyInput.value.trim();
    if (!value) return;
    void window.settings
      .setApiKey(slot.value as (typeof SECRET_SLOTS)[number], value)
      .then((slots) => {
        keyInput.value = ''; // never keep the plaintext key in the DOM after it's stored
        showKeys(slots);
      });
  });

  clear.addEventListener('click', () => {
    void window.settings
      .deleteApiKey(slot.value as (typeof SECRET_SLOTS)[number])
      .then((slots) => showKeys(slots));
  });

  void window.settings.load().then((loaded) => {
    current = loaded;
    profile.value = loaded.profile;
    llm.value = loaded.llm.provider;
    proactivity.value = loaded.proactivity;
  });
  void window.settings.listApiKeys().then(showKeys);
};
wireSettingsPanel();
