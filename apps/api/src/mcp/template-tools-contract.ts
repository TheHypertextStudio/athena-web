/**
 * `@docket/api` — the MCP declaration of `define_template`.
 *
 * @remarks
 * Kept apart from the handler so the schema, which a model reads, can be reviewed on its own.
 */
import { ViewScope } from '@docket/work/saved-view-contract';
import { TemplateDraft } from '@docket/work/template-contract';
import { z } from 'zod';

import { WIDGET, widgetMeta } from './apps';
import { CatalogRowSchema, CatalogSkipSchema } from './catalog-rows';
import { DESCRIPTOR_HINT } from './descriptors';
import { orgIdParam } from './tools-shared';

/** The MCP declaration for `define_template`. */
export const defineTemplateDefinition = {
  title: 'Define template',
  description:
    'Create or edit one template, the starting point the composer offers for new tasks, projects, initiatives, or programs.\n\nOmit `template` to create one, which needs `name` and `payload`; pass `template` to edit one you can see, sending only what changes. `payload` replaces the whole draft when sent, and a template never changes the kind of work it creates. The change is reversible with `undo`.',
  inputSchema: {
    orgId: orgIdParam,
    template: z
      .string()
      .optional()
      .describe(
        `An existing template to edit, from those visible to you. ${DESCRIPTOR_HINT} Omit to create a new template.`,
      ),
    name: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe('The name shown in the picker, e.g. "Bug report". Required to create.'),
    description: z
      .string()
      .optional()
      .describe('One line on when to use it, shown under the name. An empty string clears it.'),
    scope: ViewScope.optional().describe(
      'Who sees it: `personal` (only you, the default for a new template), `team`, or `organization`.',
    ),
    team: z
      .string()
      .optional()
      .describe(`The team it belongs to. Required when \`scope\` is \`team\`. ${DESCRIPTOR_HINT}`),
    payload: TemplateDraft.optional().describe(
      'What a new item starts with. Required to create; `payload.targetType` sets the kind of work the template creates.',
    ),
    labels: z
      .array(z.string())
      .optional()
      .describe(
        `Task templates only: the labels a new task starts with, replacing \`payload.labelIds\`. ${DESCRIPTOR_HINT} A label limited to a team only fits a template for that team.`,
      ),
  },
  outputSchema: {
    changed: z.number().int().describe('1 when the template was created or edited, 0 otherwise.'),
    listHref: z.string().describe('The templates settings page.'),
    changes: z.array(CatalogRowSchema).describe('The template, with what moved on an edit.'),
    skipped: z.array(CatalogSkipSchema).describe('Always empty; a refused write fails the call.'),
    changeSetId: z
      .string()
      .nullable()
      .describe('Pass to `undo` to take the change back. Null when nothing changed.'),
  },
  _meta: widgetMeta(WIDGET.changeReport),
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
};
