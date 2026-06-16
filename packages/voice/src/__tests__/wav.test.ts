import { describe, expect, it } from 'vitest';
import { MIC_SAMPLE_RATE_HZ, pcmToWav } from '../wav';

describe('pcmToWav', () => {
  it('prepends a 44-byte canonical PCM WAV header with correct sizes + format fields', () => {
    const pcm = new Uint8Array([10, 20, 30, 40]);
    const wav = pcmToWav(pcm, { sampleRate: 22050 });
    const view = new DataView(wav.buffer);
    expect(wav.length).toBe(44 + pcm.length);
    expect(String.fromCharCode(...wav.subarray(0, 4))).toBe('RIFF');
    expect(view.getUint32(4, true)).toBe(36 + pcm.length); // RIFF chunk size
    expect(String.fromCharCode(...wav.subarray(8, 12))).toBe('WAVE');
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(22050); // sample rate
    expect(view.getUint32(28, true)).toBe(22050 * 2); // byte rate = rate * blockAlign(2)
    expect(view.getUint16(32, true)).toBe(2); // block align (16-bit mono)
    expect(view.getUint16(34, true)).toBe(16); // bits per sample
    expect(view.getUint32(40, true)).toBe(pcm.length); // data chunk size
    expect(Array.from(wav.subarray(44))).toEqual([10, 20, 30, 40]); // payload preserved
  });

  it('encodes the requested sample rate (16 kHz mic capture) in the header', () => {
    const wav = pcmToWav(new Uint8Array([1, 2]), { sampleRate: MIC_SAMPLE_RATE_HZ });
    expect(MIC_SAMPLE_RATE_HZ).toBe(16000);
    expect(new DataView(wav.buffer).getUint32(24, true)).toBe(16000);
  });
});
