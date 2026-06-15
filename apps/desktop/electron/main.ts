import path from 'node:path';
import {
  app,
  BrowserWindow,
  ipcMain,
  session,
  shell,
  utilityProcess,
  type UtilityProcess,
} from 'electron';
import {
  ASK_CHANNEL,
  OPEN_MIC_SETTINGS_CHANNEL,
  OVERLAY_TOGGLE_CHANNEL,
  SNAPSHOT_CHANNEL,
  type EngineerSnapshot,
} from '@race-engineer/engineer-core';
import type {
  AskRequestMessage,
  AudioEndedRelayMessage,
  ConfigureMessage,
  RadioFrameRelayMessage,
  RadioPttRelayMessage,
  WorkerMessage,
} from '../src/ask';
import { AUDIO_ENDED_CHANNEL, AUDIO_OUT_CHANNEL } from '../src/audio-bridge';
import { RADIO_FRAME_CHANNEL, RADIO_PTT_CHANNEL } from '../src/mic-bridge';
import { MIC_SETTINGS_DEEPLINK } from '../src/audio-io';
import { resolveLlmRouteConfig } from '../src/llm-route';
import {
  formatPttBinding,
  PttMapper,
  PTT_EVENT_CHANNEL,
  PTT_GET_CHANNEL,
  PTT_MAP_BEGIN_CHANNEL,
  PTT_MAP_CANCEL_CHANNEL,
  PTT_MAP_CLEAR_CHANNEL,
  type PttBindingInfo,
  type PttMappingEvent,
} from '../src/ptt-mapping';
import { isSecretSlot, SettingsStore, type AppSettings } from '../src/settings';
import {
  SECRET_DELETE_CHANNEL,
  SECRET_LIST_CHANNEL,
  SECRET_SET_CHANNEL,
  SETTINGS_LOAD_CHANNEL,
  SETTINGS_SAVE_CHANNEL,
} from '../src/settings-bridge';
import { requestSingleInstanceLock } from '../src/single-instance';
import { fsSettingsStorage, SafeStorageSecretStore } from './stores';

/**
 * Electron main process (build-plan T6.1). Hosts the **Engineer Core in a worker / utility
 * process** (off the UI thread) and forwards its throttled `RaceState` snapshots to the renderer
 * over the typed IPC channel. Read-only/advisory: snapshots flow Core → main → renderer only;
 * there is no channel from the renderer toward the game.
 *
 * NOTE (T6.1 live half): this is the Electron entry, built by electron-vite (see
 * `electron.vite.config.ts`). It runs on a dev machine once `electron` is installed; it is not
 * exercised by the offline test suite. The pipeline/throttle/snapshot logic it hosts lives in
 * `@race-engineer/engineer-core` and `../src/host`, which ARE unit-tested with no Electron and no
 * game. Paths below match electron-vite's `out/` layout (main + worker in `out/main`, preload in
 * `out/preload`, renderer in `out/renderer`).
 */

let worker: UtilityProcess | null = null;
// The main window — the single audio output target (the overlay never plays audio, to avoid double
// playback). Assigned in createWindow; the audio bridge sends play/stop commands here only.
let mainWindow: BrowserWindow | null = null;
// The most recent snapshot, replayed to any window once it finishes loading so a freshly-opened or
// reloaded window paints immediately instead of waiting for the next throttled tick.
let lastSnapshot: EngineerSnapshot | null = null;

// Pending text-ask requests, correlated by id: renderer → main (invoke) → worker → main → resolve.
let askSeq = 0;
const pendingAsks = new Map<number, (answer: string) => void>();
const ASK_TIMEOUT_MS = 5000;

// Push the saved engineer route (LLM provider + decrypted key, or template) to the worker. Assigned
// in `whenReady` once the stores exist; called when the worker signals ready and on every settings/
// secret change so a "mode switch" takes effect live. The key crosses only main→worker, never to the
// renderer.
let pushEngineerConfig: (() => void) | null = null;

// PTT-mapping coordinator (T10.1, docs/08 §1). Built in `whenReady` (it persists into settings). Reads
// the wheel **passively** to learn which button is push-to-talk — there is no write path to the game.
let pttMapper: PttMapper | null = null;

