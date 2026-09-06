import type { entityDisplay } from '@docket/db';
import {
  defaultEntityDisplay,
  type EntityDisplayGlyph,
  type EntityDisplayOut,
  type EntityDisplaySubjectType,
  glyphForLegacyIcon,
} from '@docket/work/entity-display-contract';
import { isKnownEmojiHexcode } from '@docket/work/emoji-catalog';
import { isKnownMaterialSymbolName } from '@docket/work/material-symbol-catalog';

/** Resolve the canonical glyph for a compatibility-era database row. */
export function storedEntityDisplayGlyph(
  subjectType: EntityDisplaySubjectType,
  row: typeof entityDisplay.$inferSelect,
): EntityDisplayGlyph {
  if (
    row.glyphKind === 'symbol' &&
    row.glyphValue !== null &&
    isKnownMaterialSymbolName(row.glyphValue)
  ) {
    return { kind: 'symbol', name: row.glyphValue };
  }
  if (row.glyphKind === 'emoji' && row.glyphValue !== null && isKnownEmojiHexcode(row.glyphValue)) {
    return { kind: 'emoji', hexcode: row.glyphValue };
  }
  if (row.glyphKind === null) return glyphForLegacyIcon(row.iconKey);
  return defaultEntityDisplay(subjectType, row.subjectId).glyph;
}

/** Compose one stored row into the shared compatibility response contract. */
export function storedEntityDisplayOut(
  subjectType: EntityDisplaySubjectType,
  subjectId: string,
  row: typeof entityDisplay.$inferSelect,
): EntityDisplayOut {
  return {
    subjectType,
    subjectId,
    glyph: storedEntityDisplayGlyph(subjectType, row),
    iconKey: row.iconKey,
    colorKey: row.colorKey,
    customColor: row.customColor,
    coverImage: row.coverImage,
    customized: true,
  };
}
