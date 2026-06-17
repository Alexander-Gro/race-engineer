import { describe, expect, it } from 'vitest';
import { BASE_SYSTEM_PROMPT, buildSystemPrompt, ENGINEER_SKILL } from '../index';

describe('engineer skill', () => {
  it('is composed into the system prompt after the base rules and persona', () => {
    const prompt = buildSystemPrompt('calm-veteran');
    expect(prompt).toContain(BASE_SYSTEM_PROMPT);
    expect(prompt).toContain(ENGINEER_SKILL);
    // Skill comes after the base hard-rules (judgment layer sits on top of the constraints).
    expect(prompt.indexOf(ENGINEER_SKILL)).toBeGreaterThan(prompt.indexOf(BASE_SYSTEM_PROMPT));
  });

  it('rides every persona (judgment is behavior, persona is only phrasing)', () => {
    for (const persona of ['calm-veteran', 'energetic', 'terse'] as const) {
      expect(buildSystemPrompt(persona)).toContain(ENGINEER_SKILL);
    }
  });

  it('encodes the silence/relevance discipline — the fix to canned, spammy call-outs', () => {
    // The whole point: speak only when it changes what the driver does or knows, and never repeat
    // what he already knows. These are load-bearing instructions, asserted so they can't be quietly
    // deleted without a failing test.
    expect(ENGINEER_SKILL).toMatch(/only when/i);
    expect(ENGINEER_SKILL).toMatch(/driver remembers/i);
    expect(ENGINEER_SKILL).toMatch(/stay silent/i);
  });

  it('forbids markdown in the spoken output and demands real-radio brevity', () => {
    // The reply is read aloud by TTS — any markdown ("*", lists, headings) is a bug. These rules
    // are load-bearing; assert them so a prompt edit can't quietly bring the asterisks back.
    expect(BASE_SYSTEM_PROMPT).toMatch(/read aloud/i);
    expect(BASE_SYSTEM_PROMPT).toMatch(/never\b.*\bmarkdown/i);
    expect(BASE_SYSTEM_PROMPT).toMatch(/asterisk/i);
    expect(BASE_SYSTEM_PROMPT).toMatch(/one or two short sentences/i);
    // The skill reinforces the radio voice (terse, plain, lead with what matters).
    expect(ENGINEER_SKILL).toMatch(/real radio/i);
    expect(ENGINEER_SKILL).toMatch(/box, box/i);
    // ...and the professional-engineer cadence grounded in the F1/WEC research.
    expect(ENGINEER_SKILL).toMatch(/acknowledge/i);
    expect(ENGINEER_SKILL).toMatch(/quiet authority/i);
  });

  it('keeps math and write-access out of the model (CLAUDE.md rules 1 & 5)', () => {
    expect(ENGINEER_SKILL).toMatch(/from your tools/i);
    expect(ENGINEER_SKILL).toMatch(/never (invent|write)/i);
    expect(ENGINEER_SKILL).toMatch(/driver makes every/i);
  });

  it('frames traffic as anticipatory, not instant proximity calls', () => {
    expect(ENGINEER_SKILL).toMatch(/anticipatory/i);
    expect(ENGINEER_SKILL).toMatch(/already alongside/i);
  });

  it('teaches the Virtual Energy binding constraint, not just fuel', () => {
    expect(ENGINEER_SKILL).toMatch(/virtual energy/i);
    expect(ENGINEER_SKILL).toMatch(/bindingConstraint/);
  });
});
