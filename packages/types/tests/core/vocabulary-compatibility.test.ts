import {
  VocabularyPreset as DomainVocabularyPreset,
  VocabularySkin as DomainVocabularySkin,
  resolveVocabularyTerm as resolveDomainVocabularyTerm,
} from '@docket/work/vocabulary';
import {
  VocabularyPreset as LegacyVocabularyPreset,
  VocabularySkin as LegacyVocabularySkin,
  resolveVocabularyTerm as resolveLegacyVocabularyTerm,
} from '@docket/types';
import { describe, expect, it } from 'vitest';

describe('Work vocabulary compatibility', () => {
  it('re-exports the Work schemas and resolver instead of retaining a second grammar', () => {
    expect(LegacyVocabularyPreset).toBe(DomainVocabularyPreset);
    expect(LegacyVocabularySkin).toBe(DomainVocabularySkin);
    expect(resolveLegacyVocabularyTerm).toBe(resolveDomainVocabularyTerm);
  });
});
