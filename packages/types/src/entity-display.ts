/**
 * `@docket/types` — presentation metadata shared by strategic work entities.
 *
 * @remarks
 * Display choices live outside Initiative and Project planning records. The curated keys keep
 * persisted data independent from a specific icon package or raw color value.
 */
import { z } from 'zod';

/** Work entities that may carry separately stored display metadata. */
export const EntityDisplaySubjectType = z.enum(['initiative', 'project']);
/** Supported display-metadata subject type. */
export type EntityDisplaySubjectType = z.infer<typeof EntityDisplaySubjectType>;

/** Stable presentation keys for the searchable strategic-work icon catalog. */
export const ENTITY_DISPLAY_ICON_KEYS = [
  'target',
  'flag',
  'layers',
  'folder',
  'workflow',
  'globe',
  'users',
  'sparkles',
  'bus',
  'train',
  'subway',
  'route',
  'map',
  'campaign',
  'school',
  'book',
  'event',
  'handshake',
  'government',
  'vote',
  'community',
  'hub',
  'psychology',
  'idea',
  'launch',
  'language',
  'park',
  'building',
  'engineering',
  'construction',
  'timeline',
  'analytics',
  'insights',
  'growth',
  'verified',
  'security',
  'energy',
  'favorite',
  'star',
  'explore',
  'travel',
  'award',
  'volunteering',
  'forum',
  'voice',
  'podcast',
  'article',
  'policy',
  'justice',
  'library',
  'pedestrian',
  // Communication
  'mail',
  'chat',
  'phone',
  'inbox',
  'send',
  // Media
  'camera',
  'image',
  'video',
  'music',
  'film',
  // Finance
  'wallet',
  'payments',
  'receipt',
  'bank',
  'savings',
  // Science
  'science',
  'biotech',
  'experiment',
  'atom',
  // Nature
  'leaf',
  'tree',
  'flower',
  'water',
  'mountain',
  'sun',
  'cloud',
  // Transport
  'car',
  'flight',
  'rocket',
  'bike',
  'boat',
  // Tools
  'build',
  'wrench',
  'settings',
  'tune',
  'hammer',
  // People
  'person',
  'group',
  'contacts',
  'badge',
  // Documents
  'note',
  'archive',
  'clipboard',
  // Security
  'lock',
  'shield',
  'key',
  'fingerprint',
  // Dev
  'code',
  'terminal',
  'database',
  'bug',
] as const;

/** Stable icon key validated independently from any rendering library. */
export const EntityDisplayIconKey = z.enum(ENTITY_DISPLAY_ICON_KEYS);
/** Supported entity-display icon key. */
export type EntityDisplayIconKey = z.infer<typeof EntityDisplayIconKey>;

/**
 * Stable color keys for the preset entity-display palette.
 *
 * @remarks
 * The first five are the original semantic keys, kept first for backward compatibility with
 * already-persisted rows; the renderer resolves those through the Docket semantic design tokens
 * (`state-*`, `primary`, `destructive`). The remaining nine are a decorative named palette —
 * Linear/Notion-style accent choices with no semantic meaning — rendered by the picker from the
 * standard Tailwind color palette (theme-aware via explicit light/dark tints), not the semantic
 * token set. Kept as a `const` array (mirroring {@link ENTITY_DISPLAY_ICON_KEYS}) so the
 * persistence-layer CHECK constraint can derive its value set from a single source of truth.
 */
export const ENTITY_DISPLAY_COLOR_KEYS = [
  // Original semantic keys (order preserved for backward compatibility).
  'neutral',
  'primary',
  'success',
  'warning',
  'danger',
  // Curated named palette.
  'blue',
  'sky',
  'teal',
  'green',
  'amber',
  'orange',
  'rose',
  'purple',
  'indigo',
] as const;

/** The preset entity-display color key: five semantic keys plus the decorative named palette. */
export const EntityDisplayColorKey = z.enum(ENTITY_DISPLAY_COLOR_KEYS);
/** Supported entity-display color key. */
export type EntityDisplayColorKey = z.infer<typeof EntityDisplayColorKey>;

/** Complete display metadata composed for a supported work entity. */
export const EntityDisplayOut = z.object({
  subjectType: EntityDisplaySubjectType,
  subjectId: z.string().min(1),
  iconKey: EntityDisplayIconKey,
  colorKey: EntityDisplayColorKey,
  customized: z.boolean(),
});
/** Composed entity-display metadata. */
export type EntityDisplayOut = z.infer<typeof EntityDisplayOut>;

/** Complete replacement body for an entity's optional display customization. */
export const EntityDisplayUpdate = z.object({
  iconKey: EntityDisplayIconKey,
  colorKey: EntityDisplayColorKey,
});
/** Validated entity-display update. */
export type EntityDisplayUpdate = z.infer<typeof EntityDisplayUpdate>;

/** Resolve the uncoupled display defaults for a supported work entity. */
export function defaultEntityDisplay(
  subjectType: EntityDisplaySubjectType,
  subjectId: string,
): EntityDisplayOut {
  return {
    subjectType,
    subjectId,
    iconKey: subjectType === 'initiative' ? 'target' : 'folder',
    colorKey: 'neutral',
    customized: false,
  };
}
