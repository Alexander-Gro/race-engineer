import type { AudioClip, TtsProvider, VoiceId } from './types';

/**
 * Tier-0 pre-render (docs/07 §TTS, docs/01 Tier 0). The fixed spotter/position phrases are
 * synthesized once per voice and cached so they play with near-zero latency and never need a
 * live TTS round-trip. Re-render when the user changes voice. The event→clip routing (M5 T5.4)
 * looks these up by key: the four reflex spotter keys are the Tier-0 `EventType`s in docs/04;
 * `position_up`/`position_down` are extra fixed call-out phrases (see docs/04 §Events note),
 * not event types.
 */
export const TIER0_PHRASES: Record<string, string> = {
  car_left: 'Car left.',
  car_right: 'Car right.',
  three_wide: 'Three wide.',
  clear: 'Clear.',
  position_up: 'Position up.',
  position_down: 'Position down.',
};

/**
 * Synthesize and cache every Tier-0 phrase for `voice`. Returns a key→clip map (keyed by the
 * Tier-0 event name, e.g. `car_left`). Throws if a phrase failed to render, so a caller can
 * verify pre-render integrity (docs/07 §Testing: "every Tier-0 phrase has a cached clip").
 */
export const prerenderTier0 = async (
  provider: TtsProvider,
  voice: VoiceId,
): Promise<Map<string, AudioClip>> => {
  const entries = Object.entries(TIER0_PHRASES);
  const rendered = await provider.prerender(
    entries.map(([, phrase]) => phrase),
    voice,
  );

  const byKey = new Map<string, AudioClip>();
  for (const [key, phrase] of entries) {
    const clip = rendered.get(phrase);
    if (!clip) throw new Error(`Tier-0 pre-render missing a clip for "${key}" ("${phrase}")`);
    byKey.set(key, clip);
  }
  return byKey;
};
