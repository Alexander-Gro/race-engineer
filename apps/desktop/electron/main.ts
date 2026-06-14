import path from 'node:path';
import { app, BrowserWindow, utilityProcess, type UtilityProcess } from 'electron';
import { SNAPSHOT_CHANNEL, type EngineerSnapshot } from '@race-engineer/engineer-core';
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
  worker.on('message', (snapshot: EngineerSnapshot) => {
    lastSnapshot = snapshot;
    // Broadcast to all live windows so a re-opened window (macOS dock re-open) keeps receiving.
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(SNAPSHOT_CHANNEL, snapshot);
    }
  });
};

const main = (): void => {
  // Single-instance lock (docs/16 §9) — wired to Electron here, stubbed/tested in src/.
  const { isPrimary } = requestSingleInstanceLock(() => app.requestSingleInstanceLock());
  if (!isPrimary) {
    app.quit();
    return;
  }

  void app.whenReady().then(() => {
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
