import type { MicSource } from '@race-engineer/voice';

/**
 * Renderer→worker **mic-in bridge** (build-plan T10.1, voice loop slice 2/3, docs/07 §PTT flow). The
 * STT provider runs in the Core **worker** (so a cloud key never reaches the renderer — CLAUDE.md
 * rule 6), but the microphone is a renderer/browser device (`getUserMedia`). This module is the input
 * counterpart of the audio-out bridge:
 *
 *  - {@link BridgedMicSource} is the worker-side {@link MicSource} that `RadioCapture` feeds from. It's
 *    a pure **frame receiver**: {@link handleFrame} routes a captured frame to the active capture. The
 *    renderer self-gates capture on the push-to-talk hold (it streams frames only while held), so the
 *    worker needs no "start mic" command — capture lifecycle is driven by the **PTT edges**.
 *  - {@link createRadioInput} is the renderer-side coordinator: a PTT-down starts the injected mic
 *    capture (forwarding frames over `postFrame`) and emits the down edge; PTT-up stops capture and
 *    emits the up edge. The down/up edges drive the worker's `RadioCapture.begin`/`end`.
 *
 * Both halves are **pure over injected ports**, unit-tested in Node with no Electron, no DOM, no mic.
 * Read-only/advisory: it only carries the driver's radio audio **in**; there is no path toward the
 * game (rule 5), and capture only runs while PTT is held (privacy-friendly, no wake word — docs/07).
 */

/** Electron channel: renderer → main (→ worker), a PTT edge (true = pressed/down, false = released). */
export const RADIO_PTT_CHANNEL = 'radio:ptt';
/** Electron channel: renderer → main (→ worker), one captured mic audio frame (opaque bytes). */
export const RADIO_FRAME_CHANNEL = 'radio:frame';

/**
 * Worker-side {@link MicSource} fed by renderer frames. `start`/`stop` (called by `RadioCapture` on the
 * PTT edges) gate which frames reach the capture; {@link handleFrame} is wired to the incoming IPC.
 */
export class BridgedMicSource implements MicSource {
  #onFrame: ((frame: Uint8Array) => void) | null = null;

  start(onFrame: (frame: Uint8Array) => void): void {
    this.#onFrame = onFrame;
  }

  stop(): void {
    this.#onFrame = null;
  }

  /** Route a renderer-captured frame to the active capture (dropped when not capturing — PTT gating). */
  handleFrame(frame: Uint8Array): void {
    this.#onFrame?.(frame);
  }
}

/** The renderer's microphone capture (a `getUserMedia` wrapper); injected so the coordinator is pure. */
export interface MicCaptureBackend {
  /** Begin capturing; call `onFrame` for each audio frame until {@link stop}. */
  start(onFrame: (frame: Uint8Array) => void): void;
  stop(): void;
}

export interface RadioInputDeps {
  capture: MicCaptureBackend;
  /** Ship one captured frame to the worker. */
  postFrame: (frame: Uint8Array) => void;
  /** Emit a PTT edge to the worker (drives `RadioCapture.begin`/`end`). */
  postPtt: (down: boolean) => void;
}

export interface RadioInput {
  pttDown(): void;
  pttUp(): void;
}

/**
 * Renderer-side push-to-talk coordinator. Wire a hold-to-talk control's press/release (or a wheel
 * button) to {@link RadioInput.pttDown}/{@link RadioInput.pttUp}: down starts mic capture + emits the
 * down edge; up stops capture + emits the up edge. Idempotent (a repeat down/up while already in that
 * state is ignored), so a key-repeat or a double event can't double-open the mic.
 */
export const createRadioInput = (deps: RadioInputDeps): RadioInput => {
  let held = false;
  return {
    pttDown(): void {
      if (held) return;
      held = true;
      deps.postPtt(true);
      deps.capture.start(deps.postFrame);
    },
    pttUp(): void {
      if (!held) return;
      held = false;
      deps.capture.stop();
      deps.postPtt(false);
    },
  };
};

/** The renderer preload bridge (`window.radioIn`) for the mic-in channel. Input-only — no game path. */
export interface RadioInApi {
  /** Send a PTT edge to the worker. */
  ptt(down: boolean): void;
  /** Send one captured mic frame to the worker. */
  frame(bytes: Uint8Array): void;
}
