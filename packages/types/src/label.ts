/**
 * `@docket/types` — Label slice DTOs.
 *
 * @remarks
 * Labels are Docket's one deliberate escape hatch. The product ships no custom-field engine —
 * statuses, priorities, and health are the app's opinions — so labels carry every dimension an
 * org needs that Docket does not model. That is also why they get exactly one structural idea
 * ({@link LabelGroupOut}) and no more.
 */
import { z } from 'zod';

import { LabelGroupId, LabelId, OrganizationId, TeamId } from './primitives';

/**
 * The label color palette, as token keys rather than hex strings.
 *
 * @remarks
 * A stored hex cannot work in both themes: app surfaces run L 0.98–0.90 in light and L
 * 0.175–0.36 in dark, so one fixed value is unreadable against one of them. A key instead
 * resolves at render time to a light/dark triple (`dot`, `container`, `on-container`) declared
 * in both theme blocks of the design system.
 *
 * The hues extend `ORG_ACCENT_PALETTE` so org accents and label colors read as one family.
 * `slate` is the deliberate neutral for labels that should not compete for attention.
 */
export const LABEL_COLOR_KEYS = [
  'blue',
  'violet',
  'pink',
  'coral',
  'amber',
  'green',
  'teal',
  'indigo',
  'plum',
  'slate',
] as const;

/** A label palette token key. */
export type LabelColorKey = (typeof LABEL_COLOR_KEYS)[number];

/** Zod schema for a label palette token key. */
export const LabelColorKeySchema = z
  .enum(LABEL_COLOR_KEYS)
  .describe(
    'Palette token for the label, resolved to a light/dark color pair at render time. Not a hex string.',
  );

/** True when `value` is one of the palette token keys. */
export function isLabelColorKey(value: string): value is LabelColorKey {
  return (LABEL_COLOR_KEYS as readonly string[]).includes(value);
}

/**
 * Pick the palette token for the `n`th label in an org, by rotation.
 *
 * @remarks
 * Deterministic rather than random so the third label an org creates is always the same color,
 * and so a test can assert it. Inline label creation never asks the user to choose a color —
 * this is what it calls instead.
 *
 * `slate` is excluded from the rotation: it is the neutral you opt into, never one you're
 * assigned.
 *
 * @param index - Count of labels that already exist in the scope.
 * @returns The palette token to assign.
 */
export function nextLabelColor(index: number): LabelColorKey {
  const rotating = LABEL_COLOR_KEYS.filter((key) => key !== 'slate');
  const picked = rotating[Math.abs(index) % rotating.length];
  /* v8 ignore next -- unreachable: modulo of a non-empty array is always a valid index. */
  return picked ?? 'blue';
}

/**
 * Normalize a label name for comparison and dedupe.
 *
 * @remarks
 * The DB uniques are case-sensitive by deliberate decision, so the *UI and API* are where
 * `Bug` must be recognized as the existing `bug` rather than becoming a near-duplicate beside
 * it. Trims, collapses internal whitespace, and lowercases.
 *
 * @param name - The raw name as typed.
 * @returns The comparison key (never shown to a user).
 */
export function normalizeLabelName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * A label name: non-empty once trimmed.
 *
 * @remarks
 * `min(1)` alone would accept `'   '`, which the server then trims into a blank label nobody can
 * see or select. Rejecting it in the schema keeps that a 422 with a field path rather than an
 * ad-hoc check in the route.
 */
const LabelName = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0, { message: 'Label name cannot be blank' });

/** Body for creating a Label. Always org-global; narrow the scope afterwards via update. */
export const LabelCreate = z
  .object({
    name: LabelName.describe('Label text, e.g. `bug` or `design`. Required, non-blank.'),
    color: LabelColorKeySchema.optional().describe(
      'Palette token for the label. Omit and the server assigns the next color by rotation — inline creation relies on this so the user is never asked to pick one.',
    ),
    groupId: LabelGroupId.nullable()
      .optional()
      .describe(
        'Group this label belongs to. The group must share the label’s scope; null/omitted = ungrouped.',
      ),
  })
  .meta({ id: 'LabelCreate', description: 'Create a label within an organization.' });
/** Validated label-create body. */
export type LabelCreate = z.infer<typeof LabelCreate>;

