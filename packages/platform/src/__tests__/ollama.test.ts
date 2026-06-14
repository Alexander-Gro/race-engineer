import { describe, expect, it } from 'vitest';
import type { RouteRecommendation } from '../gpu';
import { detectOllama, ollamaInstallGuide, resolveLlmRoute } from '../ollama';
import type { HttpGetJson } from '../ports';

const okJson = (obj: unknown) => ({ ok: true, status: 200, json: () => Promise.resolve(obj) });

const rec = (llm: RouteRecommendation['llm']): RouteRecommendation => ({
  llm,
  stt: 'cpu',
  tts: 'cpu',
  reason: '',
});

describe('detectOllama', () => {
  it('reports reachable + the installed model tags from /api/tags', async () => {
    let url = '';
    const get: HttpGetJson = (u) => {
      url = u;
      return Promise.resolve(okJson({ models: [{ name: 'qwen3:8b' }, { name: 'llama3.2' }] }));
    };
    const status = await detectOllama(get, 'http://localhost:11434/');
    expect(url).toBe('http://localhost:11434/api/tags'); // trailing slash trimmed
    expect(status).toEqual({
      reachable: true,
      baseUrl: 'http://localhost:11434',
      models: ['qwen3:8b', 'llama3.2'],
    });
  });

  it('reports not-reachable on a non-OK status', async () => {
    const get: HttpGetJson = () =>
      Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) });
    expect(await detectOllama(get)).toMatchObject({ reachable: false, models: [] });
  });

  it('reports not-reachable (never throws) when the daemon is down', async () => {
    const get: HttpGetJson = () => Promise.reject(new Error('ECONNREFUSED'));
    expect(await detectOllama(get)).toMatchObject({ reachable: false, models: [] });
  });
});

describe('resolveLlmRoute', () => {
  it('local recommended + Ollama ready (has a model) → local', () => {
    const resolved = resolveLlmRoute(rec('local'), {
      reachable: true,
      baseUrl: 'http://localhost:11434',
      models: ['qwen3'],
    });
    expect(resolved).toEqual({ route: 'local' });
  });

  it('local recommended but Ollama not ready → cloud-tier + install guide', () => {
    const resolved = resolveLlmRoute(rec('local'), {
      reachable: false,
      baseUrl: 'http://localhost:11434',
      models: [],
    });
    expect(resolved.route).toBe('cloud-tier');
    expect(resolved.guide).toBe(ollamaInstallGuide());
  });

  it('local recommended + Ollama reachable but no model pulled → cloud-tier + guide', () => {
    const resolved = resolveLlmRoute(rec('local'), {
      reachable: true,
      baseUrl: 'http://localhost:11434',
      models: [],
    });
    expect(resolved.route).toBe('cloud-tier');
    expect(resolved.guide).toBeDefined();
  });

  it('a cloud-tier recommendation passes through unchanged (no Ollama needed)', () => {
    expect(
      resolveLlmRoute(rec('cloud-tier'), { reachable: false, baseUrl: '', models: [] }),
    ).toEqual({
      route: 'cloud-tier',
    });
  });
});
