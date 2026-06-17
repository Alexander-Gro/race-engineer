import { describe, expect, it } from 'vitest';
import { FakeTtsProvider } from '../providers/fake-tts';

describe('FakeTtsProvider', () => {
  it('streams one chunk per word', async () => {
    const chunks = [];
    for await (const chunk of new FakeTtsProvider().synthesizeStream('box this lap', 'v1')) {
      chunks.push(chunk);
    }
    expect(chunks).toHaveLength(3);
    expect(chunks.map((c) => c.seq)).toEqual([0, 1, 2]);
    expect(new TextDecoder().decode(chunks[0]?.data)).toBe('box');
  });
});
