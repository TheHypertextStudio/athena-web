import * as icons from '../../src/icons/index';
import { loadEntityEmojiCatalog } from '../../src/icons/emoji-catalog';
import { ENTITY_SYMBOL_OPTIONS } from '../../src/icons/entity-symbol-catalog';
import { describe, expect, it } from 'vitest';

describe('entity glyph catalog package boundary', () => {
  it('keeps the large picker catalog out of the ordinary icon barrel', () => {
    expect('ENTITY_SYMBOL_OPTIONS' in icons).toBe(false);
    expect(ENTITY_SYMBOL_OPTIONS.length).toBeGreaterThanOrEqual(2500);
  });

  it('loads only fully qualified emoji rather than regional-indicator components', async () => {
    const catalog = await loadEntityEmojiCatalog();

    expect(catalog.emoji).toHaveLength(1923);
    expect(catalog.emoji.every((option) => option.group !== undefined)).toBe(true);
    expect(catalog.emoji.some((option) => option.hexcode === '1F1E6')).toBe(false);
  });
});
