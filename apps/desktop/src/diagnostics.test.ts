import { describe, expect, it } from 'vitest';
import {
  buildDiagnosticsReport,
  diagnosticsFilename,
  redactSecrets,
  serializeDiagnostics,
  type DiagnosticsInput,
} from './diagnostics';
import { DEFAULT_SETTINGS, SECRET_SLOTS, type AppSettings } from './settings';

const AT = Date.UTC(2026, 5, 16, 3, 42, 0); // fixed, injected — no wall clock

const baseInput = (over: Partial<DiagnosticsInput> = {}): DiagnosticsInput => ({
  appVersion: '0.3.0',
  platform: { os: 'win32', arch: 'x64', osVersion: '10.0.22631' },
  source: 'synthetic',
  settings: DEFAULT_SETTINGS,
  generatedAtMs: AT,
  ...over,
});

describe('buildDiagnosticsReport', () => {
  it('captures app/platform/source and the non-secret config from settings', () => {
    const r = buildDiagnosticsReport(baseInput());
    expect(r.schema).toBe('race-engineer/diagnostics@1');
    expect(r.generatedAt).toBe('2026-06-16T03:42:00.000Z');
    expect(r.appVersion).toBe('0.3.0');
    expect(r.platform.os).toBe('win32');
    expect(r.source).toBe('synthetic');
    expect(r.config.profile).toBe('free');
    expect(r.config.llmProvider).toBe('template');
    expect(r.config.tts).toBe('piper');
    expect(r.config.proactivity).toBe('normal');
  });

  it('reports secret slots as presence booleans only — never a value (rule 6)', () => {
    const r = buildDiagnosticsReport(
      baseInput({ secretsPresent: { anthropic: true, openai: true } }),
    );
    expect(r.secrets.anthropic).toBe(true);
    expect(r.secrets.openai).toBe(true);
    expect(r.secrets.groq).toBe(false); // not configured → false, present in the map
    // Every known slot is represented as a boolean.
    for (const slot of SECRET_SLOTS) expect(typeof r.secrets[slot]).toBe('boolean');
  });

  it('reduces device id + PTT binding to booleans (no raw hardware ids)', () => {
    const settings: AppSettings = {
      ...DEFAULT_SETTINGS,
      outputDeviceId: 'device-abc-123',
      ptt: { deviceGuid: 'GUID-XYZ', buttonIndex: 4 },
    };
    const r = buildDiagnosticsReport(baseInput({ settings }));
    expect(r.config.outputDeviceConfigured).toBe(true);
    expect(r.config.pttMapped).toBe(true);
    const json = serializeDiagnostics(r);
    expect(json).not.toContain('device-abc-123');
    expect(json).not.toContain('GUID-XYZ');
  });

  it('redacts API keys that leaked into recent error messages', () => {
    const r = buildDiagnosticsReport(
      baseInput({
        recentErrors: [
          'Auth failed: Bearer sk-ABCDEF0123456789ABCDEF rejected',
          'config used apiKey="sk-secret-key-value-1234567890"',
          'gemini key AIzaSyD-EXAMPLE_KEY_000000000000000 invalid',
        ],
      }),
    );
    const json = serializeDiagnostics(r);
    expect(json).not.toMatch(/sk-ABCDEF/);
    expect(json).not.toMatch(/sk-secret-key-value/);
    expect(json).not.toMatch(/AIzaSyD-EXAMPLE/);
    expect(r.recentErrors.join(' ')).toContain('[redacted]');
  });

  it('never lets a planted secret value survive into the serialized report', () => {
    const planted = 'sk-PLANTEDsecret9876543210abcdefXYZ';
    const r = buildDiagnosticsReport(
      baseInput({ recentErrors: [`provider error with key ${planted}`] }),
    );
    expect(serializeDiagnostics(r)).not.toContain(planted);
  });

  it('caps the number of recent errors kept (most recent)', () => {
    const errors = Array.from({ length: 50 }, (_, i) => `error ${i}`);
    const r = buildDiagnosticsReport(baseInput({ recentErrors: errors, maxErrors: 10 }));
    expect(r.recentErrors).toHaveLength(10);
    expect(r.recentErrors.at(-1)).toBe('error 49'); // keeps the newest
  });

  it('fills sensible empties for optional fields and never throws', () => {
    const r = buildDiagnosticsReport(baseInput());
    expect(r.runtime).toEqual({});
    expect(r.health).toEqual({});
    expect(r.eventCounts).toEqual({});
    expect(r.recentErrors).toEqual([]);
    expect(Object.values(r.secrets).every((v) => v === false)).toBe(true);
  });

  it('carries health + event counts through verbatim', () => {
    const r = buildDiagnosticsReport(
      baseInput({
        source: 'lmu',
        health: { restAvailable: true, shmAvailable: true, tier2FirstAudioP95Ms: 850 },
        eventCounts: { fuel_low: 2, energy_low: 1, blue_flag: 5 },
      }),
    );
    expect(r.health.tier2FirstAudioP95Ms).toBe(850);
    expect(r.eventCounts).toEqual({ fuel_low: 2, energy_low: 1, blue_flag: 5 });
  });
});

describe('redactSecrets', () => {
  it('leaves ordinary text untouched', () => {
    expect(redactSecrets('Snapshot stalled for 1200 ms; REST unavailable')).toBe(
      'Snapshot stalled for 1200 ms; REST unavailable',
    );
  });
});

describe('diagnosticsFilename', () => {
  it('is filesystem-safe (no colons or dots in the stamp — Windows-safe)', () => {
    const name = diagnosticsFilename(AT);
    expect(name).toBe('race-engineer-diagnostics-2026-06-16T03-42-00-000Z.json');
    expect(name).not.toMatch(/[:]/);
  });
});
