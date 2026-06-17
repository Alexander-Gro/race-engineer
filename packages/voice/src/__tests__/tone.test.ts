import { describe, expect, it } from 'vitest';
import { DEFAULT_TONE, parseToneTag, stripSpokenFormatting, VOCAL_TONES } from '../tone';

describe('parseToneTag', () => {
  it('splits a leading tone tag from the spoken words', () => {
    expect(parseToneTag('[urgent] Box this lap, we lose nothing.')).toEqual({
      tone: 'urgent',
      text: 'Box this lap, we lose nothing.',
    });
  });

  it('accepts every advertised tone, case-insensitively', () => {
    for (const tone of VOCAL_TONES) {
      expect(parseToneTag(`[${tone.toUpperCase()}] go`)).toEqual({ tone, text: 'go' });
    }
  });

  it('tolerates surrounding whitespace around the tag', () => {
    expect(parseToneTag('   [calm]    fuel is fine')).toEqual({
      tone: 'calm',
      text: 'fuel is fine',
    });
  });

  it('defaults to calm and leaves the text untouched when there is no tag', () => {
    expect(parseToneTag('Fuel is fine.')).toEqual({ tone: DEFAULT_TONE, text: 'Fuel is fine.' });
  });

  it('maps a synonym a small model improvises (e.g. [Routine]) to its register and strips it', () => {
    // llama3.2 emits non-canonical tags like [Routine]/[Warning]; map to the nearest tone.
    expect(parseToneTag('[Routine] Fuel is fine.')).toEqual({
      tone: 'calm',
      text: 'Fuel is fine.',
    });
    expect(parseToneTag('[Warning] Tyres going off.')).toEqual({
      tone: 'serious',
      text: 'Tyres going off.',
    });
  });

  it('strips an unknown leading word-label too (never speaks a stray "[label]" aloud)', () => {
    // Any pure-word bracket label is a (mis)tag — default the tone, but never voice the bracket.
    expect(parseToneTag('[note] check tyres')).toEqual({ tone: DEFAULT_TONE, text: 'check tyres' });
  });

  it('leaves a bracket carrying a digit in place (content like [P3], not a tone label)', () => {
    expect(parseToneTag('[P3] hold position')).toEqual({
      tone: DEFAULT_TONE,
      text: '[P3] hold position',
    });
  });

  it('only strips the first tag (a second bracket is part of the line)', () => {
    expect(parseToneTag('[serious] [pit] now')).toEqual({ tone: 'serious', text: '[pit] now' });
  });

  it('strips markdown the model leaks, so nothing formatted is spoken', () => {
    expect(parseToneTag('[calm] Fuel is **good**, ~four laps.')).toEqual({
      tone: 'calm',
      text: 'Fuel is good, ~four laps.',
    });
  });
});

describe('stripSpokenFormatting', () => {
  it('removes emphasis asterisks, underscores, and code ticks', () => {
    expect(stripSpokenFormatting('Fuel is **two short** — save a `tenth` and _push_.')).toBe(
      'Fuel is two short — save a tenth and push.',
    );
  });

  it('flattens a bullet/numbered list into one spoken line', () => {
    expect(stripSpokenFormatting('- Fronts good\n- Rears going off\n- Ease them up')).toBe(
      'Fronts good Rears going off Ease them up',
    );
    expect(stripSpokenFormatting('1. Box this lap\n2. Pit on the right')).toBe(
      'Box this lap Pit on the right',
    );
  });

  it('drops heading markers', () => {
    expect(stripSpokenFormatting('## Strategy\nBox this lap.')).toBe('Strategy Box this lap.');
  });

  it('keeps mid-sentence hyphens and em-dashes (real radio punctuation)', () => {
    expect(stripSpokenFormatting('Brake bias back two clicks — should help rotation.')).toBe(
      'Brake bias back two clicks — should help rotation.',
    );
  });

  it('is a no-op on already-clean spoken text', () => {
    expect(stripSpokenFormatting('Box, box. Pit confirm.')).toBe('Box, box. Pit confirm.');
  });
});
