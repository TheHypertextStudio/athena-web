/**
 * `@docket/types` — Label slice DTOs.
 */
import { z } from 'zod';

import { LabelId, OrganizationId, TeamId } from './primitives';

/** Body for creating a Label; org-global when `teamId` is omitted, else team-scoped. */
export const LabelCreate = z
  .object({
    name: z.string().min(1).describe('Label text, e.g. `bug` or `design`. Required, non-empty.'),
    color: z
      .string()
      .min(1)
      .describe(
        'Display color for the label badge (e.g. a hex string or named token). Required, non-empty.',
      ),
    group: z
      .string()
      .nullable()
      .optional()
      .describe(
        'Optional group key clustering related labels (e.g. a `priority` group) for grouped pickers; null/omitted = ungrouped.',
      ),
    teamId: TeamId.optional().describe(
      'Scope the label to one team. Omit for an org-global label available everywhere. Must reference a team in the caller’s org.',
    ),
  })
  .meta({ id: 'LabelCreate', description: 'Create a label within an organization.' });
/** Validated label-create body. */
export type LabelCreate = z.infer<typeof LabelCreate>;

/** Body for updating a Label (all fields optional). */
export const LabelUpdate = z
  .object({
    name: z
      .string()
      .min(1)
      .optional()
      .describe('New label text (non-empty). Omit to leave unchanged.'),
    color: z
      .string()
      .min(1)
      .optional()
      .describe('New badge color (non-empty). Omit to leave unchanged.'),
    group: z
      .string()
      .nullable()
      .optional()
      .describe('New group key, or null to remove from its group. Omit to leave unchanged.'),
    teamId: TeamId.nullable()
      .optional()
      .describe(
        'Re-scope to this team, or null to make the label org-global. Omit to leave unchanged.',
      ),
  })
  .meta({ id: 'LabelUpdate', description: 'Update a label.' });
/** Validated label-update body. */
export type LabelUpdate = z.infer<typeof LabelUpdate>;

/** Full label representation returned by reads. */
export const LabelOut = z
  .object({
    id: LabelId.describe('Opaque label id.'),
    organizationId: OrganizationId.describe('Owning org id (the tenant key).'),
    name: z.string().describe('Label text.'),
    color: z.string().describe('Display color for the label badge.'),
    group: z
      .string()
      .nullable()
      .optional()
      .describe('Group key clustering related labels; null when ungrouped.'),
    teamId: TeamId.nullable()
      .optional()
      .describe('Owning team when team-scoped; null for an org-global label.'),
    createdAt: z.string().describe('Creation timestamp (ISO 8601).'),
  })
  .meta({ id: 'LabelOut', description: 'A label.' });
/** Label representation value. */
export type LabelOut = z.infer<typeof LabelOut>;
