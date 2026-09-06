import { describe, expect, it } from 'vitest';

import {
  emojiGlyphOptions,
  searchGlyphOptions,
  suggestGlyphOptions,
  SYMBOL_GLYPH_OPTIONS,
  type EntityGlyphOption,
} from '../../../src/components/entity-display/entity-glyph-picker-model';

const OPTIONS: readonly EntityGlyphOption[] = [
  {
    id: 'symbol:rocket_launch',
    catalog: 'symbol',
    glyph: { kind: 'symbol', name: 'rocket_launch' },
    label: 'Rocket launch',
    keywords: ['release'],
    shortcodes: [],
    order: 0,
  },
  {
    id: 'symbol:rocket',
    catalog: 'symbol',
    glyph: { kind: 'symbol', name: 'rocket' },
    label: 'Rocket',
    keywords: [],
    shortcodes: [],
    order: 1,
  },
  {
    id: 'symbol:route',
    catalog: 'symbol',
    glyph: { kind: 'symbol', name: 'route' },
    label: 'Route',
    keywords: ['roadmap'],
    shortcodes: [],
    order: 2,
  },
];

describe('entity glyph picker ranking', () => {
  it('ranks exact names before prefixes and alias matches', () => {
    expect(searchGlyphOptions(OPTIONS, 'rocket').map((option) => option.id)).toEqual([
      'symbol:rocket',
      'symbol:rocket_launch',
    ]);
    expect(searchGlyphOptions(OPTIONS, 'roadmap').map((option) => option.id)).toEqual([
      'symbol:route',
    ]);
  });

  it('uses stable catalog order to break equal ranking scores', () => {
    expect(searchGlyphOptions(OPTIONS, 'ro').map((option) => option.id)).toEqual([
      'symbol:rocket_launch',
      'symbol:rocket',
      'symbol:route',
    ]);
  });

  it('ranks exact shortcodes and name prefixes before aliases', () => {
    const candidates: readonly EntityGlyphOption[] = [
      {
        id: 'symbol:rocket_launch',
        catalog: 'symbol',
        glyph: { kind: 'symbol', name: 'rocket_launch' },
        label: 'Rocket launch',
        keywords: ['release'],
        shortcodes: [],
        order: 0,
      },
      {
        id: 'symbol:release_alert',
        catalog: 'symbol',
        glyph: { kind: 'symbol', name: 'release_alert' },
        label: 'Release alert',
        keywords: [],
        shortcodes: [],
        order: 1,
      },
      {
        id: 'emoji:1F680',
        catalog: 'emoji',
        glyph: { kind: 'emoji', hexcode: '1F680' },
        label: 'rocket',
        keywords: ['ship'],
        shortcodes: ['release'],
        order: 2,
        unicode: '🚀',
      },
    ];

    expect(searchGlyphOptions(candidates, 'release').map((option) => option.id)).toEqual([
      'emoji:1F680',
      'symbol:release_alert',
      'symbol:rocket_launch',
    ]);
  });

  it('returns at most twelve deterministic suggestions from the entity name', () => {
    const first = suggestGlyphOptions(SYMBOL_GLYPH_OPTIONS, 'Transit workflow initiative');
    const second = suggestGlyphOptions(SYMBOL_GLYPH_OPTIONS, 'Transit workflow initiative');

    expect(first).toEqual(second);
    expect(first.length).toBeLessThanOrEqual(12);
    expect(first.map((option) => option.id)).toContain('symbol:directions_bus');
    expect(
      suggestGlyphOptions(SYMBOL_GLYPH_OPTIONS, 'Workflow').map((option) => option.id),
    ).toContain('symbol:account_tree');
  });

  it('gives each meaningful name token a place in the suggestion set', () => {
    const suggestions = suggestGlyphOptions(SYMBOL_GLYPH_OPTIONS, 'Transit launch workflow').map(
      (option) => option.id,
    );

    expect(suggestions).toContain('symbol:directions_bus');
    expect(suggestions).toContain('symbol:rocket_launch');
    expect(suggestions).toContain('symbol:account_tree');
  });

  it('starts icon browsing with useful work symbols instead of package metadata', () => {
    const firstRow = SYMBOL_GLYPH_OPTIONS.slice(0, 7).map((option) => option.id);

    expect(firstRow).toEqual([
      'symbol:track_changes',
      'symbol:folder_open',
      'symbol:account_tree',
      'symbol:layers',
      'symbol:flag',
      'symbol:groups',
      'symbol:calendar_month',
    ]);
  });
});

describe('entity glyph picker skin tones', () => {
  it('uses the same preferred tone for every person in a multi-person emoji', () => {
    const [option] = emojiGlyphOptions(
      {
        emoji: [
          {
            hexcode: '1F9D1-200D-1F91D-200D-1F9D1',
            label: 'people holding hands',
            unicode: '🧑‍🤝‍🧑',
            skins: [
              {
                hexcode: '1F9D1-1F3FB-200D-1F91D-200D-1F9D1-1F3FD',
                label: 'people holding hands: light skin tone, medium skin tone',
                unicode: '🧑🏻‍🤝‍🧑🏽',
              },
              {
                hexcode: '1F9D1-1F3FD-200D-1F91D-200D-1F9D1-1F3FD',
                label: 'people holding hands: medium skin tone',
                unicode: '🧑🏽‍🤝‍🧑🏽',
              },
            ],
          },
        ],
        groups: [],
        skinTones: [],
        shortcodes: {},
      },
      '1F3FD',
    );

    expect(option?.glyph).toEqual({
      kind: 'emoji',
      hexcode: '1F9D1-1F3FD-200D-1F91D-200D-1F9D1-1F3FD',
    });
  });
});
