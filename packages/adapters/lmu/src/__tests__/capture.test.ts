import { describe, expect, it } from 'vitest';
import type { RestSnapshot } from '../rest/client';
import { buildCaptureReport, topLevelKeys } from '../capture';

const AT = Date.UTC(2026, 5, 16, 10, 0, 0);

const restSnapshot = (over: Partial<RestSnapshot> = {}): RestSnapshot => ({
  base: 'http://localhost:6397',
  sessions: null,
  vehicles: null,
  weather: null,
  strategyUsage: null,
  garage: null,
  repairRefuel: null,
  ...over,
});

describe('topLevelKeys', () => {
  it('lists top-level keys plus one level of nesting', () => {
    expect(topLevelKeys({ a: 1, b: { c: 2, d: 3 } })).toEqual(['a', 'b', 'b.c', 'b.d']);
  });

  it('returns [] for non-objects and arrays', () => {
    expect(topLevelKeys(null)).toEqual([]);
    expect(topLevelKeys(42)).toEqual([]);
    expect(topLevelKeys([1, 2])).toEqual([]);
  });
});

describe('buildCaptureReport', () => {
  it('records which endpoints responded and their key index', () => {
    const rest = restSnapshot({
      strategyUsage: { virtualEnergy: 84, virtualEnergyPerLap: 5.2 },
      garage: { tractionControl: 4, abs: 3 },
    });
    const report = buildCaptureReport({ rest, svm: null, capturedAtMs: AT });
    expect(report.schema).toBe('race-engineer/lmu-capture@1');
    expect(report.capturedAt).toBe('2026-06-16T10:00:00.000Z');
    expect(report.restBase).toBe('http://localhost:6397');
    expect(report.endpoints.strategyUsage).toEqual({
      responded: true,
      keys: ['virtualEnergy', 'virtualEnergyPerLap'],
    });
    expect(report.endpoints.garage.keys).toEqual(['tractionControl', 'abs']);
    expect(report.endpoints.weather.responded).toBe(false); // null payload
  });

  it('bundles the raw REST payloads verbatim for offline mapping', () => {
    const rest = restSnapshot({ strategyUsage: { foo: 1 } });
    const report = buildCaptureReport({ rest, svm: null, capturedAtMs: AT });
    expect(report.rest.strategyUsage).toEqual({ foo: 1 });
  });

  it('parses a captured .svm into section → key names (+ keeps the raw text)', () => {
    const report = buildCaptureReport({
      rest: restSnapshot(),
      svm: {
        name: 'Q_GT3.svm',
        text: '[FRONTLEFT]\nCamber=12//-3.5\nPressure=8//27.5\n[GENERAL]\nFuel=42\n',
      },
      capturedAtMs: AT,
    });
    expect(report.svm?.name).toBe('Q_GT3.svm');
    expect(report.svm?.sections).toEqual({ FRONTLEFT: ['Camber', 'Pressure'], GENERAL: ['Fuel'] });
    expect(report.svm?.raw).toContain('[FRONTLEFT]');
  });

  it('has null svm and a confirmation checklist when no setup is captured', () => {
    const report = buildCaptureReport({ rest: restSnapshot(), svm: null, capturedAtMs: AT });
    expect(report.svm).toBeNull();
    expect(report.checklist.join(' ')).toMatch(/Virtual Energy.*Aids.*Setup/s);
  });
});
