/**
 * Microphone permission + audio-output plumbing for the desktop shell (build-plan T4.5, docs/16 §1).
 *
 * The browser/Electron audio APIs (`getUserMedia`, `enumerateDevices`, `devicechange`, `setSinkId`)
 * live only in the **renderer**. Rather than depend on the DOM lib here, this module is written over
 * small **injected ports** (structural subsets of those APIs), so the logic is unit-testable in Node
 * with mocks while the renderer passes the real `navigator.mediaDevices` / an `<audio>` element (which
 * structurally satisfy the ports). Opening the Windows settings deep-link is a *main*-process `shell`
 * action, reached over IPC ({@link EngineerBridge.openMicSettings}).
 *
 * Read-only/advisory: this only reads the mic and routes the engineer's own audio output. There is no
 * path to the game (CLAUDE.md rule 5). Mic denial is handled gracefully — the text-ask box is the
 * always-available no-mic fallback (docs/16 §1).
 */

/** Windows deep-link to the per-app microphone privacy page (docs/16 §1). */
export const MIC_SETTINGS_DEEPLINK = 'ms-settings:privacy-microphone';

// --- Injected ports (structural subsets of the real browser APIs) --------------------------------

export interface MicTrackLike {
  stop(): void;
}
export interface MediaStreamLike {
  getTracks(): MicTrackLike[];
}
export interface MediaDeviceInfoLike {
  readonly deviceId: string;
  readonly kind: string;
  readonly label: string;
}
export interface MediaDevicesLike {
  getUserMedia(constraints: { audio: boolean }): Promise<MediaStreamLike>;
  enumerateDevices(): Promise<MediaDeviceInfoLike[]>;
  addEventListener(type: 'devicechange', listener: () => void): void;
  removeEventListener(type: 'devicechange', listener: () => void): void;
}
/** An output element we can route to a specific device (`HTMLMediaElement.setSinkId`). */
export interface AudioOutputElement {
  setSinkId?(deviceId: string): Promise<void>;
}

// --- Microphone access -----------------------------------------------------------------------------

export type MicDenialReason = 'denied' | 'no-device' | 'in-use' | 'unsupported' | 'error';

export type MicAccess =
  | { ok: true; stream: MediaStreamLike }
  | { ok: false; reason: MicDenialReason; message: string; canOpenSettings: boolean };

/**
 * Request mic capture, mapping every failure to clear guidance instead of throwing (docs/16 §1 —
 * "never crash or silently fail; the radio is the core feature"). On a permission denial the caller
 * should surface the message + an "open settings" affordance ({@link MIC_SETTINGS_DEEPLINK}); on any
 * failure the driver can still use the text-ask box.
 */
export const requestMicAccess = async (
  mediaDevices: MediaDevicesLike | undefined,
): Promise<MicAccess> => {
  if (!mediaDevices || typeof mediaDevices.getUserMedia !== 'function') {
    return {
      ok: false,
      reason: 'unsupported',
      message: 'Microphone capture is not available here. You can still type to the engineer.',
      canOpenSettings: false,
    };
  }
  try {
    const stream = await mediaDevices.getUserMedia({ audio: true });
    return { ok: true, stream };
  } catch (err) {
    const name = (err as { name?: string } | null)?.name ?? '';
    switch (name) {
      case 'NotAllowedError':
      case 'SecurityError':
        return {
          ok: false,
          reason: 'denied',
          message:
            'Microphone access is blocked. Turn it on in Windows Settings → Privacy → Microphone, then try again.',
          canOpenSettings: true,
        };
      case 'NotFoundError':
      case 'OverconstrainedError':
        return {
          ok: false,
          reason: 'no-device',
          message: 'No microphone found. Plug one in, or just type to the engineer.',
          canOpenSettings: false,
        };
      case 'NotReadableError':
      case 'AbortError':
        return {
          ok: false,
          reason: 'in-use',
          message: 'The microphone is busy in another app. Close it and try again.',
          canOpenSettings: false,
        };
      default:
        return {
          ok: false,
          reason: 'error',
          message: 'Could not reach the microphone. You can still type to the engineer.',
          canOpenSettings: false,
        };
    }
  }
};

/** Stop every track on a granted stream (release the mic — capture is push-to-talk gated). */
export const releaseStream = (stream: MediaStreamLike): void => {
  for (const track of stream.getTracks()) track.stop();
};

// --- Output device selection -----------------------------------------------------------------------

export interface AudioOutputDevice {
  deviceId: string;
  label: string;
  isDefault: boolean;
}

/**
 * Enumerate audio-output devices for the engineer-voice device picker (docs/16 §1). Labels are blank
 * until mic permission is granted (a browser privacy rule), so fall back to a readable placeholder.
 */
export const listOutputDevices = async (
  mediaDevices: MediaDevicesLike,
): Promise<AudioOutputDevice[]> => {
  const devices = await mediaDevices.enumerateDevices();
  return devices
    .filter((d) => d.kind === 'audiooutput')
    .map((d) => ({
      deviceId: d.deviceId,
      label: d.label || (d.deviceId === 'default' ? 'System default' : 'Output device'),
      isDefault: d.deviceId === 'default',
    }));
};

/**
 * Subscribe to device hot-plug / default-change (docs/16 §1: "handle hot-plug and default-device
 * changes without crashing"). Returns an unsubscribe function.
 */
export const watchDeviceChanges = (
  mediaDevices: MediaDevicesLike,
  onChange: () => void,
): (() => void) => {
  mediaDevices.addEventListener('devicechange', onChange);
  return () => mediaDevices.removeEventListener('devicechange', onChange);
};

export type OutputRouteResult =
  | { ok: true }
  | { ok: false; reason: 'unsupported' | 'error'; message: string };

/**
 * Route the engineer voice to a chosen output device via `setSinkId` (docs/16 §1: a headset separate
 * from game audio). Degrades gracefully where `setSinkId` is unavailable rather than throwing.
 */
export const applyOutputDevice = async (
  audio: AudioOutputElement,
  deviceId: string,
): Promise<OutputRouteResult> => {
  if (typeof audio.setSinkId !== 'function') {
    return {
      ok: false,
      reason: 'unsupported',
      message: 'This device cannot route audio to a specific output.',
    };
  }
  try {
    await audio.setSinkId(deviceId);
    return { ok: true };
  } catch {
    return { ok: false, reason: 'error', message: 'Could not switch to that output device.' };
  }
};
