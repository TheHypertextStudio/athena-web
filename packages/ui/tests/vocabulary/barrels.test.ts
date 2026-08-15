import { describe, expect, it } from 'vitest';

import {
  presetAgency as WorkPresetAgency,
  presetNonprofit as WorkPresetNonprofit,
  presetStartup as WorkPresetStartup,
  VOCABULARY_PRESETS as WorkVocabularyPresets,
} from '@docket/work/vocabulary';
import {
  presetAgency,
  presetNonprofit,
  presetStartup,
  VOCABULARY_PRESETS,
} from '../../src/vocabulary/presets';

describe('vocabulary presets', () => {
  it('re-exports the Work-owned vocabulary tables without a local copy', () => {
    expect(presetStartup).toBe(WorkPresetStartup);
    expect(presetNonprofit).toBe(WorkPresetNonprofit);
    expect(presetAgency).toBe(WorkPresetAgency);
    expect(VOCABULARY_PRESETS).toBe(WorkVocabularyPresets);
  });

  it('every preset defines all six keys with singular + plural', () => {
    const keys = ['initiative', 'program', 'project', 'task', 'cycle', 'team'] as const;
    for (const preset of [presetStartup, presetNonprofit, presetAgency]) {
      for (const key of keys) {
        expect(preset[key].singular.length).toBeGreaterThan(0);
        expect(preset[key].plural.length).toBeGreaterThan(0);
      }
    }
  });

  it('the lookup table maps each preset name to its map', () => {
    expect(VOCABULARY_PRESETS.startup).toBe(presetStartup);
    expect(VOCABULARY_PRESETS.nonprofit).toBe(presetNonprofit);
    expect(VOCABULARY_PRESETS.agency).toBe(presetAgency);
  });

  it('the agency preset re-skins program to Retainer', () => {
    expect(presetAgency.program.singular).toBe('Retainer');
  });
});
