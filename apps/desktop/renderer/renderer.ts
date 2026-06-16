import type { EngineerBridge } from '@race-engineer/engineer-core';
import type { AudioClip, AudioSink, PlaybackHandle } from '@race-engineer/voice';
import { createAudioReceiver, type AudioOutApi } from '../src/audio-bridge';
import { createRadioInput, type MicCaptureBackend, type RadioInApi } from '../src/mic-bridge';
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
  buildStrategyModel,
  type StrategyModel,
  type StrategyRivalRow,
} from '../src/dashboard/strategy-model';
import { buildHandlingModel, type HandlingModel } from '../src/dashboard/handling-model';
import { CalloutSpeaker, type CalloutSpeechPort } from '../src/callout';
import { estimateCloudCost } from '../src/cost';
import type { PttApi } from '../src/ptt-mapping';
import {
  LLM_PROVIDER_IDS,
  PROACTIVITY_LEVELS,
  PROFILES,
  SECRET_SLOTS,
  STT_ENGINES,
  TTS_ENGINES,
  type AppSettings,
} from '../src/settings';
import type { SettingsApi } from '../src/settings-bridge';
import { SpeechController, type SpeechPort } from '../src/speech';

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
    ptt: PttApi;
    audioOut: AudioOutApi;
    radioIn: RadioInApi;
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

/** A small "limiting" badge shown on whichever of fuel/VE binds the current stint. */
const bindingBadge = (
  binding: DashboardModel['binding'],
  resource: 'fuel' | 'energy',
): HTMLElement[] =>
  binding === resource
    ? [el('div', 'binding-badge', resource === 'fuel' ? 'Fuel-limited' : 'Energy-limited')]
    : [];

const fuelCard = (m: DashboardModel['fuel'], binding: DashboardModel['binding']): HTMLElement => {
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
  return card('Fuel', big, grid, ...bindingBadge(binding, 'fuel'));
};

/**
 * Virtual Energy card (LMU). Hidden entirely when the source exposes no VE (non-LMU / SHM-only),
 * so a fuel-only stream never shows an empty VE panel. Shows the binding badge when VE limits.
 */
