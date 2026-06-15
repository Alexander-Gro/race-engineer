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
  SNAPSHOT_CHANNEL,
  type EngineerSnapshot,
} from '@race-engineer/engineer-core';
import type { AskRequestMessage, WorkerMessage } from '../src/ask';
import { MIC_SETTINGS_DEEPLINK } from '../src/audio-io';
import { requestSingleInstanceLock } from '../src/single-instance';

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
// The most recent snapshot, replayed to any window once it finishes loading so a freshly-opened or
// reloaded window paints immediately instead of waiting for the next throttled tick.
let lastSnapshot: EngineerSnapshot | null = null;

// Pending text-ask requests, correlated by id: renderer → main (invoke) → worker → main → resolve.
let askSeq = 0;
const pendingAsks = new Map<number, (answer: string) => void>();
const ASK_TIMEOUT_MS = 5000;

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
  return window;
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

  void app.whenReady().then(() => {
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
    worker?.kill();
    worker = null;
  });
};

main();
