/**
 * `domain packages` — presentation metadata shared by strategic work entities.
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

/** Every native interaction subject, including identities that never own a display row. */
export const ENTITY_PRESENTATION_SUBJECT_TYPES = [
  'initiative',
  'program',
  'project',
  'task',
  'cycle',
  'milestone',
  'team',
  'label',
  'workStatus',
  'actor',
  'calendarEvent',
  'attachment',
  'timeBlock',
  'initiativeRoot',
  'calendarSlot',
] as const;

/** Native interaction subject with a declared presentation policy. */
export const EntityPresentationSubjectType = z.enum(ENTITY_PRESENTATION_SUBJECT_TYPES);
/** Supported native interaction subject. */
export type EntityPresentationSubjectType = z.infer<typeof EntityPresentationSubjectType>;

/** The reason a native entity does or does not use a decoupled display record. */
export const EntityPresentationPolicy = z.enum([
  'customizable',
  'semantic',
  'avatar',
  'external',
  'virtual',
]);
/** Presentation policy for one native Docket entity. */
export type EntityPresentationPolicy = z.infer<typeof EntityPresentationPolicy>;

/** The presentation contract for one native Docket interaction subject. */
export interface EntityPresentationPolicyDefinition {
  /** The policy that determines how a surface renders this entity's identity. */
  readonly policy: EntityPresentationPolicy;
  /** The optional display-record type used for customizable or semantic identities. */
  readonly subjectType?: EntityDisplaySubjectType;
}

/**
 * The complete presentation policy for native entities exposed by Docket's interaction layer.
 *
 * @remarks
 * Customizable entities own icon and color overrides. Labels and work statuses also expose a
 * decorative identity, but their workflow color remains semantic. Actors keep avatars, external
 * records retain provider identity, and virtual records never acquire persistence of their own.
 */
export const ENTITY_PRESENTATION_POLICIES = {
  initiative: { policy: 'customizable', subjectType: 'initiative' },
  program: { policy: 'customizable', subjectType: 'program' },
  project: { policy: 'customizable', subjectType: 'project' },
  task: { policy: 'customizable', subjectType: 'task' },
  cycle: { policy: 'customizable', subjectType: 'cycle' },
  milestone: { policy: 'customizable', subjectType: 'milestone' },
  team: { policy: 'customizable', subjectType: 'team' },
  label: { policy: 'semantic', subjectType: 'label' },
  workStatus: { policy: 'semantic', subjectType: 'workStatus' },
  actor: { policy: 'avatar' },
  calendarEvent: { policy: 'external' },
  attachment: { policy: 'external' },
  timeBlock: { policy: 'semantic' },
  initiativeRoot: { policy: 'virtual' },
  calendarSlot: { policy: 'virtual' },
} as const satisfies Record<EntityPresentationSubjectType, EntityPresentationPolicyDefinition>;

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

/** A Material Symbols ligature name such as `account_balance` or `rocket_launch`. */
export const MaterialSymbolName = z.string().regex(/^[a-z0-9]+(?:_[a-z0-9]+)*$/);
/** Validated Material Symbols ligature name. */
export type MaterialSymbolName = z.infer<typeof MaterialSymbolName>;

/** An uppercase, hyphen-separated fully qualified Unicode emoji sequence. */
export const EmojiHexcode = z.string().regex(/^[0-9A-F]{2,6}(?:-[0-9A-F]{2,6})*$/);
/** Validated fully qualified Unicode emoji sequence. */
export type EmojiHexcode = z.infer<typeof EmojiHexcode>;

/** The saved visual identity for a customizable Docket entity. */
export const EntityDisplayGlyph = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('symbol'), name: MaterialSymbolName }),
  z.object({ kind: z.literal('emoji'), hexcode: EmojiHexcode }),
]);
/** A Material symbol or a fully qualified Unicode emoji. */
export type EntityDisplayGlyph = z.infer<typeof EntityDisplayGlyph>;

