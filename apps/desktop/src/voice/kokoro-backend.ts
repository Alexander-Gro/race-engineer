import { pcmToWav, ProviderNotReadyError } from '@race-engineer/voice';
import type {
  AudioChunk,
  LocalTtsBackend,
  LocalTtsConfig,
  VoiceDelivery,
  VoiceId,
} from '@race-engineer/voice';

/**
 * **Kokoro** local-TTS native backend (docs/07, docs/15 free profile) — the higher-quality, more
 * natural sibling of Piper. Fills the `LocalTtsBackend` seam the `kokoroTts` shell left open, but
 * unlike Piper (a spawned binary + `.onnx` path) Kokoro runs **in-process via `kokoro-js`** (ONNX
 * Runtime under the hood), which **self-downloads** the ~80 MB Kokoro-82M model on first use and
 * caches it — so there's no binary/model path to configure (docs/16 §S7 download-on-first-use).
 *
 * It yields the synthesized audio **WAV-wrapped as one {@link AudioChunk}** (same reason as Piper: the
 * renderer plays clips through an `<audio>` element, which decodes by container — raw PCM is silent).
 *
 * `kokoro-js` is an **optional** dependency, lazily loaded so it never weighs down the default build or
 * the installer; the synthesis is **injected** so the float-PCM → WAV logic is unit-tested with a fake
 * (no model download, no ONNX). Install it (`pnpm --filter @race-engineer/desktop add kokoro-js`) to
 * enable the real voice; without it the backend throws a clear {@link ProviderNotReadyError}. Runs only
 * in the Node worker — never the renderer. Read-only/advisory: it only produces audio bytes.
 */

/** Raw mono audio from a Kokoro synth: float samples in [-1, 1] + their sample rate. */
export interface KokoroAudio {
  samples: Float32Array;
  sampleRate: number;
}

/** The Kokoro synthesis seam — text → audio. Injected in tests; the default loads `kokoro-js`. */
export type KokoroSynth = (
  text: string,
  voice: VoiceId,
  config: LocalTtsConfig,
  delivery?: VoiceDelivery,
) => Promise<KokoroAudio>;

/** Kokoro-82M emits 24 kHz mono. */
const DEFAULT_SAMPLE_RATE = 24000;
/** The default model (a quantized ONNX build hosted for `kokoro-js`); override via `LocalTtsConfig.modelPath`. */
const DEFAULT_MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';
/** A sensible default Kokoro voice; override via `LocalTtsConfig.voice`. */
const DEFAULT_VOICE = 'af_heart';

/** Float samples in [-1, 1] → little-endian 16-bit PCM bytes (what {@link pcmToWav} wraps). */
export const floatToPcm16 = (samples: Float32Array): Uint8Array => {
  const out = new Uint8Array(samples.length * 2);
  const view = new DataView(out.buffer);
  for (let i = 0; i < samples.length; i += 1) {
    const s = Math.max(-1, Math.min(1, samples[i] ?? 0));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return out;
};

/**
 * The production synth: lazily load `kokoro-js`, build the model once (cached across calls), and
 * generate. A variable module specifier keeps it an **optional** dep — not statically resolved or
 * bundled; a missing install surfaces as a clear {@link ProviderNotReadyError}.
 */
export const defaultKokoroSynth = (): KokoroSynth => {
  let modelP: Promise<{
    generate: (text: string, o: { voice: string }) => Promise<unknown>;
  }> | null = null;
  const pick = (...vs: (string | undefined)[]): string =>
    vs.find((v) => v && v !== 'default') ?? DEFAULT_VOICE;
  return async (text, voice, config) => {
    if (!modelP) {
      const moduleName = 'kokoro-js';
      const mod = await import(moduleName).catch(() => {
        throw new ProviderNotReadyError(
          'kokoro',
          'Kokoro needs the optional "kokoro-js" package — run: pnpm --filter @race-engineer/desktop add kokoro-js',
        );
      });
      const KokoroTTS = (
        mod as { KokoroTTS: { from_pretrained: (id: string, o: object) => Promise<unknown> } }
      ).KokoroTTS;
      modelP = KokoroTTS.from_pretrained(config.modelPath || DEFAULT_MODEL, {
        dtype: 'q8',
      }) as Promise<{ generate: (text: string, o: { voice: string }) => Promise<unknown> }>;
    }
    const model = await modelP;
    const result = (await model.generate(text, {
      voice: pick(voice, config.voice), // per-call voice wins, then the config default, then DEFAULT_VOICE
    })) as { audio?: Float32Array; sampling_rate?: number };
    return {
      samples: result.audio ?? new Float32Array(0),
      sampleRate: result.sampling_rate ?? DEFAULT_SAMPLE_RATE,
    };
  };
};

export interface KokoroBackendOptions {
  /** The synthesis fn; defaults to the lazy `kokoro-js` loader. Injected as a fake in tests. */
  synth?: KokoroSynth;
}

/** Build the Kokoro {@link LocalTtsBackend}; pass `synth` to inject a fake (tests). */
export const kokoroTtsBackend = (opts: KokoroBackendOptions = {}): LocalTtsBackend => {
  const synth = opts.synth ?? defaultKokoroSynth();
  return async function* kokoro(
    text: string,
    voice: VoiceId,
    config: LocalTtsConfig,
    delivery?: VoiceDelivery,
  ): AsyncIterable<AudioChunk> {
    const { samples, sampleRate } = await synth(text, voice, config, delivery);
    const wav = pcmToWav(floatToPcm16(samples), { sampleRate });
    yield { seq: 0, data: wav };
  };
};
