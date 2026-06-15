import type { SecretSlot } from './settings';

/**
 * Secure-secret storage contract (build-plan T6.3, docs/15 + CLAUDE.md rule 6). Cloud API keys are
 * **bring-your-own**, stored **only** in OS secure storage (Electron `safeStorage` → Windows DPAPI),
 * never in the repo, never in the settings JSON, never in logs. The production impl is
 * `SafeStorageSecretStore` (Electron main); tests use {@link InMemorySecretStore}.
 *
 * The plaintext value is reachable through {@link SecretStore.getKey} **only on the main/worker side**
 * (to call the provider with the user's key) — it is deliberately *not* exposed over the renderer
 * bridge, which gets only {@link SecretStore.hasKey}/{@link SecretStore.listSetKeys} (no value ever
 * crosses back to the UI). Read-only/advisory — keys configure providers, never the game.
 */
export interface SecretStore {
  /** Store (or replace) the key for a slot. */
  setKey(slot: SecretSlot, value: string): void;
  /** Read the plaintext key (main/worker only — never expose this over the renderer bridge). */
  getKey(slot: SecretSlot): string | null;
  /** Whether a slot has a key — safe to surface in the UI (reveals nothing). */
  hasKey(slot: SecretSlot): boolean;
  /** Remove a key; returns whether one was present. */
  deleteKey(slot: SecretSlot): boolean;
  /** The slots that currently have a key (names only, never values). */
  listSetKeys(): SecretSlot[];
}

/** In-memory {@link SecretStore} for tests. Values live only in this process, never serialized. */
export class InMemorySecretStore implements SecretStore {
  readonly #keys = new Map<SecretSlot, string>();

  setKey(slot: SecretSlot, value: string): void {
    const trimmed = value.trim();
    if (trimmed === '') {
      this.#keys.delete(slot); // an empty value clears, rather than storing a useless blank
      return;
    }
    this.#keys.set(slot, trimmed);
  }

  getKey(slot: SecretSlot): string | null {
    return this.#keys.get(slot) ?? null;
  }

  hasKey(slot: SecretSlot): boolean {
    return this.#keys.has(slot);
  }

  deleteKey(slot: SecretSlot): boolean {
    return this.#keys.delete(slot);
  }

  listSetKeys(): SecretSlot[] {
    return [...this.#keys.keys()];
  }
}
