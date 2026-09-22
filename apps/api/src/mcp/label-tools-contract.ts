/**
 * `@docket/api` — the MCP declaration of `define_labels`.
 *
 * @remarks
 * Kept apart from the handler so the schema, which a model reads, can be reviewed on its own.
 */
import { LabelColorKeySchema } from '@docket/work/label-contract';
import { z } from 'zod';

import { WIDGET, widgetMeta } from './apps';
import { CatalogRowSchema, CatalogSkipSchema } from './catalog-rows';
import { DESCRIPTOR_HINT } from './descriptors';
import { orgIdParam } from './tools-shared';

/** The most groups plus labels one call will define. */
export const MAX_DEFINITIONS = 100;

const teamField = z
  .string()
  .nullable()
  .optional()
  .describe(
    `The team to limit it to, or null for the whole workspace. Omit to leave an existing one as it is; a new one is workspace-wide unless its group is limited to a team. ${DESCRIPTOR_HINT}`,
  );

/** One label group to create or edit. */
export const GroupDefinition = z.object({
  group: z
    .string()
    .optional()
    .describe(
      `An existing group to edit, needed to rename it or move it to another team. ${DESCRIPTOR_HINT} Without it, a group already called \`name\` in the given team (or anywhere, when \`team\` is omitted) is edited, and any other name is created — group names only need to be unique within a team.`,
    ),
  name: z.string().trim().min(1).describe('The group’s name, e.g. "Severity" or "Type".'),
  exclusive: z
    .boolean()
    .optional()
    .describe(
      'True (the default for a new group) means work carries at most one label from the group, so adding one replaces the other. False lets work carry any combination.',
    ),
  team: teamField,
});

/** One label to create or edit. */
export const LabelDefinition = z.object({
  label: z
    .string()
    .optional()
    .describe(
      `An existing label to edit, needed only to rename it. ${DESCRIPTOR_HINT} Without it, a label already called \`name\` (ignoring case) is edited and any other name is created.`,
    ),
  name: z.string().trim().min(1).describe('The label’s text, e.g. "Bug".'),
  color: LabelColorKeySchema.optional().describe(
    'A palette color. Omit and a new label gets the next color in rotation; an existing one keeps its own.',
  ),
  group: z
    .string()
    .nullable()
    .optional()
    .describe(
      `The group it belongs to, including one defined in the same call, or null to take it out of its group. ${DESCRIPTOR_HINT}`,
    ),
  team: teamField,
});

/** The MCP declaration for `define_labels`. */
export const defineLabelsDefinition = {
  title: 'Define labels',
  description:
    'Create or edit label groups and labels in one call, matched by name. To put labels on work, use `update` with `set.labels`.\n\nGroups are applied first, so a label can join a group defined in the same call, and re-running the same call changes nothing. Creating a label needs contribute access; renaming, recoloring, regrouping or rescoping one, and any group change, needs manage access. An entry the caller may not write, or that clashes with an existing name, comes back in `skipped` with a reason while the rest still apply, and the whole call is reversible with `undo`.',
  inputSchema: {
    orgId: orgIdParam,
    groups: z
      .array(GroupDefinition)
      .optional()
      .describe('Label groups to create or edit, applied before `labels`.'),
    labels: z.array(LabelDefinition).optional().describe('Labels to create or edit.'),
  },
  outputSchema: {
    changed: z.number().int().describe('How many groups and labels were created or edited.'),
    listHref: z.string().describe('The labels settings page.'),
    changes: z
      .array(CatalogRowSchema)
      .describe('Every entry the call wrote or matched, groups first, in call order.'),
    skipped: z.array(CatalogSkipSchema).describe('Entries left alone, and why.'),
    changeSetId: z
      .string()
      .nullable()
      .describe('Pass to `undo` to take the whole call back. Null when nothing changed.'),
  },
  _meta: widgetMeta(WIDGET.changeReport),
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};