/** Push a PTT mapping-flow event to every open window (the renderer reflects listening/captured/…). */
const broadcastPttEvent = (event: PttMappingEvent): void => {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(PTT_EVENT_CHANNEL, event);
  }
};

const createWindow = (): BrowserWindow => {
  const window = new BrowserWindow({
    width: 1100,
    height: 720,
    title: 'Race Engineer',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  // Dev: electron-vite serves the renderer with HMR and sets ELECTRON_RENDERER_URL.
  // Prod: load the bundled renderer from disk.
  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (devUrl) void window.loadURL(devUrl);
  else void window.loadFile(path.join(__dirname, '../renderer/index.html'));
  // The renderer subscribes during load; the worker may already be mid-stream, so paint the latest
  // snapshot the moment the page is ready (and again after an HMR reload).
  window.webContents.on('did-finish-load', () => {
    if (lastSnapshot && !window.isDestroyed()) {
      window.webContents.send(SNAPSHOT_CHANNEL, lastSnapshot);
    }
  });
  mainWindow = window; // the audio bridge's output target
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null;
  });
  return window;
};

// The in-race overlay (T6.4, docs/09 §Overlay): a small always-on-top, transparent, click-through
// window over the (borderless) game. Created lazily on first toggle and **hidden by default**. It
// consumes the same read-only snapshot broadcast as the main window — no game write path.
let overlayWindow: BrowserWindow | null = null;

const createOverlayWindow = (): BrowserWindow => {
  const overlay = new BrowserWindow({
    width: 320,
    height: 240,
    x: 24,
    y: 24,
    show: false, // default off (docs/09 — opt-in)
    frame: false,
    transparent: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false, // never steal focus from the game
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  // Float above borderless-fullscreen games (docs/09 caveat: not exclusive-fullscreen DirectX).
  overlay.setAlwaysOnTop(true, 'screen-saver');
  // Click-through: the overlay never intercepts the mouse — input passes to the game underneath.
  overlay.setIgnoreMouseEvents(true, { forward: true });
  overlay.on('closed', () => {
    overlayWindow = null;
  });
  // Paint immediately on (re)load with the freshest snapshot.
  overlay.webContents.on('did-finish-load', () => {
    if (lastSnapshot && !overlay.isDestroyed())
      overlay.webContents.send(SNAPSHOT_CHANNEL, lastSnapshot);
  });
  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (devUrl) void overlay.loadURL(`${devUrl}/overlay.html`);
  else void overlay.loadFile(path.join(__dirname, '../renderer/overlay.html'));
  return overlay;
};

/** Show/hide the overlay (creating it on first use); returns its new visibility. */
const toggleOverlay = (): boolean => {
  if (!overlayWindow || overlayWindow.isDestroyed()) overlayWindow = createOverlayWindow();
  if (overlayWindow.isVisible()) {
    overlayWindow.hide();
  } else {
    overlayWindow.showInactive(); // show without focusing — keep the game focused
    if (lastSnapshot) overlayWindow.webContents.send(SNAPSHOT_CHANNEL, lastSnapshot);
  }
  return overlayWindow.isVisible();
};

/** One worker for the app's lifetime, broadcasting snapshots to every open window. */
const startEngineerWorker = (): void => {
  // The worker runs the tick pipeline; the bundler emits `engineer-worker.js` alongside main.
  // Inherit env (so ENGINEER_SOURCE=lmu reaches the worker) and pipe its console to our terminal
  // (so the live-source status — "waiting for an LMU session", errors — is visible during `dev:lmu`).
  worker = utilityProcess.fork(path.join(__dirname, 'engineer-worker.js'), [], {
    stdio: 'pipe',
    env: process.env,
  });
  worker.stdout?.on('data', (chunk: Buffer) => process.stdout.write(chunk));
  worker.stderr?.on('data', (chunk: Buffer) => process.stderr.write(chunk));
  worker.on('message', (message: WorkerMessage) => {
    if (message.type === 'snapshot') {
      lastSnapshot = message.snapshot;
      // Broadcast to all live windows so a re-opened window (macOS dock re-open) keeps receiving.
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) window.webContents.send(SNAPSHOT_CHANNEL, message.snapshot);
      }
    } else if (message.type === 'ask-reply') {
      const resolve = pendingAsks.get(message.id);
      if (resolve) {
        pendingAsks.delete(message.id);
        resolve(message.answer);
      }
    } else if (message.type === 'audio') {
      // The voice queue (worker) wants the renderer to play/stop a clip. Send to the main window
      // only — the overlay shares the snapshot feed but must not double up the audio.
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(AUDIO_OUT_CHANNEL, message.audio);
      }
    } else if (message.type === 'ready') {
      // The worker attached its listener — safe to send the engineer route now (no fork race).
      pushEngineerConfig?.();
    }
  });
};

