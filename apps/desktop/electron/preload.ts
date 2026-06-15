import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import {
  ASK_CHANNEL,
  OPEN_MIC_SETTINGS_CHANNEL,
  SNAPSHOT_CHANNEL,
  type EngineerBridge,
  type EngineerSnapshot,
} from '@race-engineer/engineer-core';
import type { AppSettings, SecretSlot } from '../src/settings';
import {
  SECRET_DELETE_CHANNEL,
  SECRET_LIST_CHANNEL,
  SECRET_SET_CHANNEL,
  SETTINGS_LOAD_CHANNEL,
  SETTINGS_SAVE_CHANNEL,
  type SettingsApi,
} from '../src/settings-bridge';

/**
 * Preload (build-plan T6.1 / Track A text-ask + T6.3 settings). Exposes two read-only/advisory
 * bridges via `contextBridge`: `window.engineer` (subscribe to snapshots, ask a text question, open
 * the OS mic-settings page) and `window.settings` (config CRUD + BYO-key management). Neither can send
 * anything toward the game (CLAUDE.md rule 5). `contextIsolation` keeps Node out of the renderer.
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
  openMicSettings(): Promise<void> {
    return ipcRenderer.invoke(OPEN_MIC_SETTINGS_CHANNEL) as Promise<void>;
  },
};

const settings: SettingsApi = {
  load: () => ipcRenderer.invoke(SETTINGS_LOAD_CHANNEL) as Promise<AppSettings>,
  save: (next: AppSettings) =>
    ipcRenderer.invoke(SETTINGS_SAVE_CHANNEL, next) as Promise<AppSettings>,
  // Plaintext crosses to main once here; main encrypts it and only ever returns the set-slot list.
  setApiKey: (slot: SecretSlot, value: string) =>
    ipcRenderer.invoke(SECRET_SET_CHANNEL, slot, value) as Promise<SecretSlot[]>,
  deleteApiKey: (slot: SecretSlot) =>
    ipcRenderer.invoke(SECRET_DELETE_CHANNEL, slot) as Promise<SecretSlot[]>,
  listApiKeys: () => ipcRenderer.invoke(SECRET_LIST_CHANNEL) as Promise<SecretSlot[]>,
};

contextBridge.exposeInMainWorld('engineer', bridge);
contextBridge.exposeInMainWorld('settings', settings);
