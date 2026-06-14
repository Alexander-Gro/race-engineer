import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import {
  SNAPSHOT_CHANNEL,
  type EngineerBridge,
  type EngineerSnapshot,
} from '@race-engineer/engineer-core';

/**
 * Preload (build-plan T6.1). Exposes a **read-only** {@link EngineerBridge} to the renderer via
 * `contextBridge` — the renderer can only *subscribe* to snapshots, never send anything toward
 * the game (CLAUDE.md rule 5). `contextIsolation` keeps Node out of the renderer.
 */
const bridge: EngineerBridge = {
  onSnapshot(listener: (snapshot: EngineerSnapshot) => void): () => void {
    const handler = (_event: IpcRendererEvent, snapshot: EngineerSnapshot): void =>
      listener(snapshot);
    ipcRenderer.on(SNAPSHOT_CHANNEL, handler);
    return () => ipcRenderer.removeListener(SNAPSHOT_CHANNEL, handler);
  },
};

contextBridge.exposeInMainWorld('engineer', bridge);
