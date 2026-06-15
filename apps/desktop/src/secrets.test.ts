import { describe, expect, it } from 'vitest';
import { InMemorySecretStore } from './secrets';

describe('InMemorySecretStore', () => {
  it('stores, reads, and reports presence of a key by slot', () => {
    const store = new InMemorySecretStore();
    expect(store.hasKey('anthropic')).toBe(false);
    expect(store.getKey('anthropic')).toBeNull();

    store.setKey('anthropic', 'sk-abc');
    expect(store.hasKey('anthropic')).toBe(true);
    expect(store.getKey('anthropic')).toBe('sk-abc');
  });

  it('trims values and treats a blank value as a clear (no useless empty key)', () => {
    const store = new InMemorySecretStore();
    store.setKey('groq', '  gsk-xyz  ');
    expect(store.getKey('groq')).toBe('gsk-xyz');

    store.setKey('groq', '   ');
    expect(store.hasKey('groq')).toBe(false);
  });

  it('deletes a key and reports whether one was present', () => {
    const store = new InMemorySecretStore();
    store.setKey('gemini', 'g-1');
    expect(store.deleteKey('gemini')).toBe(true);
    expect(store.deleteKey('gemini')).toBe(false);
    expect(store.hasKey('gemini')).toBe(false);
  });

  it('lists set slots by name only — never the values', () => {
    const store = new InMemorySecretStore();
    store.setKey('anthropic', 'sk-secret');
    store.setKey('openrouter', 'or-secret');
    const slots = store.listSetKeys();
    expect(slots.sort()).toEqual(['anthropic', 'openrouter']);
    expect(JSON.stringify(slots)).not.toContain('secret');
  });
});
