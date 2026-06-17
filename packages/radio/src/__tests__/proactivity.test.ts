import type { EngineerEvent } from '@race-engineer/core';
import { describe, expect, it } from 'vitest';
import { isQuietWindow, shouldAnnounce, type ProactivityLevel } from '../proactivity';

const at = (tier: EngineerEvent['tier']): Pick<EngineerEvent, 'tier'> => ({ tier });
const CALM = { brake: 0, steer: 0 };
const BRAKING = { brake: 0.9, steer: 0 };
const CORNERING = { brake: 0, steer: 0.8 };

describe('isQuietWindow', () => {
  it('is a quiet window under heavy braking or hard cornering, not when calm', () => {
    expect(isQuietWindow(CALM)).toBe(false);
    expect(isQuietWindow(BRAKING)).toBe(true);
    expect(isQuietWindow(CORNERING)).toBe(true);
    expect(isQuietWindow({ brake: 0, steer: -0.8 })).toBe(true); // sign-insensitive
    expect(isQuietWindow({ brake: 0.3, steer: 0.2 })).toBe(false); // light inputs
  });

  it('honors custom thresholds', () => {
    expect(isQuietWindow({ brake: 0.5, steer: 0 }, { brakeThreshold: 0.4 })).toBe(true);
    expect(isQuietWindow({ brake: 0.5, steer: 0 }, { brakeThreshold: 0.8 })).toBe(false);
  });
});

describe('shouldAnnounce — proactivity level cap', () => {
  const allow = (level: ProactivityLevel, tier: EngineerEvent['tier']): boolean =>
    shouldAnnounce(at(tier), { level });

  it('off suppresses every tier — nothing is announced', () => {
    expect(allow('off', 1)).toBe(false);
    expect(allow('off', 2)).toBe(false);
    expect(allow('off', 3)).toBe(false);
  });

  it('low adds urgent (Tier 1); normal adds conversational (Tier 2); high allows all', () => {
    expect([allow('low', 1), allow('low', 2)]).toEqual([true, false]);
    expect([allow('normal', 2), allow('normal', 3)]).toEqual([true, false]);
    expect([allow('high', 2), allow('high', 3)]).toEqual([true, true]);
  });
});

describe('shouldAnnounce — quiet windows', () => {
  it('holds non-urgent chatter (Tier ≥ 2) under load, but lets safety + urgent through', () => {
    // Tier-2 strategy heads-up is held mid-corner, spoken when calm.
    expect(shouldAnnounce(at(2), { level: 'normal', inputs: CORNERING })).toBe(false);
    expect(shouldAnnounce(at(2), { level: 'normal', inputs: CALM })).toBe(true);
    // An urgent (Tier 1) call still gets through under heavy braking.
    expect(shouldAnnounce(at(1), { level: 'normal', inputs: BRAKING })).toBe(true);
  });

  it('skips the quiet-window check when no inputs are supplied', () => {
    expect(shouldAnnounce(at(2), { level: 'normal' })).toBe(true);
  });
});
