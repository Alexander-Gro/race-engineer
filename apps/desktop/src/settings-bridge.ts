import type { AppSettings, SecretSlot } from './settings';

/**
 * The renderer ↔ main IPC contract for settings + secrets (build-plan T6.3). Exposed to the renderer
 * as `window.settings`, separate from the read-only `window.engineer` (Core snapshots) so the
 * config-CRUD surface is clearly distinct. Read-only/advisory toward the game — these only tune the
 * engineer and store the user's own keys.
 *
 * **Secrets never round-trip back to the renderer:** a key's plaintext goes renderer→main exactly
 * once on {@link SettingsApi.setApiKey} and is encrypted into OS secure storage; the renderer can only
 * ever learn *which* slots are set ({@link SettingsApi.listApiKeys}), never a value (docs/15, rule 6).
 */
export interface SettingsApi {
  load(): Promise<AppSettings>;
  save(settings: AppSettings): Promise<AppSettings>;
  /** Store a cloud key for a slot; resolves with the updated set-slot list (names only). */
  setApiKey(slot: SecretSlot, value: string): Promise<SecretSlot[]>;
  /** Remove a key; resolves with the updated set-slot list. */
  deleteApiKey(slot: SecretSlot): Promise<SecretSlot[]>;
  /** Which slots currently have a key (names only — never values). */
  listApiKeys(): Promise<SecretSlot[]>;
}

export const SETTINGS_LOAD_CHANNEL = 'settings:load' as const;
export const SETTINGS_SAVE_CHANNEL = 'settings:save' as const;
export const SECRET_SET_CHANNEL = 'settings:secret-set' as const;
export const SECRET_DELETE_CHANNEL = 'settings:secret-delete' as const;
export const SECRET_LIST_CHANNEL = 'settings:secret-list' as const;
