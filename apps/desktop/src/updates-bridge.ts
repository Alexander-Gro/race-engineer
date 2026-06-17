/**
 * Renderer ↔ main IPC contract for **in-app auto-update** (build-plan docs/16 §4). Exposed to the
 * renderer as `window.updates`. Backed by `electron-updater` against the project's GitHub Releases:
 * the app checks the latest published release, downloads it in the background, and installs on restart
 * — so the driver never has to hand-download a new `.exe`. Read-only/advisory toward the game; this
 * only updates the app itself, and only in the **installed** build (no-op in `pnpm dev`).
 */

/** A serializable snapshot of where an update check/download is — sent main → renderer. */
export type UpdateStatus =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'available'; version: string }
  | { kind: 'up-to-date'; version: string }
  | { kind: 'downloading'; percent: number }
  | { kind: 'downloaded'; version: string }
  | { kind: 'error'; message: string }
  | { kind: 'unsupported' }; // dev / not the packaged app — auto-update only runs installed

export interface UpdatesApi {
  /** Current app version (from `app.getVersion()`). */
  getVersion(): Promise<string>;
  /** Check for an update now (also runs once shortly after launch, packaged only). */
  check(): void;
  /** Quit and install an already-downloaded update. */
  install(): void;
  /** Subscribe to status changes; returns an unsubscribe. */
  onStatus(listener: (status: UpdateStatus) => void): () => void;
}

export const UPDATES_VERSION_CHANNEL = 'updates:version' as const;
export const UPDATES_CHECK_CHANNEL = 'updates:check' as const;
export const UPDATES_INSTALL_CHANNEL = 'updates:install' as const;
export const UPDATES_STATUS_CHANNEL = 'updates:status' as const;

/** Pure: the footer text for a status (unit-tested; the renderer just paints this string). */
export const formatUpdateStatus = (status: UpdateStatus): string => {
  switch (status.kind) {
    case 'idle':
      return '';
    case 'checking':
      return 'Checking for updates…';
    case 'available':
      return `Update ${status.version} found — downloading…`;
    case 'up-to-date':
      return "You're on the latest version.";
    case 'downloading':
      return `Downloading update… ${Math.round(status.percent)}%`;
    case 'downloaded':
      return `Update ${status.version} ready — restart to install.`;
    case 'error':
      return `Update check failed: ${status.message}`;
    case 'unsupported':
      return 'Updates run in the installed app.';
  }
};

/** Pure: should the action button offer "restart to install" (vs "check for updates")? */
export const isInstallReady = (status: UpdateStatus): boolean => status.kind === 'downloaded';

/** Pure: should the action button be disabled (a check/download is in flight)? */
export const isUpdateBusy = (status: UpdateStatus): boolean =>
  status.kind === 'checking' || status.kind === 'downloading';
