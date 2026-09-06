import { describe, expect, it } from 'vitest';

import { EMOJI_HEXCODES, isKnownEmojiHexcode } from '../src/generated/emoji-hexcodes';
import {
  isKnownMaterialSymbolName,
  MATERIAL_SYMBOL_NAMES,
} from '../src/generated/material-symbol-names';

describe('generated entity glyph catalogs', () => {
  it('contains the complete pinned Material Symbol catalog', () => {
    expect(MATERIAL_SYMBOL_NAMES.length).toBeGreaterThanOrEqual(2500);
    expect(isKnownMaterialSymbolName('rocket_launch')).toBe(true);
    expect(isKnownMaterialSymbolName('not_a_real_material_symbol')).toBe(false);
  });

  it('accepts complete emoji sequences and rejects unknown or joined emoji', () => {
    expect(EMOJI_HEXCODES).toHaveLength(3953);
    expect(isKnownEmojiHexcode('1F680')).toBe(true);
    expect(isKnownEmojiHexcode('1F44D-1F3FD')).toBe(true);
    expect(isKnownEmojiHexcode('1F1E6')).toBe(false);
    expect(isKnownEmojiHexcode('1F600-1F680')).toBe(false);
    expect(isKnownEmojiHexcode('FFFFFF')).toBe(false);
  });
});
