import type { AudioClip, AudioSink, PlaybackHandle } from '@race-engineer/voice';

/**
 * Renderer↔worker **audio-out bridge** (build-plan T10.1, docs/07 §Audio playback). The tiered
 * {@link VoicePlayer} runs in the Core **worker** (off the UI thread), but a Node utility process has
 * no audio device — actual playback (Web Audio) lives in the **renderer**. This module is the control
 * plane that connects them:
 *
 *  - {@link IpcAudioSink} is the worker-side {@link AudioSink} the `VoicePlayer` drives. Instead of
 *    playing locally it serializes `play`/`stop`/`volume`/`device` to the renderer (over an injected
 *    `post`), assigning each playback a unique **pid** (the clip id is NOT unique — Tier-0 clips are
 *    reused). The queue drains when the renderer reports a clip ended (`handleEnded`).
 *  - {@link createAudioReceiver} is the renderer-side counterpart: it turns those messages back into
 *    calls on a real {@link AudioSink} backend (Web Audio) and posts `ended` back per pid.
 *
 * Both halves are **pure over injected ports**, so the whole transport is unit-tested in Node with no
 * Electron, no DOM, and no audio device. Read-only/advisory: this carries the engineer's own audio
 * **out**; there is no path toward the game (CLAUDE.md rule 5).
 *
 * NOTE: this is the *control plane*. Audio is only audible once a real TTS provider fills
 * {@link AudioClip.audio} with decodable bytes (the next slice — cloud BYO-key is the fastest route on
 * the dev Mac; local Piper/Kokoro is the free default). With the fakes / metadata-only clips the queue
 * still drains (the renderer backend completes by `durationMs`), but plays silence.
 */

/** Electron channel: main → renderer, one queued audio command. */
export const AUDIO_OUT_CHANNEL = 'audio:out';
/** Electron channel: renderer → main (→ worker), a clip finished playing naturally. */
export const AUDIO_ENDED_CHANNEL = 'audio:ended';

/** A single audio command from the worker's queue to the renderer's player. `pid` = playback id. */
export type AudioOutMessage =
  | { kind: 'play'; pid: number; clip: AudioClip; volume: number }
  | { kind: 'stop'; pid: number }
  | { kind: 'volume'; pid: number; volume: number }
  | { kind: 'device'; deviceId: string };

/** Renderer → worker: a clip finished **naturally** (a `stop`/preempt never reports back). */
export interface AudioEndedMessage {
  pid: number;
}

/**
 * The renderer preload bridge (`window.audioOut`) for the audio-out channel: subscribe to queued
 * play/stop commands and report a clip's natural completion back. Output-only — no game path.
 */
export interface AudioOutApi {
  onCommand(listener: (msg: AudioOutMessage) => void): () => void;
  ended(pid: number): void;
}

/**
 * Worker-side {@link AudioSink} that proxies playback to the renderer. `play` returns synchronously
 * with a handle (as the queue expects); natural completion arrives later via {@link handleEnded}.
 */
export class IpcAudioSink implements AudioSink {
  readonly #post: (msg: AudioOutMessage) => void;
  /** pid → the queue's `onEnded` for the in-flight clip (deleted on stop or natural end). */
  readonly #pending = new Map<number, () => void>();
  #nextPid = 0;

  constructor(post: (msg: AudioOutMessage) => void) {
    this.#post = post;
  }

  play(clip: AudioClip, opts: { volume: number; onEnded: () => void }): PlaybackHandle {
    const pid = this.#nextPid++;
    this.#pending.set(pid, opts.onEnded);
    this.#post({ kind: 'play', pid, clip, volume: opts.volume });
    return {
      stop: () => {
        // Drop the pending callback first, so a late `ended` race can't fire onEnded after a stop.
        if (this.#pending.delete(pid)) this.#post({ kind: 'stop', pid });
      },
      setVolume: (v: number) => this.#post({ kind: 'volume', pid, volume: v }),
    };
  }

  setOutputDevice(id: string): void {
    this.#post({ kind: 'device', deviceId: id });
  }

  /** Feed a renderer-reported natural completion back to the queue (call from the IPC listener). */
  handleEnded(pid: number): void {
    const onEnded = this.#pending.get(pid);
    if (onEnded) {
      this.#pending.delete(pid);
      onEnded();
    }
  }
}

/**
 * Build the renderer-side handler for {@link AudioOutMessage}s. Drives the real audio `backend` (an
 * {@link AudioSink} over Web Audio) and posts `ended` back per pid on natural completion. A `stop`
 * (preempt/barge-in) stops playback without reporting back — matching the {@link AudioSink} contract.
 */
export const createAudioReceiver = (
  backend: AudioSink,
  postEnded: (msg: AudioEndedMessage) => void,
): ((msg: AudioOutMessage) => void) => {
  const handles = new Map<number, PlaybackHandle>();
  return (msg: AudioOutMessage): void => {
    switch (msg.kind) {
      case 'play': {
        const { pid } = msg;
        const handle = backend.play(msg.clip, {
          volume: msg.volume,
          onEnded: () => {
            handles.delete(pid);
            postEnded({ pid });
          },
        });
        handles.set(pid, handle);
        break;
      }
      case 'stop': {
        const handle = handles.get(msg.pid);
        if (handle) {
          handles.delete(msg.pid);
          handle.stop();
        }
        break;
      }
      case 'volume':
        handles.get(msg.pid)?.setVolume(msg.volume);
        break;
      case 'device':
        backend.setOutputDevice(msg.deviceId);
        break;
    }
  };
};
