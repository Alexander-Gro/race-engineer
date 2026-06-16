/**
 * Minimal WAV (RIFF/PCM) helpers shared across the voice layer (docs/07). The renderer captures the
 * mic as headerless 16-bit mono PCM and local TTS (Piper) emits headerless PCM — both need a WAV
 * container so a buffered audio sink / `<audio>` element / `whisper-cli` / the cloud transcription
 * endpoint can decode them. Pure byte math, no I/O. Read-only/advisory — audio bytes only, no game path.
 */

/**
 * The push-to-talk mic capture rate. whisper.cpp expects **16 kHz mono**; the renderer's
 * `AudioContext` captures at this rate so no resampling is needed downstream.
 */
export const MIC_SAMPLE_RATE_HZ = 16000;

/**
 * Wrap raw little-endian PCM in a canonical 44-byte WAV header. Defaults to 16-bit mono — the format
 * used for both the mic capture (→ STT) and Piper's TTS output. PCM format (1), little-endian.
 */
export const pcmToWav = (
  pcm: Uint8Array,
  fmt: { sampleRate: number; channels?: number; bitsPerSample?: number },
): Uint8Array => {
  const channels = fmt.channels ?? 1;
  const bitsPerSample = fmt.bitsPerSample ?? 16;
  const blockAlign = channels * (bitsPerSample / 8);
  const byteRate = fmt.sampleRate * blockAlign;
  const buf = new ArrayBuffer(44 + pcm.length);
  const view = new DataView(buf);
  const writeAscii = (offset: number, s: string): void => {
    for (let i = 0; i < s.length; i += 1) view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + pcm.length, true); // file size minus the first 8 bytes
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM fmt-chunk size
  view.setUint16(20, 1, true); // audio format = PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, fmt.sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeAscii(36, 'data');
  view.setUint32(40, pcm.length, true);
  const out = new Uint8Array(buf);
  out.set(pcm, 44);
  return out;
};
