/// <reference lib="dom" />
/**
 * **F1-broadcast radio overlay** for the engineer's voice (the "team radio" sound you hear on a TV
 * feed). The synthesized reply/call-out is run through a Web Audio chain that band-limits it like a
 * comms link, adds a touch of codec grit and heavy compression, lays a faint static bed under it, and
 * brackets the transmission with a short "roger beep" — so the engineer sounds like he's keying a
 * race radio, not a desktop TTS.
 *
 * Grounded in how real team-radio audio is shaped (a low-bitrate comms link, ~350–4000 Hz band, hard
 * compression, a courtesy tone): bandpass + waveshaper + dynamics-compressor + a ~110 ms 1.5 kHz beep.
 *
 * Split for testability: the **pure** bits (the distortion curve, dB→gain, the parameter set) are
 * unit-tested in Node; the actual `AudioContext` graph builder is thin and runs only in the renderer
 * (no `AudioContext` in Node — same reason the rest of the renderer audio path isn't unit-tested).
 * Output-only; nothing here touches the game (CLAUDE.md rule 5).
 */

export interface RadioFxParams {
  /** Bandpass low edge — rolls off the boom below a comms link. */
  highpassHz: number;
  /** Bandpass high edge — rolls off the air above a comms link. */
  lowpassHz: number;
  /** Waveshaper drive (0 = clean). Subtle: codec grit, not a fuzz pedal. */
  distortionAmount: number;
  /** Hard-ish compression so the voice sits flat and present, like keyed radio. */
  compressor: {
    thresholdDb: number;
    kneeDb: number;
    ratio: number;
    attackS: number;
    releaseS: number;
  };
  /** Make-up gain after compression, in dB. */
  makeupGainDb: number;
  /** Level of the faint static/hiss bed under the voice (0..1, very low). */
  staticGain: number;
  /** The "roger" courtesy tone that opens the transmission. */
  beep: { freqHz: number; durationMs: number; gain: number };
}

/** Default overlay — tuned to read as F1 team radio without burying the words. */
export const RADIO_FX_DEFAULTS: RadioFxParams = {
  highpassHz: 350,
  lowpassHz: 3500,
  distortionAmount: 18,
  compressor: { thresholdDb: -28, kneeDb: 12, ratio: 6, attackS: 0.003, releaseS: 0.12 },
  makeupGainDb: 6,
  staticGain: 0.012,
  beep: { freqHz: 1500, durationMs: 110, gain: 0.1 },
};

/** Decibels → linear gain. */
export const dbToGain = (db: number): number => Math.pow(10, db / 20);

/**
 * Classic waveshaper distortion curve (odd-symmetric `f(-x) = -f(x)`), sampled to `[-1, 1]`. `amount`
 * sets the drive — 0 is nearly linear, higher is grittier. Pure: no DOM, fully unit-testable.
 */
export const makeDistortionCurve = (amount: number, samples = 2048): Float32Array<ArrayBuffer> => {
  const k = Math.max(0, amount);
  const n = Math.max(2, Math.floor(samples));
  const curve = new Float32Array(n);
  const deg = Math.PI / 180;
  for (let i = 0; i < n; i += 1) {
    const x = (i * 2) / (n - 1) - 1; // -1 .. 1
    curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x));
  }
  return curve;
};

// --- Renderer-only graph (needs a real AudioContext) ---------------------------------

/**
 * A built radio chain: connect a source to `input`, and `output` to the context destination. The
 * voice flows source → bandpass → distortion → compressor → make-up gain → output.
 */
export interface RadioChain {
  input: AudioNode;
  output: AudioNode;
}

