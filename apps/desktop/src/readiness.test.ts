import { describe, expect, it } from 'vitest';
import { buildReadinessReport, type ReadinessInput } from './readiness';
import { DEFAULT_SETTINGS, type AppSettings } from './settings';

const input = (over: Partial<ReadinessInput> = {}): ReadinessInput => ({
  settings: DEFAULT_SETTINGS,
  ...over,
});

const byId = (r: ReturnType<typeof buildReadinessReport>, id: string) =>
  r.checks.find((c) => c.id === id)!;

describe('buildReadinessReport', () => {
  it('the free default profile is fully ready except first-run mic/PTT prompts', () => {
    const r = buildReadinessReport(input({ capabilities: { source: 'synthetic' } }));
    expect(byId(r, 'profile').status).toBe('ready');
    expect(byId(r, 'llm').status).toBe('ready'); // template
    expect(byId(r, 'tts').status).toBe('ready'); // kokoro (local)
    expect(byId(r, 'stt').status).toBe('ready'); // faster-whisper (local)
    expect(byId(r, 'source').status).toBe('ready'); // synthetic
    // No hard blockers in the free default; mic/PTT are first-run "attention" nudges.
    expect(r.blockers).toEqual([]);
    expect(byId(r, 'mic').status).toBe('attention'); // permission unknown by default
    expect(byId(r, 'ptt').status).toBe('attention'); // unmapped by default
    expect(r.overall).toBe('attention');
  });

  it('blocks a cloud LLM route with no key, and names the fix', () => {
    const settings: AppSettings = { ...DEFAULT_SETTINGS, llm: { provider: 'claude' } };
    const r = buildReadinessReport(input({ settings, capabilities: { source: 'synthetic' } }));
    const llm = byId(r, 'llm');
    expect(llm.status).toBe('blocked');
    expect(llm.action).toMatch(/claude API key/i);
    expect(r.blockers.map((c) => c.id)).toContain('llm');
    expect(r.overall).toBe('blocked');
  });

  it('clears the cloud LLM block once the key is present', () => {
    const settings: AppSettings = { ...DEFAULT_SETTINGS, llm: { provider: 'claude' } };
    const r = buildReadinessReport(input({ settings, secretsPresent: { anthropic: true } }));
    expect(byId(r, 'llm').status).toBe('ready');
  });

  it('blocks a cloud voice engine (openai) without the OpenAI key', () => {
    const settings: AppSettings = {
      ...DEFAULT_SETTINGS,
      voice: { tts: 'openai', stt: 'openai' },
    };
    const r = buildReadinessReport(input({ settings }));
    expect(byId(r, 'tts').status).toBe('blocked');
    expect(byId(r, 'stt').status).toBe('blocked');
    const withKey = buildReadinessReport(input({ settings, secretsPresent: { openai: true } }));
    expect(byId(withKey, 'tts').status).toBe('ready');
    expect(byId(withKey, 'stt').status).toBe('ready');
  });

  it('flags an unreachable Ollama route as attention (not blocked — template still works)', () => {
    const settings: AppSettings = { ...DEFAULT_SETTINGS, llm: { provider: 'ollama' } };
    const down = buildReadinessReport(
      input({ settings, capabilities: { ollamaAvailable: false } }),
    );
    expect(byId(down, 'llm').status).toBe('attention');
    const up = buildReadinessReport(input({ settings, capabilities: { ollamaAvailable: true } }));
    expect(byId(up, 'llm').status).toBe('ready');
  });

  it('maps microphone permission states', () => {
    expect(
      byId(buildReadinessReport(input({ capabilities: { micPermission: 'granted' } })), 'mic')
        .status,
    ).toBe('ready');
    expect(
      byId(buildReadinessReport(input({ capabilities: { micPermission: 'denied' } })), 'mic')
        .status,
    ).toBe('blocked');
  });

  it('nudges to start LMU when the live source has no telemetry yet', () => {
    const lmu = buildReadinessReport(
      input({ capabilities: { source: 'lmu', sourceAvailable: false } }),
    );
    expect(byId(lmu, 'source').status).toBe('attention');
    expect(byId(lmu, 'source').action).toMatch(/Le Mans Ultimate/);
    const live = buildReadinessReport(
      input({ capabilities: { source: 'lmu', sourceAvailable: true } }),
    );
    expect(byId(live, 'source').status).toBe('ready');
  });

  it('flags a missing audio output device', () => {
    const r = buildReadinessReport(input({ capabilities: { outputDeviceCount: 0 } }));
    expect(byId(r, 'output').status).toBe('attention');
  });

  it('every ready check has no action; every non-ready check has an action', () => {
    const r = buildReadinessReport(
      input({
        settings: { ...DEFAULT_SETTINGS, llm: { provider: 'claude' } },
        capabilities: { source: 'lmu', sourceAvailable: false, micPermission: 'denied' },
      }),
    );
    for (const c of r.checks) {
      if (c.status === 'ready') expect(c.action).toBeNull();
      else expect(typeof c.action).toBe('string');
    }
  });

  it('overall is the worst status across checks', () => {
    // Everything green-able + a granted mic + mapped PTT + live source → ready.
    const settings: AppSettings = {
      ...DEFAULT_SETTINGS,
      ptt: { deviceGuid: 'g', buttonIndex: 1 },
    };
    const r = buildReadinessReport(
      input({
        settings,
        capabilities: {
          source: 'synthetic',
          micPermission: 'granted',
          outputDeviceCount: 2,
        },
      }),
    );
    expect(r.overall).toBe('ready');
    expect(r.blockers).toEqual([]);
  });
});
