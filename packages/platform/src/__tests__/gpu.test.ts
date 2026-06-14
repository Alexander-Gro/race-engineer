import { describe, expect, it } from 'vitest';
import { recommendRoute, type GpuInfo } from '../gpu';

const gpu = (over: Partial<GpuInfo>): GpuInfo => ({
  hasGpu: true,
  cuda: true,
  vramTotalMb: null,
  vramFreeMb: null,
  name: 'Test GPU',
  ...over,
});

describe('recommendRoute', () => {
  it('no GPU → CPU voice + free cloud tier (the CPU fallback works with no GPU stack)', () => {
    const r = recommendRoute(gpu({ hasGpu: false, cuda: false, name: null }));
    expect(r).toMatchObject({ llm: 'cloud-tier', stt: 'cpu', tts: 'cpu' });
  });

  it('GPU without CUDA → CPU voice + free cloud tier', () => {
    const r = recommendRoute(gpu({ hasGpu: true, cuda: false }));
    expect(r).toMatchObject({ llm: 'cloud-tier', stt: 'cpu', tts: 'cpu' });
  });

  it('big GPU (24 GB) → local LLM, GPU voice (headroom beside the sim)', () => {
    const r = recommendRoute(gpu({ vramTotalMb: 24576 }));
    expect(r).toMatchObject({ llm: 'local', stt: 'gpu', tts: 'gpu' });
    expect(r.reason).toMatch(/24 GB/);
  });

  it('modest GPU (8 GB) → GPU voice but cloud-tier brain (no LLM headroom beside the sim)', () => {
    const r = recommendRoute(gpu({ vramTotalMb: 8192 }));
    expect(r).toMatchObject({ llm: 'cloud-tier', stt: 'gpu', tts: 'gpu' });
  });

  it('unknown VRAM with a CUDA GPU → conservative cloud-tier (never starve the sim)', () => {
    const r = recommendRoute(gpu({ vramTotalMb: null }));
    expect(r.llm).toBe('cloud-tier');
  });

  it('respects custom sim-reserve / local-LLM thresholds', () => {
    // 16 GB total, reserve 8 for the sim, LLM needs 6 → 8 headroom ≥ 6 → local.
    const r = recommendRoute(gpu({ vramTotalMb: 16384 }), { simReserveMb: 8192, localLlmMb: 6144 });
    expect(r.llm).toBe('local');
  });
});