/** Build the voice-shaping chain on `ctx` (renderer only). Pure wiring — no source attached yet. */
export const buildRadioChain = (
  ctx: AudioContext,
  params: RadioFxParams = RADIO_FX_DEFAULTS,
): RadioChain => {
  const highpass = ctx.createBiquadFilter();
  highpass.type = 'highpass';
  highpass.frequency.value = params.highpassHz;

  const lowpass = ctx.createBiquadFilter();
  lowpass.type = 'lowpass';
  lowpass.frequency.value = params.lowpassHz;

  const shaper = ctx.createWaveShaper();
  shaper.curve = makeDistortionCurve(params.distortionAmount);
  shaper.oversample = '2x';

  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = params.compressor.thresholdDb;
  comp.knee.value = params.compressor.kneeDb;
  comp.ratio.value = params.compressor.ratio;
  comp.attack.value = params.compressor.attackS;
  comp.release.value = params.compressor.releaseS;

  const makeup = ctx.createGain();
  makeup.gain.value = dbToGain(params.makeupGainDb);

  highpass.connect(lowpass);
  lowpass.connect(shaper);
  shaper.connect(comp);
  comp.connect(makeup);
  return { input: highpass, output: makeup };
};

/** A short noise buffer for the static bed / squelch tick (renderer only). */
export const makeNoiseBuffer = (ctx: AudioContext, seconds = 1): AudioBuffer => {
  const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
  return buffer;
};

/**
 * Open the transmission: a short "roger" beep plus a faint static tick on `dest` (renderer only).
 * Scheduled relative to `ctx.currentTime`. Self-cleaning (nodes stop themselves).
 */
export const playRogerBeep = (
  ctx: AudioContext,
  dest: AudioNode,
  noise: AudioBuffer,
  params: RadioFxParams = RADIO_FX_DEFAULTS,
): void => {
  const t0 = ctx.currentTime;
  const dur = params.beep.durationMs / 1000;

  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = params.beep.freqHz;
  const beepGain = ctx.createGain();
  // Quick fade in/out so it clicks like a courtesy tone, not a pop.
  beepGain.gain.setValueAtTime(0, t0);
  beepGain.gain.linearRampToValueAtTime(params.beep.gain, t0 + 0.01);
  beepGain.gain.setValueAtTime(params.beep.gain, t0 + dur - 0.02);
  beepGain.gain.linearRampToValueAtTime(0, t0 + dur);
  osc.connect(beepGain);
  beepGain.connect(dest);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);

  // A brief static tick under the beep (squelch open).
  const tick = ctx.createBufferSource();
  tick.buffer = noise;
  const tickGain = ctx.createGain();
  tickGain.gain.setValueAtTime(params.staticGain * 6, t0);
  tickGain.gain.linearRampToValueAtTime(0, t0 + dur);
  tick.connect(tickGain);
  tickGain.connect(dest);
  tick.start(t0);
  tick.stop(t0 + dur + 0.02);
};

/**
 * A short "mic key" click — the press/release tick of keying a radio (renderer only). `open=true` is
 * the brighter key-up (driver opens the mic); `open=false` is the softer key-down on release. A tiny
 * bandpassed noise burst, so PTT feels like a real transmitter. Self-cleaning.
 */
export const playKeyClick = (
  ctx: AudioContext,
  dest: AudioNode,
  noise: AudioBuffer,
  open: boolean,
): void => {
  const t0 = ctx.currentTime;
  const dur = open ? 0.045 : 0.03;
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = open ? 1800 : 1100;
  band.Q.value = 0.8;
  const gain = ctx.createGain();
  const peak = open ? 0.12 : 0.08;
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(peak, t0 + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(band);
  band.connect(gain);
  gain.connect(dest);
  src.start(t0);
  src.stop(t0 + dur + 0.02);
};

/**
 * Start a faint, looping static bed under the voice (renderer only). Returns a stop function to call
 * when the transmission ends. Keep {@link RadioFxParams.staticGain} low — it sits *under* the words.
 */
export const startStatic = (
  ctx: AudioContext,
  dest: AudioNode,
  noise: AudioBuffer,
  params: RadioFxParams = RADIO_FX_DEFAULTS,
): (() => void) => {
  const src = ctx.createBufferSource();
  src.buffer = noise;
  src.loop = true;
  const gain = ctx.createGain();
  gain.gain.value = params.staticGain;
  src.connect(gain);
  gain.connect(dest);
  src.start();
  return () => {
    try {
      src.stop();
    } catch {
      /* already stopped */
    }
    src.disconnect();
    gain.disconnect();
  };
};
