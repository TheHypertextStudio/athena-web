import { describe, expect, it } from 'vitest';

import * as components from './components';
import * as hooks from './hooks';
import * as root from './index';
import * as primitives from './primitives';
import {
  presetAgency,
  presetNonprofit,
  presetStartup,
  VOCABULARY_PRESETS,
} from './vocabulary/presets';

describe('barrels', () => {
  it('the root barrel re-exports the utility layer', () => {
    expect(typeof root.cn).toBe('function');
    expect(typeof root.getOrgAccent).toBe('function');
    expect(Array.isArray(root.ORG_ACCENT_PALETTE)).toBe(true);
  });

  it('the primitives barrel re-exports the primitives', () => {
    expect(typeof primitives.Button).toBe('function');
    expect(typeof primitives.DropdownMenu).toBeDefined();
    expect(typeof primitives.Card).toBe('function');
  });

  it('the components barrel re-exports the shell + views', () => {
    expect(typeof components.AppShell).toBe('function');
    expect(typeof components.ListView).toBe('function');
    expect(components.NO_GROUP_LABEL).toBe('No project / Triage');
  });

  it('the hooks barrel re-exports the hooks', () => {
    expect(typeof hooks.useVocabulary).toBe('function');
    expect(typeof hooks.useListKeyboard).toBe('function');
    expect(typeof hooks.VocabularyProvider).toBe('function');
  });
});

describe('vocabulary presets', () => {
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
