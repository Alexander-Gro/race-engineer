import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import {
  ASK_CHANNEL,
  OPEN_MIC_SETTINGS_CHANNEL,
  OVERLAY_TOGGLE_CHANNEL,
  SNAPSHOT_CHANNEL,
  type EngineerBridge,
  type EngineerSnapshot,
} from '@race-engineer/engineer-core';
import {
  AUDIO_ENDED_CHANNEL,
  AUDIO_OUT_CHANNEL,
  type AudioOutApi,
  type AudioOutMessage,
} from '../src/audio-bridge';
import {
  RADIO_FRAME_CHANNEL,
  RADIO_LOG_CHANNEL,
  RADIO_PTT_CHANNEL,
  type RadioInApi,
  type RadioLogMessage,
} from '../src/mic-bridge';
import {
  PTT_EVENT_CHANNEL,
  PTT_GET_CHANNEL,
  PTT_LIVE_CHANNEL,
  PTT_MAP_BEGIN_CHANNEL,
  PTT_MAP_CANCEL_CHANNEL,
  PTT_MAP_CLEAR_CHANNEL,
  type PttApi,
  type PttBindingInfo,
  type PttMappingEvent,
} from '../src/ptt-mapping';
import type { AppSettings, SecretSlot } from '../src/settings';
import {
  OLLAMA_MODELS_CHANNEL,
  SECRET_DELETE_CHANNEL,
  SECRET_LIST_CHANNEL,
  SECRET_SET_CHANNEL,
  SETTINGS_LOAD_CHANNEL,
  SETTINGS_SAVE_CHANNEL,
  type OllamaModels,
  type SettingsApi,
} from '../src/settings-bridge';
import {
  UPDATES_CHECK_CHANNEL,
  UPDATES_INSTALL_CHANNEL,
  UPDATES_STATUS_CHANNEL,
  UPDATES_VERSION_CHANNEL,
  type UpdateStatus,
  type UpdatesApi,
} from '../src/updates-bridge';

/**
 * Preload (build-plan T6.1 / Track A text-ask + T6.3 settings + T10.1 PTT mapping). Exposes three
 * read-only/advisory bridges via `contextBridge`: `window.engineer` (subscribe to snapshots, ask a text
 * question, open the OS mic-settings page), `window.settings` (config CRUD + BYO-key management),
 * `window.ptt` (map the push-to-talk wheel button), and `window.audioOut` (play the engineer's voice
 * clips + report completion — T10.1 audio-out bridge). None can send anything toward the game (CLAUDE.md
 * rule 5) — `audioOut` carries the engineer's own audio out + an ended ack. `contextIsolation` keeps
 * Node out of the renderer.
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
  toggleOverlay(): Promise<boolean> {
    return ipcRenderer.invoke(OVERLAY_TOGGLE_CHANNEL) as Promise<boolean>;
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
  listOllamaModels: () => ipcRenderer.invoke(OLLAMA_MODELS_CHANNEL) as Promise<OllamaModels>,
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
  onLivePtt(listener: (down: boolean) => void): () => void {
    const handler = (_event: IpcRendererEvent, down: boolean): void => listener(down);
    ipcRenderer.on(PTT_LIVE_CHANNEL, handler);
    return () => ipcRenderer.removeListener(PTT_LIVE_CHANNEL, handler);
  },
};

// Audio-out bridge (T10.1): the worker's voice queue drives playback here; we play the clips and ack
// completion so the queue drains. Output-only — no data flows toward the game.
const audioOut: AudioOutApi = {
  onCommand(listener: (msg: AudioOutMessage) => void): () => void {
    const handler = (_event: IpcRendererEvent, msg: AudioOutMessage): void => listener(msg);
    ipcRenderer.on(AUDIO_OUT_CHANNEL, handler);
    return () => ipcRenderer.removeListener(AUDIO_OUT_CHANNEL, handler);
  },
  ended(pid: number): void {
    ipcRenderer.send(AUDIO_ENDED_CHANNEL, pid);
  },
};

// Mic-in bridge (T10.1 slice 2): push-to-talk edges + captured mic frames to the worker's STT.
// Input-only — the driver's radio audio in; no data flows toward the game.
const radioIn: RadioInApi = {
  ptt(down: boolean): void {
    ipcRenderer.send(RADIO_PTT_CHANNEL, down);
  },
  frame(bytes: Uint8Array): void {
    ipcRenderer.send(RADIO_FRAME_CHANNEL, bytes);
  },
  onLog(listener: (msg: RadioLogMessage) => void): () => void {
    const handler = (_event: IpcRendererEvent, msg: RadioLogMessage): void => listener(msg);
    ipcRenderer.on(RADIO_LOG_CHANNEL, handler);
    return () => ipcRenderer.removeListener(RADIO_LOG_CHANNEL, handler);
  },
};

// In-app auto-update (docs/16 §4): version for the footer, manual check, install-on-restart, and a
// status stream. The check/install run in main (electron-updater); this is just the thin bridge.
const updates: UpdatesApi = {
  getVersion: () => ipcRenderer.invoke(UPDATES_VERSION_CHANNEL) as Promise<string>,
  check: () => ipcRenderer.send(UPDATES_CHECK_CHANNEL),
  install: () => ipcRenderer.send(UPDATES_INSTALL_CHANNEL),
  onStatus(listener: (status: UpdateStatus) => void): () => void {
    const handler = (_event: IpcRendererEvent, status: UpdateStatus): void => listener(status);
    ipcRenderer.on(UPDATES_STATUS_CHANNEL, handler);
    return () => ipcRenderer.removeListener(UPDATES_STATUS_CHANNEL, handler);
  },
};

contextBridge.exposeInMainWorld('engineer', bridge);
contextBridge.exposeInMainWorld('settings', settings);
contextBridge.exposeInMainWorld('ptt', ptt);
contextBridge.exposeInMainWorld('audioOut', audioOut);
contextBridge.exposeInMainWorld('radioIn', radioIn);
contextBridge.exposeInMainWorld('updates', updates);