const energyCard = (
  m: DashboardModel['energy'],
  binding: DashboardModel['binding'],
): HTMLElement | null => {
  if (m.level.severity === 'unknown') return null;
  const big = el('div', 'fuel-big');
  const laps = el('div', `fuel-laps sev-${m.lapsRemaining.severity}`, m.lapsRemaining.value);
  laps.dataset['severity'] = m.lapsRemaining.severity;
  big.append(laps, el('div', 'fuel-laps-label', 'laps on VE'));
  const grid = el('div', 'grid-2');
  grid.append(
    metric('VE left', m.level),
    metric('Per lap', m.perLap),
    metric('Add at stop', m.addAtStop),
  );
  return card('Virtual Energy', big, grid, ...bindingBadge(binding, 'energy'));
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

/**
 * Handling card (T9.2): axle balance + front/rear temps + per-corner camber/pressure hints. Hidden
 * when no read is possible (no tyre temps at all); the renderer is a thin painter over the model.
 */
const handlingCard = (m: HandlingModel): HTMLElement | null => {
  if (!m.available) return null;
  const big = el('div', 'fuel-big');
  const balance = el('div', `fuel-laps sev-${m.balance.severity}`, m.balance.value);
  balance.dataset['severity'] = m.balance.severity;
  big.append(balance, el('div', 'fuel-laps-label', 'balance'));
  const grid = el('div', 'grid-2');
  grid.append(
    metric('Front', m.frontTemp),
    metric('Rear', m.rearTemp),
    metric('F−R', m.frontRearDelta),
    metric('Zone data', m.confidence),
  );
  const corners = el('div', 'grid-2');
  m.corners.forEach((c) => {
    const cell = el('div', 'corner');
    cell.append(el('div', 'corner-pos', c.corner));
    const cam = el('div', `corner-sub sev-${c.camber.severity}`, c.camber.value);
    cam.dataset['severity'] = c.camber.severity;
    const pre = el('div', `corner-sub sev-${c.pressure.severity}`, c.pressure.value);
    pre.dataset['severity'] = c.pressure.severity;
    cell.append(cam, pre);
    corners.append(cell);
  });
  return card('Handling', big, grid, corners);
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

// Strategy panel (T7.8): the full stint plan + pit windows the Core computes, beyond the dashboard's
// single "next pit" reading.
const strategyCard = (m: StrategyModel): HTMLElement => {
  const body: HTMLElement[] = [];
  if (!m.hasPlan) {
    body.push(el('div', 'rival-empty', 'Learning your pace — no plan yet.'));
  } else {
    const table = el('div', 'stints');
    for (const s of m.stints) {
      const rowCls = `stint${s.current ? ' stint-current' : ''}`;
      const r = el('div', rowCls);
      r.append(el('div', 'stint-laps', `S${s.index} · L${s.laps}`));
      const fuel = el('div', `stint-fuel sev-${s.fuelAdd.severity}`, `+${s.fuelAdd.value}`);
      const deg = el(
        'div',
        `stint-deg sev-${s.degradation.severity}`,
        `deg ${s.degradation.value}`,
      );
      deg.dataset['severity'] = s.degradation.severity;
      r.append(fuel, deg);
      table.append(r);
    }
    body.push(table);
    const wins = m.pitWindows.map((w) => `${w.laps}`).join(', ');
    body.push(metric('Pit window (lap)', { value: wins || '—', severity: 'neutral' }));
    body.push(metric('Mandatory stops', m.mandatoryStops));
  }
  const grid = el('div', 'grid-2');
  grid.append(metric('To finish', m.lapsToFinish), metric('Save target', m.fuelSaveTarget));
  body.push(grid);
  return card('Strategy', ...body);
};

const RIVAL_REL: Record<StrategyRivalRow['relation'], string> = { ahead: '▲', behind: '▼' };

// Rival tracker (T7.8): nearest cars on track, across classes, with gap + closing.
const rivalsCard = (m: StrategyModel): HTMLElement => {
  const body: HTMLElement[] = [];
  if (m.rivals.length === 0) {
    body.push(el('div', 'rival-empty', 'No cars nearby.'));
  } else {
    for (const r of m.rivals) {
      const row = el('div', `rival${r.sameClass ? ' rival-sameclass' : ''}`);
      row.append(el('div', 'rival-label', `${RIVAL_REL[r.relation]} ${r.position}`));
      const name = `${r.name}${r.className ? ` (${r.className})` : ''}`;
      row.append(el('div', 'rival-name', name));
      row.append(el('div', 'rival-gap', r.gap.value));
      if (CLOSING_GLYPH[r.closing])
        row.append(el('div', 'rival-closing', CLOSING_GLYPH[r.closing]));
      body.push(row);
    }
  }
  return card('Rivals', ...body);
};

const render = (model: DashboardModel, strategy: StrategyModel, handling: HandlingModel): void => {
  const app = document.getElementById('app');
  if (!app) return;
  if (model.alerts.length > 0)
    recentAlerts = [...model.alerts, ...recentAlerts].slice(0, MAX_ALERTS);

  const root = el('div');
  if (recentAlerts.length > 0) root.append(alertsStrip(recentAlerts));
  const cards = el('div', 'cards');
  const energy = energyCard(model.energy, model.binding);
  const handlingEl = handlingCard(handling);
  cards.append(
    fuelCard(model.fuel, model.binding),
    ...(energy ? [energy] : []),
    standingsCard(model.standings),
    strategyCard(strategy),
    rivalsCard(strategy),
    tyresCard(model.tyres),
    ...(handlingEl ? [handlingEl] : []),
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

// The proactive call-out speaker (free Web-Speech path), assigned by wireCallouts() below. The snapshot
// handler voices the same events the dashboard paints as alert chips.
let calloutSpeaker: CalloutSpeaker | null = null;
// True once the worker's real voice (Piper/cloud) is voicing call-outs — then the free Web-Speech
// fallback stays silent so we never double-speak (a robotic echo over the real voice). Set by the
// worker's `voice-active` signal over the audio bridge (wireAudioOut below).
let workerVoicingCallouts = false;

window.engineer.onSnapshot((snapshot) => {
  render(buildDashboardModel(snapshot), buildStrategyModel(snapshot), buildHandlingModel(snapshot));
  if (!workerVoicingCallouts && snapshot.events?.length) calloutSpeaker?.announce(snapshot.events);
});

/**
 * The free/no-key "ask the engineer" bar (Track A). Wired once — it lives outside `#app`, so the
 * snapshot redraw never clears the typed question or the answer. The question goes Core-side over the
 * read-only `ask` bridge (template mode answers it from the latest snapshot); we just show the reply.
 */
const wireAskBar = (): void => {
  const form = document.getElementById('ask-form') as HTMLFormElement | null;
  const input = document.getElementById('ask-input') as HTMLInputElement | null;
  const answer = document.getElementById('ask-answer');
  const speakBtn = document.getElementById('ask-speak') as HTMLButtonElement | null;
  if (!form || !input || !answer) return;

  // Spoken replies via the OS voice (Web Speech API) — free, no key. The engineer reads its answer
  // aloud. Falls back silently to text-only where speech isn't available.
  const port: SpeechPort | null =
    'speechSynthesis' in window
      ? {
          speak: (text) => window.speechSynthesis.speak(new SpeechSynthesisUtterance(text)),
          cancel: () => window.speechSynthesis.cancel(),
        }
      : null;
  const speech = new SpeechController(port);

  if (speakBtn) {
    const paintToggle = (): void => {
      speakBtn.textContent = speech.enabled ? '🔊 Voice on' : '🔇 Muted';
      speakBtn.setAttribute('aria-pressed', String(speech.enabled));
    };
    if (!speech.available) speakBtn.hidden = true;
    else paintToggle();
    speakBtn.addEventListener('click', () => {
      speech.setEnabled(!speech.enabled);
      paintToggle();
    });
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const question = input.value.trim();
    if (!question) return;
    speech.stop(); // don't talk over the previous answer while fetching the next
    calloutSpeaker?.stop(); // a question takes the floor from a proactive call-out
    answer.textContent = '…';
    void window.engineer
      .ask(question)
      .then((reply) => {
        answer.textContent = reply;
        speech.say(reply); // read the answer aloud (no-op when muted/unavailable)
      })
      .catch(() => {
        answer.textContent = "Sorry — I couldn't answer that just now.";
      });
  });
};
wireAskBar();

/**
 * Proactive call-outs spoken aloud (T10.1, free/no-key). The engineer voices the Tier ≥ 1 events the
 * dashboard shows as alert chips — "box this lap", "fuel running low" — via the OS voice (Web Speech).
 * (Tier-0 reflex spotter calls are excluded here — they stay on the pre-rendered `VoicePlayer` path,
 * docs/01/07.) The pure {@link CalloutSpeaker} (priority preemption, mute) is fed `snapshot.events` in
 * the subscription above; here we give it a `speechSynthesis` port and a mute toggle. Output-only.
 */
const wireCallouts = (): void => {
  const toggle = document.getElementById('callout-toggle') as HTMLButtonElement | null;
  const port: CalloutSpeechPort | null =
    'speechSynthesis' in window
      ? {
          speak: (text, onDone) => {
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.onend = () => onDone();
            utterance.onerror = () => onDone(); // always release the speaker, even on a synth error
            window.speechSynthesis.speak(utterance);
          },
          cancel: () => window.speechSynthesis.cancel(),
        }
      : null;
  const speaker = new CalloutSpeaker(port);
  calloutSpeaker = speaker; // wired into the snapshot handler above

  if (!toggle) return;
  const paintToggle = (): void => {
    toggle.textContent = speaker.enabled ? '📢 Call-outs on' : '🔕 Call-outs off';
    toggle.setAttribute('aria-pressed', String(speaker.enabled));
  };
  if (!speaker.available) toggle.hidden = true;
  else paintToggle();
  toggle.addEventListener('click', () => {
    speaker.setEnabled(!speaker.enabled);
    paintToggle();
  });
};
wireCallouts();

/**
 * The in-race overlay toggle (T6.4, docs/09 §Overlay). Shows/hides a small always-on-top, transparent,
 * click-through HUD over the (borderless) game — off by default. Main owns the overlay window; this
 * button just flips its visibility and reflects the returned state. View-only — no game path.
 */
const wireOverlayToggle = (): void => {
  const button = document.getElementById('overlay-toggle') as HTMLButtonElement | null;
  if (!button) return;
  button.addEventListener('click', () => {
    void window.engineer.toggleOverlay().then((visible) => {
      button.textContent = visible ? '🪟 Overlay on' : '🪟 Overlay';
      button.setAttribute('aria-pressed', String(visible));
    });
  });
};
wireOverlayToggle();

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

  const option = (value: string, label: string): HTMLOptionElement => {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label;
    return opt;
  };

  const refreshOutputs = (): void => {
    void listOutputDevices(navigator.mediaDevices).then((devices) => {
      const chosen = select.value;
      // Always keep a "System default" entry first, so the picker is never empty (device labels are
      // blank / the list can be empty until mic permission is granted).
      select.replaceChildren(
        option('', 'System default'),
        ...devices.filter((d) => !d.isDefault).map((d) => option(d.deviceId, d.label)),
      );
      if ([...select.options].some((o) => o.value === chosen)) select.value = chosen;
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
 * The tiered voice output (T10.1 audio-out bridge, docs/07). The Core **worker** runs the
 * {@link VoicePlayer} (priority queue, preemption, barge-in) off the UI thread, but a utility process
 * has no audio device — so it drives playback *here* over `window.audioOut`. Each clip plays on the
 * shared `engineer-audio` element (so the output-device picker routes the engineer's voice), and its
 * completion is reported back so the queue drains the next utterance. A metadata-only clip (no
 * synthesized bytes yet — the free FakeTtsProvider default) "plays" silently for its `durationMs`; the
 * real cloud/local TTS that fills the bytes is the next slice. Output-only — no game path (rule 5).
 */
const wireAudioOut = (): void => {
  if (!window.audioOut) return;
  const audio = document.getElementById('engineer-audio') as HTMLAudioElement | null;
  if (!audio) return;

  const backend: AudioSink = {
    play(clip: AudioClip, opts: { volume: number; onEnded: () => void }): PlaybackHandle {
      if (!clip.audio) {
        // No synthesized bytes: keep the queue moving by completing after the estimated duration.
        const timer = window.setTimeout(() => opts.onEnded(), clip.durationMs ?? 0);
        return { stop: () => window.clearTimeout(timer), setVolume: () => {} };
      }
      // Copy into a fresh ArrayBuffer-backed view (the IPC-cloned bytes are `ArrayBufferLike`, which
      // the DOM `BlobPart` type rejects) — cheap for a sentence-sized clip.
      const blob = new Blob(
        [new Uint8Array(clip.audio.data)],
        clip.audio.mimeType ? { type: clip.audio.mimeType } : undefined,
      );
      const url = URL.createObjectURL(blob);
      let done = false;
      const cleanup = (): void => {
        if (done) return;
        done = true;
        audio.removeEventListener('ended', onEnded);
        audio.removeEventListener('error', onError);
        URL.revokeObjectURL(url);
      };
      const onEnded = (): void => {
        cleanup();
        opts.onEnded();
      };
      // Never strand the queue on a decode/playback error — treat it as a (silent) completion.
      const onError = (): void => {
        cleanup();
        opts.onEnded();
      };
      audio.addEventListener('ended', onEnded);
      audio.addEventListener('error', onError);
      audio.src = url;
      audio.volume = opts.volume;
      void audio.play().catch(onError);
      return {
        // stop() = preempt/barge-in: halt playback, no onEnded (matches the AudioSink contract).
        stop: () => {
          audio.pause();
          cleanup();
        },
        setVolume: (v: number) => {
          audio.volume = v;
        },
      };
    },
    setOutputDevice: (id: string) => void applyOutputDevice(audio, id),
  };

  const receive = createAudioReceiver(backend, (m) => window.audioOut.ended(m.pid));
  window.audioOut.onCommand((msg) => {
    // The worker's real voice (Piper/cloud) coming online owns proactive call-outs — silence the free
    // Web-Speech fallback so the two voices don't overlap (robotic echo). A fake/silent worker voice
    // (active:false) leaves the Web-Speech call-outs as the only voice.
    if (msg.kind === 'voice-active') {
      workerVoicingCallouts = msg.active;
      const toggle = document.getElementById('callout-toggle');
      if (msg.active) {
        // The real engine voice owns call-outs — silence the Web-Speech fallback and hide its toggle.
        calloutSpeaker?.setEnabled(false);
        if (toggle) toggle.hidden = true;
      } else {
        // No audible worker voice (none configured, or its build failed) — the free Web-Speech
        // fallback voices call-outs again.
        calloutSpeaker?.setEnabled(true);
        if (toggle) toggle.hidden = false;
      }
      return;
    }
    receive(msg);
  });
};
wireAudioOut();

/**
 * Push-to-talk radio input (T10.1 voice loop slice 2, docs/07 §PTT flow). Holding the button captures
 * the mic (`getUserMedia` → Web Audio, 16 kHz mono PCM) and streams frames to the Core **worker** over
 * `window.radioIn`, where the STT runs (the key never reaches the renderer — rule 6). The PTT edges
 * drive the worker's capture lifecycle. Capture runs **only while held** (privacy-friendly, no wake
 * word). The mapped wheel button is the rig PTT; this hold-button is the dev trigger. Input-only — no
 * game path. (Real STT understanding + the spoken reply are slice 3; the worker logs the transcript.)
 */
const wireRadioInput = (): void => {
  const button = document.getElementById('radio-ptt') as HTMLButtonElement | null;
  if (!button || !window.radioIn) return;
  // Mic capture needs getUserMedia + Web Audio; hide the control where they're unavailable.
  if (!navigator.mediaDevices?.getUserMedia || typeof AudioContext === 'undefined') {
    button.hidden = true;
    return;
  }

  // getUserMedia → Web Audio capture backend producing **16 kHz mono PCM** frames (what whisper.cpp
  // wants; the cloud STT wraps the same PCM to WAV). The `AudioContext` resamples the mic to 16 kHz, a
  // `ScriptProcessorNode` hands us Float32 blocks, and we ship them as little-endian Int16. Routed
  // through a zero-gain node so the processor runs without mic→speaker feedback. Guards a release that
  // beats the async permission grant, so the mic is never left open. Input-only — no game path.
  const makeMicCapture = (): MicCaptureBackend => {
    let active = false;
    let ctx: AudioContext | null = null;
    let stream: MediaStream | null = null;
    let node: ScriptProcessorNode | null = null;
    let source: MediaStreamAudioSourceNode | null = null;
    const teardown = (): void => {
      node?.disconnect();
      source?.disconnect();
      if (ctx) void ctx.close();
      ctx = null;
      node = null;
      source = null;
      stream?.getTracks().forEach((t) => t.stop());
      stream = null;
    };
    return {
      start(onFrame: (frame: Uint8Array) => void): void {
        active = true;
        void navigator.mediaDevices
          .getUserMedia({
            audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
          })
          .then((s) => {
            if (!active) {
              s.getTracks().forEach((t) => t.stop()); // released before the grant — don't open the mic
              return;
            }
            stream = s;
            ctx = new AudioContext({ sampleRate: 16000 }); // 16 kHz — see MIC_SAMPLE_RATE_HZ
            source = ctx.createMediaStreamSource(s);
            node = ctx.createScriptProcessor(4096, 1, 1);
            const mute = ctx.createGain();
            mute.gain.value = 0;
            node.onaudioprocess = (e: AudioProcessingEvent): void => {
              const input = e.inputBuffer.getChannelData(0); // Float32 @ 16 kHz
              const pcm = new Int16Array(input.length);
              for (let i = 0; i < input.length; i += 1) {
                const x = Math.max(-1, Math.min(1, input[i] ?? 0));
                pcm[i] = x < 0 ? x * 0x8000 : x * 0x7fff;
              }
              onFrame(new Uint8Array(pcm.buffer.slice(0))); // copy — the buffer is reused next block
            };
            source.connect(node);
            node.connect(mute);
            mute.connect(ctx.destination);
          })
          .catch(() => {
            active = false; // denied / no device — the 🎤 Test mic button surfaces the guidance
          });
      },
      stop(): void {
        active = false;
        teardown();
      },
    };
  };

  const radio = createRadioInput({
    capture: makeMicCapture(),
    postFrame: (f) => window.radioIn.frame(f),
    postPtt: (down) => window.radioIn.ptt(down),
  });

  const setHeld = (held: boolean): void => button.setAttribute('aria-pressed', String(held));
  button.addEventListener('pointerdown', () => {
    radio.pttDown();
    setHeld(true);
  });
  const release = (): void => {
    radio.pttUp();
    setHeld(false);
  };
  button.addEventListener('pointerup', release);
  button.addEventListener('pointerleave', release); // dragged off / released outside → end capture
  button.addEventListener('pointercancel', release);
};
wireRadioInput();

/**
 * The settings panel (T6.3): profile / engineer (LLM) / proactivity persist via `window.settings`,
 * and cloud API keys are stored in OS secure storage — the renderer only ever sends a key (once) and
 * learns *which* slots are set, never a value (docs/15, rule 6). The free/template default needs no
 * key; this is opt-in BYO-key.
 */
const wireSettingsPanel = (): void => {
  const profile = document.getElementById('set-profile') as HTMLSelectElement | null;
  const llm = document.getElementById('set-llm') as HTMLSelectElement | null;
  const voiceTts = document.getElementById('set-voice-tts') as HTMLSelectElement | null;
  const voiceStt = document.getElementById('set-voice-stt') as HTMLSelectElement | null;
  const proactivity = document.getElementById('set-proactivity') as HTMLSelectElement | null;
  const slot = document.getElementById('set-slot') as HTMLSelectElement | null;
  const keyInput = document.getElementById('set-key') as HTMLInputElement | null;
  const save = document.getElementById('set-key-save') as HTMLButtonElement | null;
  const clear = document.getElementById('set-key-clear') as HTMLButtonElement | null;
  const keysLabel = document.getElementById('set-keys');
  const costLabel = document.getElementById('set-cost');
  if (
    !profile ||
    !llm ||
    !voiceTts ||
    !voiceStt ||
    !proactivity ||
    !slot ||
    !keyInput ||
    !save ||
    !clear ||
    !keysLabel ||
    !costLabel
  )
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
  fill(voiceTts, TTS_ENGINES);
  fill(voiceStt, STT_ENGINES);
  fill(proactivity, PROACTIVITY_LEVELS);
  fill(slot, SECRET_SLOTS);

  let current: AppSettings | null = null;

  // Show what the configured cloud providers would cost the user per hour / per 24 h (docs/15). The
  // default free/local profile reads "$0"; the estimate is advisory — no provider is billed by us.
  const paintCost = (settings: AppSettings): void => {
    costLabel.textContent = estimateCloudCost(settings).summary;
  };

  const persist = (): void => {
    if (!current) return;
    const next: AppSettings = {
      ...current,
      profile: profile.value as AppSettings['profile'],
      llm: { ...current.llm, provider: llm.value as AppSettings['llm']['provider'] },
      voice: {
        ...current.voice,
        tts: voiceTts.value as AppSettings['voice']['tts'],
        stt: voiceStt.value as AppSettings['voice']['stt'],
      },
      proactivity: proactivity.value as AppSettings['proactivity'],
    };
    paintCost(next); // reflect the new route immediately, before the async save resolves
    void window.settings.save(next).then((saved) => {
      current = saved;
    });
  };

  const showKeys = (slots: readonly string[]): void => {
    keysLabel.textContent = slots.length > 0 ? `keys set: ${slots.join(', ')}` : 'no keys set';
  };

  for (const control of [profile, llm, voiceTts, voiceStt, proactivity])
    control.addEventListener('change', persist);

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
    voiceTts.value = loaded.voice.tts;
    voiceStt.value = loaded.voice.stt;
    proactivity.value = loaded.proactivity;
    paintCost(loaded);
  });
  void window.settings.listApiKeys().then(showKeys);
};
wireSettingsPanel();

/**
 * Push-to-talk mapping (T10.1 / docs/08 §1). "Map button" arms capture in the main process; the next
 * wheel-button press is bound and reported back. The flow is read-only/advisory — the app only learns
 * *which* button keys the radio; it never sends input to the game (CLAUDE.md rule 5). With no wheel
 * (e.g. the dev box) the listen window simply times out — capturing a real button is the rig step.
 */
const wirePttBar = (): void => {
  const binding = document.getElementById('ptt-binding');
  const mapBtn = document.getElementById('ptt-map') as HTMLButtonElement | null;
  const clearBtn = document.getElementById('ptt-clear') as HTMLButtonElement | null;
  const status = document.getElementById('ptt-status');
  if (!binding || !mapBtn || !clearBtn || !status) return;

  let listening = false;

  const setStatus = (text: string, cls: '' | 'ok' | 'bad' | 'listening'): void => {
    status.textContent = text;
    status.className = `voice-status${cls ? ` ${cls}` : ''}`;
  };
  const setListening = (on: boolean): void => {
    listening = on;
    mapBtn.textContent = on ? 'Cancel' : 'Map button';
  };

  window.ptt.onMappingEvent((event) => {
    switch (event.type) {
      case 'listening':
        setListening(true);
        setStatus('Press the push-to-talk button on your wheel…', 'listening');
        break;
      case 'captured':
        setListening(false);
        binding.textContent = `${event.deviceName} · button ${event.buttonIndex}`;
        setStatus('Mapped', 'ok');
        break;
      case 'cancelled':
        setListening(false);
        setStatus(event.reason === 'timeout' ? 'No button detected — try again' : '', 'bad');
        break;
      case 'error':
        setListening(false);
        setStatus(event.message, 'bad');
        break;
    }
  });

  mapBtn.addEventListener('click', () => {
    if (listening) void window.ptt.cancelMapping();
    else void window.ptt.beginMapping();
  });

  clearBtn.addEventListener('click', () => {
    void window.ptt.clearMapping().then((info) => {
      binding.textContent = info.label;
      setStatus('', '');
    });
  });

  void window.ptt.getBinding().then((info) => {
    binding.textContent = info.label;
  });
};
wirePttBar();
