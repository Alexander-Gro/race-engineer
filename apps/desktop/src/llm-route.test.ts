import { selectLlmProvider } from '@race-engineer/ai';
import { describe, expect, it } from 'vitest';
import { freeRouteWithLocalOllama, resolveLlmRouteConfig } from './llm-route';
import { InMemorySecretStore } from './secrets';

describe('resolveLlmRouteConfig', () => {
  it('needs no key for the free routes', () => {
    const secrets = new InMemorySecretStore();
    expect(resolveLlmRouteConfig({ provider: 'template' }, secrets)).toEqual({
      provider: 'template',
    });
    expect(resolveLlmRouteConfig({ provider: 'ollama' }, secrets)).toEqual({ provider: 'ollama' });
  });

  it('reads the cloud route key from secure storage and passes the model through', () => {
    const secrets = new InMemorySecretStore();
    secrets.setKey('anthropic', 'sk-abc');
    expect(
      resolveLlmRouteConfig({ provider: 'claude', model: 'claude-opus-4-8' }, secrets),
    ).toEqual({ provider: 'claude', apiKey: 'sk-abc', model: 'claude-opus-4-8' });
  });

  it('omits the key when none is stored (selectLlmProvider then reports it clearly)', () => {
    const secrets = new InMemorySecretStore();
    const config = resolveLlmRouteConfig({ provider: 'groq' }, secrets);
    expect(config).toEqual({ provider: 'groq' });
  });

  it('composes with selectLlmProvider end-to-end: keyed → provider, unkeyed cloud → throws', () => {
    const secrets = new InMemorySecretStore();
    secrets.setKey('groq', 'gsk-1');
    expect(selectLlmProvider(resolveLlmRouteConfig({ provider: 'groq' }, secrets))).not.toBeNull();
    expect(selectLlmProvider(resolveLlmRouteConfig({ provider: 'template' }, secrets))).toBeNull();

    const empty = new InMemorySecretStore();
    expect(() => selectLlmProvider(resolveLlmRouteConfig({ provider: 'claude' }, empty))).toThrow(
      /API key/i,
    );
  });
});

describe('freeRouteWithLocalOllama (vision: free = local AI)', () => {
  const template = { provider: 'template' as const };

  it('upgrades the free template route to local Ollama when one is running, preferring Qwen', () => {
    expect(
      freeRouteWithLocalOllama(template, { reachable: true, models: ['llama3.1', 'qwen2.5:7b'] }),
    ).toEqual({ provider: 'ollama', model: 'qwen2.5:7b' });
  });

  it('falls back to the first pulled model when no Qwen is present', () => {
    expect(freeRouteWithLocalOllama(template, { reachable: true, models: ['llama3.1'] })).toEqual({
      provider: 'ollama',
      model: 'llama3.1',
    });
  });

  it('keeps the template route when Ollama is unreachable or has no models (still talks offline)', () => {
    expect(freeRouteWithLocalOllama(template, { reachable: false, models: [] })).toEqual(template);
    expect(freeRouteWithLocalOllama(template, { reachable: true, models: [] })).toEqual(template);
  });

  it('never overrides an explicitly chosen route (user picked Ollama/cloud)', () => {
    const claude = { provider: 'claude' as const, apiKey: 'k' };
    expect(freeRouteWithLocalOllama(claude, { reachable: true, models: ['qwen2.5'] })).toBe(claude);
  });
});