/**
 * The exact Material symbol that preserves each legacy icon's visible meaning.
 *
 * @remarks
 * The database migration and compatibility parser both consume this table. Keeping one explicit
 * entry per legacy key makes a missing backfill impossible to hide behind a generic fallback.
 */
export const LEGACY_ICON_SYMBOL_NAMES = {
  target: 'track_changes',
  flag: 'outlined_flag',
  layers: 'layers',
  folder: 'folder_open',
  workflow: 'account_tree',
  globe: 'public',
  users: 'groups',
  sparkles: 'auto_awesome',
  bus: 'directions_bus',
  train: 'train',
  subway: 'subway',
  route: 'route',
  map: 'map',
  campaign: 'campaign',
  school: 'school',
  book: 'menu_book',
  event: 'event',
  handshake: 'handshake',
  government: 'account_balance',
  vote: 'how_to_vote',
  community: 'diversity_3',
  hub: 'hub',
  psychology: 'psychology',
  idea: 'lightbulb',
  launch: 'rocket_launch',
  language: 'language',
  park: 'park',
  building: 'apartment',
  engineering: 'engineering',
  construction: 'construction',
  timeline: 'timeline',
  analytics: 'analytics',
  insights: 'insights',
  growth: 'trending_up',
  verified: 'verified',
  security: 'security',
  energy: 'bolt',
  favorite: 'favorite',
  star: 'star',
  explore: 'explore',
  travel: 'travel_explore',
  award: 'workspace_premium',
  volunteering: 'volunteer_activism',
  forum: 'forum',
  voice: 'record_voice_over',
  podcast: 'podcasts',
  article: 'article',
  policy: 'policy',
  justice: 'gavel',
  library: 'local_library',
  pedestrian: 'emoji_people',
  mail: 'mail',
  chat: 'chat',
  phone: 'phone',
  inbox: 'inbox',
  send: 'send',
  camera: 'camera_alt',
  image: 'image',
  video: 'videocam',
  music: 'music_note',
  film: 'movie',
  wallet: 'account_balance_wallet',
  payments: 'payments',
  receipt: 'receipt_long',
  bank: 'account_balance',
  savings: 'savings',
  science: 'science',
  biotech: 'biotech',
  experiment: 'vaccines',
  atom: 'bubble_chart',
  leaf: 'energy_savings_leaf',
  tree: 'forest',
  flower: 'local_florist',
  water: 'water_drop',
  mountain: 'landscape',
  sun: 'wb_sunny',
  cloud: 'cloud',
  car: 'directions_car',
  flight: 'flight',
  rocket: 'rocket',
  bike: 'directions_bike',
  boat: 'directions_boat',
  build: 'build',
  wrench: 'handyman',
  settings: 'settings',
  tune: 'tune',
  hammer: 'hardware',
  person: 'person',
  group: 'group',
  contacts: 'contacts',
  badge: 'badge',
  note: 'note',
  archive: 'archive',
  clipboard: 'content_paste',
  lock: 'lock',
  shield: 'shield',
  key: 'key',
  fingerprint: 'fingerprint',
  code: 'code',
  terminal: 'terminal',
  database: 'storage',
  bug: 'bug_report',
} as const satisfies Record<EntityDisplayIconKey, MaterialSymbolName>;

/** Convert one compatibility icon key into its canonical glyph. */
export function glyphForLegacyIcon(iconKey: EntityDisplayIconKey): EntityDisplayGlyph {
  return { kind: 'symbol', name: LEGACY_ICON_SYMBOL_NAMES[iconKey] };
}

/**
 * Choose a valid compatibility key for a glyph written by a new client.
 *
 * @param glyph - The new canonical glyph.
 * @param fallback - The subject's legacy default when the glyph has no exact old equivalent.
 * @returns A valid key that an old client can render.
 */
