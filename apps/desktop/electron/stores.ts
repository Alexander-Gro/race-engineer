import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { safeStorage } from 'electron';
import type { SecretStore } from '../src/secrets';
import type { SecretSlot } from '../src/settings';
import type { SettingsStorage } from '../src/settings';

/**
 * Electron/Node-backed persistence for settings + secrets (build-plan T6.3, docs/15 / rule 6) — the
 * **live half** of the otherwise pure, unit-tested `../src/settings` + `../src/secrets`. Lives in
 * `electron/` (Node + Electron types) so the `src/` logic stays platform-free and testable.
 */

/** Plain-JSON settings file (non-secret config only). */
export const fsSettingsStorage = (file: string): SettingsStorage => ({
  read: () => (existsSync(file) ? readFileSync(file, 'utf8') : null),
  write: (json: string) => {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, json, { encoding: 'utf8' });
  },
});

/**
 * Cloud API keys encrypted at rest via Electron `safeStorage` (Windows DPAPI), persisted as a
 * slot→ciphertext map. **Refuses to write plaintext** if OS encryption is unavailable, and never logs
 * a value (docs/15: "secrets live only in the user's OS secure storage, never in logs").
 */
export class SafeStorageSecretStore implements SecretStore {
  readonly #file: string;
  #cache: Record<string, string> | null = null;

  constructor(file: string) {
    this.#file = file;
  }

  #read(): Record<string, string> {
    if (this.#cache) return this.#cache;
    try {
      this.#cache = existsSync(this.#file)
        ? (JSON.parse(readFileSync(this.#file, 'utf8')) as Record<string, string>)
        : {};
    } catch {
      this.#cache = {};
    }
    return this.#cache;
  }

  #write(map: Record<string, string>): void {
    this.#cache = map;
    mkdirSync(dirname(this.#file), { recursive: true });
    writeFileSync(this.#file, JSON.stringify(map), { encoding: 'utf8', mode: 0o600 });
  }

  setKey(slot: SecretSlot, value: string): void {
    const trimmed = value.trim();
    const map = { ...this.#read() };
    if (trimmed === '') {
      delete map[slot];
      this.#write(map);
      return;
    }
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('OS secure storage is unavailable — refusing to store the key in plaintext.');
    }
    map[slot] = safeStorage.encryptString(trimmed).toString('base64');
    this.#write(map);
  }

  getKey(slot: SecretSlot): string | null {
    const enc = this.#read()[slot];
    if (!enc) return null;
    try {
      return safeStorage.decryptString(Buffer.from(enc, 'base64'));
    } catch {
      return null; // unreadable (e.g. moved machine) — treat as unset rather than crashing
    }
  }

  hasKey(slot: SecretSlot): boolean {
    return slot in this.#read();
  }

  deleteKey(slot: SecretSlot): boolean {
    const map = { ...this.#read() };
    const had = slot in map;
    delete map[slot];
    if (had) this.#write(map);
    return had;
  }

  listSetKeys(): SecretSlot[] {
    return Object.keys(this.#read()) as SecretSlot[];
  }
}
