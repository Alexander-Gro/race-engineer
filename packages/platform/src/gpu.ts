/**
 * GPU/VRAM-aware route recommendation (build-plan T4.6, docs/16 §2, docs/15 §GPU contention). The
 * sim already uses the primary GPU, so a local LLM is only viable with real VRAM **headroom beyond
 * the sim**; STT/TTS are light and run on GPU when CUDA is present, else CPU (the always-works
 * fallback). Pure: takes a {@link GpuInfo} snapshot, returns a recommendation — the actual probe is
 * the live half (see {@link import('./ports').GpuProbe}).
 */
export interface GpuInfo {
  hasGpu: boolean;
  /** CUDA (+cuDNN) usable — required for GPU faster-whisper and a local LLM. */
  cuda: boolean;
  vramTotalMb: number | null;
  vramFreeMb: number | null;
  name: string | null;
}

export type Accel = 'gpu' | 'cpu';
/** Brain route (docs/15): local Qwen via Ollama, a free cloud tier, or template mode. */
export type LlmRoute = 'local' | 'cloud-tier' | 'template';

export interface RouteRecommendation {
  llm: LlmRoute;
  stt: Accel;
  tts: Accel;
  reason: string;
}

export interface RouteOptions {
  /** VRAM (MB) to leave for the sim. Default 12000 (docs/15: a modern sim wants 8–12 GB). */
  simReserveMb?: number;
  /** VRAM (MB) a quantized local LLM needs. Default 6000 (docs/15: ~5–6 GB for a quantized 8B). */
  localLlmMb?: number;
}

const gb = (mb: number): string => (mb / 1024).toFixed(0);

/**
 * Recommend CPU-vs-GPU for voice and an LLM route from a VRAM snapshot. Local LLM only when CUDA
 * is present and `vramTotal − simReserve ≥ localLlm`; otherwise the free cloud tier (with template
 * mode as the always-available offline fallback). It **never** recommends starving the sim.
 */
export const recommendRoute = (gpu: GpuInfo, opts: RouteOptions = {}): RouteRecommendation => {
  const simReserveMb = opts.simReserveMb ?? 12000;
  const localLlmMb = opts.localLlmMb ?? 6000;
  const accel: Accel = gpu.hasGpu && gpu.cuda ? 'gpu' : 'cpu';

  if (!gpu.hasGpu || !gpu.cuda) {
    return {
      llm: 'cloud-tier',
      stt: 'cpu',
      tts: 'cpu',
      reason:
        'No CUDA GPU detected — voice runs on CPU; use the free cloud tier for the brain (template mode works fully offline).',
    };
  }

  if (gpu.vramTotalMb !== null && gpu.vramTotalMb - simReserveMb >= localLlmMb) {
    return {
      llm: 'local',
      stt: accel,
      tts: accel,
      reason: `${gb(gpu.vramTotalMb)} GB VRAM leaves headroom beside the sim for a local LLM (Ollama).`,
    };
  }

  const vram = gpu.vramTotalMb === null ? 'unknown' : `${gb(gpu.vramTotalMb)} GB`;
  return {
    llm: 'cloud-tier',
    stt: accel,
    tts: accel,
    reason: `${vram} VRAM isn't enough beside the sim for a local LLM — use the free cloud tier (template mode works fully offline).`,
  };
};