export function legacyIconForGlyph(
  glyph: EntityDisplayGlyph,
  fallback: EntityDisplayIconKey,
): EntityDisplayIconKey {
  if (glyph.kind === 'emoji') return fallback;
  const exact = ENTITY_DISPLAY_ICON_KEYS.find(
    (key) => LEGACY_ICON_SYMBOL_NAMES[key] === glyph.name,
  );
  return exact ?? fallback;
}

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
  readonly glyph: EntityDisplayGlyph;
  /** The old catalog key retained only for compatibility responses and dual writes. */
  readonly legacyIconKey: EntityDisplayIconKey;
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
  initiative: {
    glyph: { kind: 'symbol', name: 'track_changes' },
    legacyIconKey: 'target',
    colorKey: 'neutral',
  },
  program: {
    glyph: { kind: 'symbol', name: 'layers' },
    legacyIconKey: 'layers',
    colorKey: 'primary',
  },
  project: {
    glyph: { kind: 'symbol', name: 'folder_open' },
    legacyIconKey: 'folder',
    colorKey: 'neutral',
  },
  task: {
    glyph: { kind: 'symbol', name: 'content_paste' },
    legacyIconKey: 'clipboard',
    colorKey: 'neutral',
  },
  cycle: {
    glyph: { kind: 'symbol', name: 'timeline' },
    legacyIconKey: 'timeline',
    colorKey: 'primary',
  },
  milestone: {
    glyph: { kind: 'symbol', name: 'outlined_flag' },
    legacyIconKey: 'flag',
    colorKey: 'neutral',
  },
  team: {
    glyph: { kind: 'symbol', name: 'groups' },
    legacyIconKey: 'users',
    colorKey: hashTeamColorKey,
  },
  label: {
    glyph: { kind: 'symbol', name: 'badge' },
    legacyIconKey: 'badge',
    colorKey: 'neutral',
  },
  workStatus: {
    glyph: { kind: 'symbol', name: 'account_tree' },
    legacyIconKey: 'workflow',
    colorKey: 'neutral',
  },
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
  glyph: EntityDisplayGlyph,
  /** Compatibility response field. Remove after the 30-day client window. */
  iconKey: EntityDisplayIconKey,
  colorKey: EntityDisplayColorKey,
  customColor: EntityDisplayCustomColor.nullable(),
  coverImage: z
    .string()
    .nullable()
    .describe(
      'Managed public URL of an uploaded cover image, or null when the cover is derived from `glyph` + `colorKey`. Null is the ordinary state, not a missing value — a derived cover always renders.',
    ),
  customized: z.boolean(),
});
/** Composed entity-display metadata. */
export type EntityDisplayOut = z.infer<typeof EntityDisplayOut>;

/** Complete replacement body for an entity's optional display customization. */
export const EntityDisplayUpdate = z
  .object({
    glyph: EntityDisplayGlyph.optional(),
    /** Compatibility update field. Remove after the 30-day client window. */
    iconKey: EntityDisplayIconKey.optional(),
    colorKey: EntityDisplayColorKey,
    customColor: EntityDisplayCustomColor.nullable(),
    coverImage: z
      .string()
      .nullable()
      .optional()
      .describe(
        "A `data:` image URL to store as this entity's cover, or null to clear it and fall back to the derived cover. Omit to leave the current cover unchanged.",
      ),
  })
  .refine((update) => update.glyph !== undefined || update.iconKey !== undefined, {
    message: 'A glyph or compatibility icon key is required',
  });
/** Validated entity-display update. */
export type EntityDisplayUpdate = z.infer<typeof EntityDisplayUpdate>;

/** Resolve the uncoupled display defaults for a supported work entity. */
export function defaultEntityDisplay(
  subjectType: EntityDisplaySubjectType,
  subjectId: string,
): EntityDisplayOut {
  const definition = ENTITY_DISPLAY_SUBJECTS[subjectType];
  return {
    subjectType,
    subjectId,
    glyph: definition.glyph,
    iconKey: definition.legacyIconKey,
    colorKey:
      typeof definition.colorKey === 'function'
        ? definition.colorKey(subjectId)
        : definition.colorKey,
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