/** Body for updating a Label (all fields optional). */
export const LabelUpdate = z
  .object({
    name: LabelName.optional().describe('New label text (non-blank). Omit to leave unchanged.'),
    color: LabelColorKeySchema.optional().describe(
      'New palette token. Omit to leave unchanged. Supplying this on a label mirrored from a provider replaces its legacy hex.',
    ),
    groupId: LabelGroupId.nullable()
      .optional()
      .describe('New group id, or null to remove from its group. Omit to leave unchanged.'),
    teamId: TeamId.nullable()
      .optional()
      .describe(
        'Limit the label to this team, or null to make it workspace-wide. Omit to leave unchanged. Narrowing is non-destructive: attachments outside the team are kept, the label just stops being offered elsewhere.',
      ),
  })
  .meta({ id: 'LabelUpdate', description: 'Update a label.' });
/** Validated label-update body. */
export type LabelUpdate = z.infer<typeof LabelUpdate>;

/** Body for merging one label into another. */
export const LabelMerge = z
  .object({
    intoId: LabelId.describe(
      'The surviving label. Every attachment on the source label is reassigned to this one, then the source is deleted.',
    ),
  })
  .meta({
    id: 'LabelMerge',
    description: 'Merge a label into another, reassigning all of its attachments.',
  });
/** Validated label-merge body. */
export type LabelMerge = z.infer<typeof LabelMerge>;

/** Full label representation returned by reads. */
export const LabelOut = z
  .object({
    id: LabelId.describe('Opaque label id.'),
    organizationId: OrganizationId.describe('Owning org id (the tenant key).'),
    name: z.string().describe('Label text.'),
    color: z
      .string()
      .describe(
        'Palette token key (see LABEL_COLOR_KEYS). May be a legacy hex on labels mirrored from a provider; readers snap those to the nearest token rather than failing.',
      ),
    groupId: LabelGroupId.nullable().optional().describe('Owning group id; null when ungrouped.'),
    teamId: TeamId.nullable()
      .optional()
      .describe('Owning team when limited to one team; null for a workspace-wide label.'),
    usageCount: z
      .number()
      .int()
      .optional()
      .describe(
        'Total attachments across every labelable entity. Present only on list reads that ask for it; drives the settings page’s counts and its "Unused" section.',
      ),
    external: z
      .boolean()
      .optional()
      .describe(
        'True when this label was mirrored from a connected tool rather than created here.',
      ),
    createdAt: z.string().describe('Creation timestamp (ISO 8601).'),
  })
  .meta({ id: 'LabelOut', description: 'A label.' });
/** Label representation value. */
export type LabelOut = z.infer<typeof LabelOut>;

/** Body for creating a label group. */
export const LabelGroupCreate = z
  .object({
    name: LabelName.describe('Group name, e.g. `Type` or `Stage`. Required, non-blank.'),
    exclusive: z
      .boolean()
      .optional()
      .describe(
        'When true (the default), applying one member releases every other member — a single-select dimension. False makes the group a purely visual cluster.',
      ),
    sortOrder: z
      .number()
      .int()
      .optional()
      .describe('Manual display order within the org; ties break on name. Defaults to 0.'),
  })
  .meta({ id: 'LabelGroupCreate', description: 'Create a label group.' });
/** Validated label-group-create body. */
export type LabelGroupCreate = z.infer<typeof LabelGroupCreate>;

/** Body for updating a label group (all fields optional). */
export const LabelGroupUpdate = z
  .object({
    name: LabelName.optional().describe('New group name. Omit to leave unchanged.'),
    exclusive: z
      .boolean()
      .optional()
      .describe(
        'Toggle mutual exclusivity. Turning this on does not retroactively strip existing multi-member attachments; it governs writes from that point on.',
      ),
    sortOrder: z.number().int().optional().describe('New display order. Omit to leave unchanged.'),
    teamId: TeamId.nullable()
      .optional()
      .describe(
        'Limit the group to this team, or null for workspace-wide. Members move with the group, since a group and its labels must share one scope.',
      ),
  })
  .meta({ id: 'LabelGroupUpdate', description: 'Update a label group.' });
/** Validated label-group-update body. */
export type LabelGroupUpdate = z.infer<typeof LabelGroupUpdate>;

/** Full label-group representation returned by reads. */
export const LabelGroupOut = z
  .object({
    id: LabelGroupId.describe('Opaque label group id.'),
    organizationId: OrganizationId.describe('Owning org id (the tenant key).'),
    name: z.string().describe('Group name.'),
    exclusive: z
      .boolean()
      .describe('True when applying one member releases the others (a single-select dimension).'),
    sortOrder: z.number().int().describe('Manual display order within the org.'),
    teamId: TeamId.nullable()
      .optional()
      .describe('Owning team when limited to one team; null for a workspace-wide group.'),
    createdAt: z.string().describe('Creation timestamp (ISO 8601).'),
  })
  .meta({ id: 'LabelGroupOut', description: 'A label group.' });
/** Label-group representation value. */
export type LabelGroupOut = z.infer<typeof LabelGroupOut>;
