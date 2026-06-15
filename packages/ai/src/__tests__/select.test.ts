import { describe, expect, it } from 'vitest';
import { ClaudeProvider } from '../providers/claude';
import { OllamaProvider } from '../providers/ollama';
import { OpenAiCompatProvider } from '../providers/openai-compat';
import { selectLlmProvider } from '../select';

describe('selectLlmProvider', () => {
  it('returns null for the free template route (caller uses askEngineer)', () => {
    expect(selectLlmProvider({ provider: 'template' })).toBeNull();
  });

  it('builds the local Ollama route with no key', () => {
    expect(selectLlmProvider({ provider: 'ollama' })).toBeInstanceOf(OllamaProvider);
    expect(selectLlmProvider({ provider: 'ollama', model: 'qwen3:8b' })).toBeInstanceOf(
      OllamaProvider,
    );
  });

  it('builds the cloud routes from a BYO-key', () => {
    expect(selectLlmProvider({ provider: 'claude', apiKey: 'sk-x' })).toBeInstanceOf(
      ClaudeProvider,
    );
    for (const provider of ['groq', 'openrouter', 'gemini'] as const) {
      expect(selectLlmProvider({ provider, apiKey: 'k' })).toBeInstanceOf(OpenAiCompatProvider);
    }
  });

  it('throws an actionable error when a cloud route has no key (rather than failing mid-radio)', () => {
    for (const provider of ['claude', 'groq', 'openrouter', 'gemini'] as const) {
      expect(() => selectLlmProvider({ provider })).toThrow(/API key/i);
      expect(() => selectLlmProvider({ provider, apiKey: '   ' })).toThrow(/API key/i); // blank == none
    }
  });
});
