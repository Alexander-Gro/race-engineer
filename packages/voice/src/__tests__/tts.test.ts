import { describe, expect, it } from 'vitest';
import { FakeTtsProvider } from '../providers/fake-tts';
import { TIER0_PHRASES, prerenderTier0 } from '../prerender';

describe('FakeTtsProvider', () => {
  it('streams one chunk per word', async () => {
    const chunks = [];
    for await (const chunk of new FakeTtsProvider().synthesizeStream('car left now', 'v1')) {
      chunks.push(chunk);
    }
    expect(chunks).toHaveLength(3);
    expect(chunks.map((c) => c.seq)).toEqual([0, 1, 2]);
    expect(new TextDecoder().decode(chunks[0]?.data)).toBe('car');
  });
});

describe('prerenderTier0', () => {
  it('produces a cached clip for every Tier-0 phrase (pre-render integrity)', async () => {
    const clips = await prerenderTier0(new FakeTtsProvider(), 'engineer-1');
    for (const key of Object.keys(TIER0_PHRASES)) {
      expect(clips.get(key), `missing clip for ${key}`).toBeDefined();
    }
    expect(clips.get('car_left')?.label).toBe('Car left.');
    expect(clips.size).toBe(Object.keys(TIER0_PHRASES).length);
  });

  it('throws if a phrase failed to render', async () => {
    const broken = {
      name: 'broken',
      synthesizeStream: new FakeTtsProvider().synthesizeStream,
      prerender: () => Promise.resolve(new Map()), // renders nothing
    };
    await expect(prerenderTier0(broken, 'v1')).rejects.toThrow(/missing a clip/);
  });
});
