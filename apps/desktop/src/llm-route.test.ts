import { selectLlmProvider } from '@race-engineer/ai';
import { describe, expect, it } from 'vitest';
import { resolveLlmRouteConfig } from './llm-route';
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
