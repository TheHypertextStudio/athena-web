/**
 * `@docket/api` — the MCP declaration of `define_template`.
 *
 * @remarks
 * Kept apart from the handler so the schema, which a model reads, can be reviewed on its own.
 */
import { ViewScope } from '@docket/work/saved-view-contract';
import { TemplateDraft } from '@docket/work/template-contract';
import { Blueprint } from '@docket/work/work-template-blueprint';
import { ProgramDefaultSchedules } from '@docket/work/work-schedule-defaults';
import { z } from 'zod';

import { WIDGET, widgetMeta } from './apps';
import { CatalogRowSchema, CatalogSkipSchema } from './catalog-rows';
import { DESCRIPTOR_HINT } from './descriptors';
import { orgIdParam } from './tools-shared';

/** The MCP declaration for `define_template`. */
export const defineTemplateDefinition = {
  title: 'Define template',
  description:
    'Create or edit reusable work templates.\n\nPut literal Markdown in payload.description; description summarizes usage. Omit template to create with name and payload; otherwise edit by ID/name. payload replaces the draft. Legacy workspace writes publish immediately. action draft saves included child work in blueprint without publishing; publish requires expectedRevision, and archive retires. Blueprints require explicit draft authoring. Undo preserves publication history',
  inputSchema: {
    orgId: orgIdParam,
    action: z
      .enum(['draft', 'publish', 'archive'])
      .optional()
      .describe(
        'Omit for legacy writes (workspace writes publish). draft edits without publishing; publish requires a reviewed revision; archive retires it.',
      ),
    expectedRevision: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe('Required for draft edits and publication; returned as revision.'),
    defaultStatusKey: z
      .string()
      .min(1)
      .nullable()
      .optional()
      .describe('Canonical draft status default; null clears it.'),
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
    blueprint: Blueprint.optional().describe(
      'Included child work and dependencies. Requires action draft; omitted preserves the saved graph, and empty steps/dependencies clears it. Publication validates the composed graph, capped at 500 total items including its root and nested templates.',
    ),
    defaultSchedules: ProgramDefaultSchedules.optional().describe(
      'Program templates only, action draft: up to 20 reusable recurring-work outlines. Omission preserves saved defaults; [] clears them. Each new Program gets independent copies. Use relative cadence and parent assignment rules; no people, teams, locations or provider IDs.',
    ),
    labels: z
      .array(z.string())
      .optional()
      .describe(
        `Task templates only: the labels a new task starts with, replacing \`payload.labelIds\`. ${DESCRIPTOR_HINT} A label limited to a team only fits a template for that team.`,
      ),
  },
  outputSchema: {
    revision: z.number().int(),
    publicationState: z.enum(['draft', 'published', 'archived']),
    workTypeVersionId: z.string().nullable(),
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
