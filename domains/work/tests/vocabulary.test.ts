import { describe, expect, it } from 'vitest';

import {
  defaultVocabularySkin,
  resolveVocabularyTerm,
  VocabularyPreset,
  VocabularySkin,
  VocabularyTerm,
} from '../src/vocabulary';

describe('Work vocabulary contract', () => {
  it('uses the startup preset as the compact default organization skin', () => {
    expect(defaultVocabularySkin).toEqual({ preset: 'startup' });
  });

  it('accepts every supported vocabulary preset', () => {
    for (const preset of ['startup', 'nonprofit', 'agency'] as const) {
      expect(VocabularyPreset.parse(preset)).toBe(preset);
    }

    expect(VocabularyPreset.safeParse('enterprise').success).toBe(false);
  });

  it('parses complete singular and plural terms', () => {
    expect(VocabularyTerm.parse({ singular: 'Project', plural: 'Projects' })).toEqual({
      singular: 'Project',
      plural: 'Projects',
    });

    expect(VocabularyTerm.safeParse({ singular: 'Project' }).success).toBe(false);
  });

  it('parses a preset-only skin and rejects invalid term data', () => {
    const parsed = VocabularySkin.parse({ preset: 'startup' });
    expect(parsed).toEqual({ preset: 'startup' });

    expect(VocabularySkin.safeParse({ preset: 'nope' }).success).toBe(false);
    expect(
      VocabularySkin.safeParse({ preset: 'startup', overrides: { project: { singular: 'X' } } })
        .success,
    ).toBe(false);
  });

  it('preserves explicit vocabulary overrides on a parsed organization skin', () => {
    const parsed = VocabularySkin.parse({
      preset: 'agency',
      overrides: { project: { singular: 'Engagement', plural: 'Engagements' } },
    });

    expect(parsed.overrides?.['project']).toEqual({
      singular: 'Engagement',
      plural: 'Engagements',
    });
  });

  it('resolves startup labels when an organization has no skin', () => {
    expect(resolveVocabularyTerm(null, 'cycle')).toEqual({
      singular: 'Cycle',
      plural: 'Cycles',
    });
  });

  it('resolves the selected skin unless an organization override wins', () => {
    expect(resolveVocabularyTerm({ preset: 'nonprofit' }, 'cycle')).toEqual({
      singular: 'Season',
      plural: 'Seasons',
    });
    expect(
      resolveVocabularyTerm(
        {
          preset: 'agency',
          overrides: { project: { singular: 'Case', plural: 'Cases' } },
        },
        'project',
      ),
    ).toEqual({ singular: 'Case', plural: 'Cases' });
  });
});
