import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import {
  ASK_CHANNEL,
  OPEN_MIC_SETTINGS_CHANNEL,
  SNAPSHOT_CHANNEL,
  type EngineerBridge,
  type EngineerSnapshot,
} from '@race-engineer/engineer-core';
import {
  PTT_EVENT_CHANNEL,
  PTT_GET_CHANNEL,
  PTT_MAP_BEGIN_CHANNEL,
  PTT_MAP_CANCEL_CHANNEL,
  PTT_MAP_CLEAR_CHANNEL,
  type PttApi,
  type PttBindingInfo,
  type PttMappingEvent,
} from '../src/ptt-mapping';
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
 * Preload (build-plan T6.1 / Track A text-ask + T6.3 settings + T10.1 PTT mapping). Exposes three
 * read-only/advisory bridges via `contextBridge`: `window.engineer` (subscribe to snapshots, ask a text
 * question, open the OS mic-settings page), `window.settings` (config CRUD + BYO-key management), and
 * `window.ptt` (map the push-to-talk wheel button). None can send anything toward the game (CLAUDE.md
 * rule 5). `contextIsolation` keeps Node out of the renderer.
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

// PTT mapping (T10.1, docs/08 §1): arm capture, then learn which button was bound — advisory only.
const ptt: PttApi = {
  beginMapping: () => ipcRenderer.invoke(PTT_MAP_BEGIN_CHANNEL) as Promise<void>,
  cancelMapping: () => ipcRenderer.invoke(PTT_MAP_CANCEL_CHANNEL) as Promise<void>,
  clearMapping: () => ipcRenderer.invoke(PTT_MAP_CLEAR_CHANNEL) as Promise<PttBindingInfo>,
  getBinding: () => ipcRenderer.invoke(PTT_GET_CHANNEL) as Promise<PttBindingInfo>,
  onMappingEvent(listener: (event: PttMappingEvent) => void): () => void {
    const handler = (_event: IpcRendererEvent, mappingEvent: PttMappingEvent): void =>
      listener(mappingEvent);
    ipcRenderer.on(PTT_EVENT_CHANNEL, handler);
    return () => ipcRenderer.removeListener(PTT_EVENT_CHANNEL, handler);
  },
};

contextBridge.exposeInMainWorld('engineer', bridge);
contextBridge.exposeInMainWorld('settings', settings);
contextBridge.exposeInMainWorld('ptt', ptt);
