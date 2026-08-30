/**
 * `@docket/types` — presentation metadata shared by strategic work entities.
 *
 * @remarks
 * Display choices live outside Initiative and Project planning records. The curated keys keep
 * persisted data independent from a specific icon package or raw color value.
 */
import { z } from 'zod';

/** Every persisted Docket entity that may carry separately stored display metadata. */
export const ENTITY_DISPLAY_SUBJECT_TYPES = [
  'initiative',
  'program',
  'project',
  'task',
  'cycle',
  'milestone',
  'team',
  'label',
  'workStatus',
] as const;

/** Entity kind validated by the decoupled display relation. */
export const EntityDisplaySubjectType = z.enum(ENTITY_DISPLAY_SUBJECT_TYPES);
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

/** One stable default presentation before a person customizes an entity. */
export interface EntityDisplaySubjectDefinition {
  /** The glyph shown until the entity has a stored display row. */
  readonly iconKey: EntityDisplayIconKey;
  /** The default decorative color, derived from the stable subject identifier when required. */
  readonly colorKey: EntityDisplayColorKey | ((subjectId: string) => EntityDisplayColorKey);
}

/**
 * The default presentation for every persisted display subject.
 *
 * @remarks
 * This registry intentionally names display subjects rather than database tables. The API owns
 * table and visibility mappings, while this package remains safe for clients and projections that
 * need a default without importing persistence.
 */
export const ENTITY_DISPLAY_SUBJECTS = {
  initiative: { iconKey: 'target', colorKey: 'neutral' },
  program: { iconKey: 'layers', colorKey: 'primary' },
  project: { iconKey: 'folder', colorKey: 'neutral' },
  task: { iconKey: 'clipboard', colorKey: 'neutral' },
  cycle: { iconKey: 'timeline', colorKey: 'primary' },
  milestone: { iconKey: 'flag', colorKey: 'neutral' },
  team: { iconKey: 'users', colorKey: hashTeamColorKey },
  label: { iconKey: 'badge', colorKey: 'neutral' },
  workStatus: { iconKey: 'workflow', colorKey: 'neutral' },
} as const satisfies Record<EntityDisplaySubjectType, EntityDisplaySubjectDefinition>;

/**
 * A lowercase six-digit hex color (e.g. `#3b82f6`).
 *
 * @remarks
 * The free-form custom-color override that supersedes {@link EntityDisplayColorKey} at render
 * time only. Kept as a separate value so `colorKey` always stays a valid preset enum; a non-null
 * custom color is what the renderer prefers over the resolved named/semantic token.
 */
export const EntityDisplayCustomColor = z.string().regex(/^#[0-9a-f]{6}$/);
/** Validated lowercase six-digit hex custom color. */
export type EntityDisplayCustomColor = z.infer<typeof EntityDisplayCustomColor>;

/** Complete display metadata composed for a supported work entity. */
export const EntityDisplayOut = z.object({
  subjectType: EntityDisplaySubjectType,
  subjectId: z.string().min(1),
  iconKey: EntityDisplayIconKey,
  colorKey: EntityDisplayColorKey,
  customColor: EntityDisplayCustomColor.nullable(),
  coverImage: z
    .string()
    .nullable()
    .describe(
      'Managed public URL of an uploaded cover image, or null when the cover is derived from `iconKey` + `colorKey`. Null is the ordinary state, not a missing value — a derived cover always renders.',
    ),
  customized: z.boolean(),
});
/** Composed entity-display metadata. */
export type EntityDisplayOut = z.infer<typeof EntityDisplayOut>;

/** Complete replacement body for an entity's optional display customization. */
export const EntityDisplayUpdate = z.object({
  iconKey: EntityDisplayIconKey,
  colorKey: EntityDisplayColorKey,
  customColor: EntityDisplayCustomColor.nullable(),
  coverImage: z
    .string()
    .nullable()
    .optional()
    .describe(
      "A `data:` image URL to store as this entity's cover, or null to clear it and fall back to the derived cover. Omit to leave the current cover unchanged.",
    ),
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
    iconKey: ENTITY_DISPLAY_SUBJECTS[subjectType].iconKey,
    colorKey:
      typeof ENTITY_DISPLAY_SUBJECTS[subjectType].colorKey === 'function'
        ? ENTITY_DISPLAY_SUBJECTS[subjectType].colorKey(subjectId)
        : ENTITY_DISPLAY_SUBJECTS[subjectType].colorKey,
    customColor: null,
    coverImage: null,
    customized: false,
  };
}

/**
 * The colors an uncustomized team's default may land on.
 *
 * @remarks
 * Only the decorative named palette — the five semantic keys (`primary`/`success`/`warning`/
 * `danger`) carry meaning elsewhere in the product and would be misleading to hand a team by
 * chance.
 */
export const TEAM_DEFAULT_COLOR_KEYS = [
  'blue',
  'sky',
  'teal',
  'green',
  'amber',
  'orange',
  'rose',
  'purple',
  'indigo',
] as const satisfies readonly EntityDisplayColorKey[];

/**
 * Derive an uncustomized team's default color from its id.
 *
 * @remarks
 * A workspace that has just created six teams should not read as six identical gray tiles, but a
 * cover that shuffled its color on every reload would read as a bug (see the `team-cover.tsx`
 * doc comment). Hashing the id keeps the result varied *and* stable — the same team always lands
 * on the same color, with no `entity_display` row and no migration required, so it applies to
 * every existing team retroactively the next time its display is read.
 *
 * @param subjectId - The team's id.
 * @returns A deterministic pick from {@link TEAM_DEFAULT_COLOR_KEYS}.
 */
function hashTeamColorKey(subjectId: string): EntityDisplayColorKey {
  let hash = 0;
  for (const char of subjectId) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  const picked = TEAM_DEFAULT_COLOR_KEYS[Math.abs(hash) % TEAM_DEFAULT_COLOR_KEYS.length];
  /* v8 ignore next -- unreachable: modulo of a non-empty array is always a valid index. */
  return picked ?? 'blue';
}
