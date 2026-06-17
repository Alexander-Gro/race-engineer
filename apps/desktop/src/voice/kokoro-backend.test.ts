import { describe, expect, it } from 'vitest';
import { floatToPcm16, kokoroTtsBackend, type KokoroSynth } from './kokoro-backend';

describe('floatToPcm16', () => {
  it('encodes [-1, 0, 1] as little-endian 16-bit PCM with clamping', () => {
    const pcm = floatToPcm16(new Float32Array([0, 1, -1, 2, -2])); // 2/-2 clamp to 1/-1
    const view = new DataView(pcm.buffer);
    expect(pcm).toHaveLength(10); // 5 samples × 2 bytes
    expect(view.getInt16(0, true)).toBe(0);
    expect(view.getInt16(2, true)).toBe(0x7fff); // +1 → max
    expect(view.getInt16(4, true)).toBe(-0x8000); // -1 → min
    expect(view.getInt16(6, true)).toBe(0x7fff); // +2 clamped
    expect(view.getInt16(8, true)).toBe(-0x8000); // -2 clamped
  });
});

describe('kokoroTtsBackend', () => {
  const fakeSynth: KokoroSynth = (text) =>
    Promise.resolve({
      // One sample per character — enough to prove the wrap, no model/ONNX needed.
      samples: new Float32Array(text.length).fill(0.5),
      sampleRate: 24000,
    });

  it('synthesizes one WAV-wrapped chunk from the injected synth', async () => {
    const backend = kokoroTtsBackend({ synth: fakeSynth });
    const chunks = [];
    for await (const c of backend('box box', 'af_heart', {})) chunks.push(c);

    expect(chunks).toHaveLength(1);
    const data = chunks[0]!.data;
    // WAV container so the renderer's <audio> can decode it: starts with the "RIFF" magic.
    expect(new TextDecoder().decode(data.slice(0, 4))).toBe('RIFF');
    expect(new TextDecoder().decode(data.slice(8, 12))).toBe('WAVE');
    expect(data.length).toBeGreaterThan(44); // header + the PCM body
  });

  it('passes the requested voice through to the synth', async () => {
    let seenVoice = '';
    const spy: KokoroSynth = (_t, voice) => {
      seenVoice = voice;
      return Promise.resolve({ samples: new Float32Array([0]), sampleRate: 24000 });
    };
    const backend = kokoroTtsBackend({ synth: spy });
    for await (const _c of backend('hi', 'am_michael', {})) void _c;
    expect(seenVoice).toBe('am_michael');
  });
});