/** Relay a renderer question to the worker and resolve when its answer comes back (or it times out). */
const askEngineerViaWorker = (question: string): Promise<string> => {
  if (!worker) return Promise.resolve("The engineer isn't running yet — give it a moment.");
  const id = ++askSeq;
  return new Promise<string>((resolve) => {
    pendingAsks.set(id, resolve);
    worker?.postMessage({ type: 'ask', id, question } satisfies AskRequestMessage);
    setTimeout(() => {
      if (pendingAsks.delete(id)) resolve("Sorry — I didn't get that in time.");
    }, ASK_TIMEOUT_MS);
  });
};

const main = (): void => {
  // Single-instance lock (docs/16 §9) — wired to Electron here, stubbed/tested in src/.
  const { isPrimary } = requestSingleInstanceLock(() => app.requestSingleInstanceLock());
  if (!isPrimary) {
    app.quit();
    return;
  }

  // Renderer asks a text question; main relays it to the worker and returns the spoken-style answer.
  // `invoke`/`handle` is request/response only — there is no fire-and-forget channel toward the game.
  ipcMain.handle(
    ASK_CHANNEL,
    (_event, question: unknown): Promise<string> =>
      askEngineerViaWorker(typeof question === 'string' ? question : ''),
  );

  // Mic-denied recovery (docs/16 §1): open the OS mic-privacy page. The URL is a fixed constant —
  // nothing from the renderer is interpolated, so this can't become an open-anything hole.
  ipcMain.handle(OPEN_MIC_SETTINGS_CHANNEL, () => shell.openExternal(MIC_SETTINGS_DEEPLINK));

  // Show/hide the in-race overlay (docs/09 §Overlay, T6.4). View-only toggle — the overlay reads the
  // same snapshot stream; there is no game-write path.
  ipcMain.handle(OVERLAY_TOGGLE_CHANNEL, () => toggleOverlay());

  // Renderer reports a clip finished playing → relay to the worker so the voice queue drains the next
  // utterance (T10.1 audio-out bridge). Fire-and-forget (`on`, not `handle`); carries no game data.
  ipcMain.on(AUDIO_ENDED_CHANNEL, (_event, pid: unknown) => {
    if (typeof pid === 'number') {
      worker?.postMessage({ type: 'audio-ended', pid } satisfies AudioEndedRelayMessage);
    }
  });

  // Mic-in bridge (T10.1 slice 2): relay the renderer's PTT edges + captured mic frames to the worker's
  // radio capture. Input-only — the driver's radio audio in; nothing flows toward the game (rule 5).
  ipcMain.on(RADIO_PTT_CHANNEL, (_event, down: unknown) => {
    if (typeof down === 'boolean') {
      worker?.postMessage({ type: 'radio-ptt', down } satisfies RadioPttRelayMessage);
    }
  });
  ipcMain.on(RADIO_FRAME_CHANNEL, (_event, frame: unknown) => {
    if (frame instanceof Uint8Array) {
      worker?.postMessage({ type: 'radio-frame', frame } satisfies RadioFrameRelayMessage);
    }
  });

  void app.whenReady().then(() => {
    // Settings + secrets (T6.3). Stores live in the user-data dir (resolved after `ready`); keys are
    // encrypted via safeStorage and a key's plaintext is never returned to the renderer — only the
    // set-slot list is.
    const settingsStore = new SettingsStore(
      fsSettingsStorage(path.join(app.getPath('userData'), 'settings.json')),
    );
    const secretStore = new SafeStorageSecretStore(
      path.join(app.getPath('userData'), 'secrets.json'),
    );
    // Resolve the saved route (reads the decrypted key) and hand it to the worker, which builds the
    // provider. Re-pushed on every settings/secret change so switching the engineer takes effect live.
    pushEngineerConfig = (): void => {
      if (!worker) return;
      const settings = settingsStore.load();
      const llmRoute = resolveLlmRouteConfig(settings.llm, secretStore);
      worker.postMessage({
        type: 'configure',
        llmRoute,
        proactivity: settings.proactivity,
      } satisfies ConfigureMessage);
    };

    ipcMain.handle(SETTINGS_LOAD_CHANNEL, () => settingsStore.load());
    ipcMain.handle(SETTINGS_SAVE_CHANNEL, (_event, next: AppSettings) => {
      const saved = settingsStore.save(next);
      pushEngineerConfig?.(); // a changed engineer/provider takes effect immediately
      return saved;
    });
    ipcMain.handle(SECRET_SET_CHANNEL, (_event, slot: unknown, value: unknown) => {
      if (isSecretSlot(slot) && typeof value === 'string') secretStore.setKey(slot, value);
      pushEngineerConfig?.(); // a newly-added key may activate the configured cloud route
      return secretStore.listSetKeys();
    });
    ipcMain.handle(SECRET_DELETE_CHANNEL, (_event, slot: unknown) => {
      if (isSecretSlot(slot)) secretStore.deleteKey(slot);
      pushEngineerConfig?.();
      return secretStore.listSetKeys();
    });
    ipcMain.handle(SECRET_LIST_CHANNEL, () => secretStore.listSetKeys());

    // PTT mapping (T10.1, docs/08 §1). The backend is opened only when the user maps — and the SDL2
    // (koffi, Windows-only) backend is loaded lazily, so the default path never touches it. On the dev
    // box there's no joystick backend, so the flow runs but finds nothing to press: the live capture is
    // the rig human-assisted half. Read-only/advisory: it reads a button, it never sends input.
    const currentBinding = (): PttBindingInfo => {
      const ptt = settingsStore.load().ptt;
      return { ptt, label: formatPttBinding(ptt) };
    };
    pttMapper = new PttMapper({
      openReader: async (onMapped) => {
        // Dynamic import keeps koffi/SDL2 off the default path (the synthetic demo never loads it).
        const { InputReader, Sdl2Backend, MockBackend } = await import('@race-engineer/input');
        const backend = process.platform === 'win32' ? new Sdl2Backend() : new MockBackend();
        const reader = new InputReader({ backend, events: { onMapped } });
        reader.beginMapping('ptt');
        return {
          poll: () => reader.poll(),
          close: () => {
            reader.cancelMapping();
            reader.stop(); // passive read only — releases the device, no write path
          },
        };
      },
      onCaptured: (ptt) => {
        settingsStore.save({ ...settingsStore.load(), ptt }); // persist the bound button
      },
      emit: broadcastPttEvent,
    });
    ipcMain.handle(PTT_MAP_BEGIN_CHANNEL, () => pttMapper?.begin());
    ipcMain.handle(PTT_MAP_CANCEL_CHANNEL, () => pttMapper?.cancel());
    ipcMain.handle(PTT_MAP_CLEAR_CHANNEL, () => {
      settingsStore.save({ ...settingsStore.load(), ptt: null });
      return currentBinding();
    });
    ipcMain.handle(PTT_GET_CHANNEL, () => currentBinding());

    // Grant the renderer's own microphone requests (Windows uses the standard getUserMedia flow;
    // docs/16 §1). Only read-only mic capture for push-to-talk is auto-approved; everything else denied.
    session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) =>
      callback(permission === 'media'),
    );
    startEngineerWorker();
    createWindow();
    app.on('activate', () => {
      // Dock re-open: a fresh window picks up the running worker's broadcast.
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    // Windows (the only runtime target) quits here. On macOS dev keep the app + worker alive so
    // dock re-open works; the worker is torn down on actual quit below.
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('will-quit', () => {
    pttMapper?.dispose();
    pttMapper = null;
    overlayWindow?.destroy();
    overlayWindow = null;
    worker?.kill();
    worker = null;
  });
};

main();
