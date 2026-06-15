import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import {
  ASK_CHANNEL,
  SNAPSHOT_CHANNEL,
  type EngineerBridge,
  type EngineerSnapshot,
} from '@race-engineer/engineer-core';

/**
 * Preload (build-plan T6.1 / Track A text-ask). Exposes a **read-only** {@link EngineerBridge} to
 * the renderer via `contextBridge` — the renderer can only *subscribe* to snapshots and *ask* the
 * engineer a text question (a query that reaches the read-only AI tools), never send anything toward
 * the game (CLAUDE.md rule 5). `contextIsolation` keeps Node out of the renderer.
 */
const bridge: EngineerBridge = {
  onSnapshot(listener: (snapshot: EngineerSnapshot) => void): () => void {
    const handler = (_event: IpcRendererEvent, snapshot: EngineerSnapshot): void =>
      listener(snapshot);
    ipcRenderer.on(SNAPSHOT_CHANNEL, handler);
    return () => ipcRenderer.removeListener(SNAPSHOT_CHANNEL, handler);
  },
  ask(question: string): Promise<string> {
    return ipcRenderer.invoke(ASK_CHANNEL, question) as Promise<string>;
  },
};

contextBridge.exposeInMainWorld('engineer', bridge);
