import { describe, expect, it } from 'vitest';

import { VocabularyPreset, VocabularySkin, VocabularyTerm } from '../src/vocabulary';

describe('VocabularyPreset', () => {
  it('accepts every preset', () => {
    for (const p of ['startup', 'nonprofit', 'agency'] as const) {
      expect(VocabularyPreset.parse(p)).toBe(p);
    }
  });

  it('rejects an unknown preset', () => {
    expect(VocabularyPreset.safeParse('enterprise').success).toBe(false);
  });
});

describe('VocabularyTerm', () => {
  it('parses a singular/plural pair', () => {
    expect(VocabularyTerm.parse({ singular: 'Project', plural: 'Projects' })).toEqual({
      singular: 'Project',
      plural: 'Projects',
    });
  });

  it('rejects a missing plural', () => {
    expect(VocabularyTerm.safeParse({ singular: 'Project' }).success).toBe(false);
  });
});

describe('VocabularySkin', () => {
  it('parses a preset-only skin', () => {
    const parsed = VocabularySkin.parse({ preset: 'startup' });
    expect(parsed.preset).toBe('startup');
    expect(parsed.overrides).toBeUndefined();
  });

  it('parses a skin with per-key overrides', () => {
    const parsed = VocabularySkin.parse({
      preset: 'agency',
      overrides: { project: { singular: 'Engagement', plural: 'Engagements' } },
    });
    expect(parsed.overrides?.['project']?.singular).toBe('Engagement');
  });

  it('rejects an invalid preset', () => {
    expect(VocabularySkin.safeParse({ preset: 'nope' }).success).toBe(false);
  });

  it('rejects a malformed override term', () => {
    expect(
      VocabularySkin.safeParse({ preset: 'startup', overrides: { project: { singular: 'X' } } })
        .success,
    ).toBe(false);
  });
});
