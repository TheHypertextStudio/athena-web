import { Health } from '@docket/work/capability-contract';
import { DateResolution } from '@docket/work/planning-timeframe';
import { z } from 'zod';

import { WIDGET, widgetMeta } from './apps';
import { DESCRIPTOR_HINT } from './descriptors';
import { listWorkFilters, WORK_ENTITIES } from './list-work';
import { orgIdParam } from './tools-shared';
import { labelsSetField } from './update-labels';

/** Every field `update` can set, uniform across entities. */
export const updateSetFields = {
  title: z.string().min(1).optional().describe('Rename it. Sets a task title or a container name.'),
  description: z
    .string()
    .optional()
    .describe('The full body, as markdown. Pass an empty string to clear it.'),
  state: z
    .string()
    .optional()
    .describe(
      "A task's workflow state, by key or display name — \"in review\" resolves against each task's own team. An unknown value comes back with that team's legal states.",
    ),
  status: z.string().optional().describe('The status of a project, program, or initiative.'),
  priority: z.string().optional().describe('The priority of a task or an initiative.'),
  health: Health.optional().describe(
    'How a project, program, or initiative is tracking. To say why as well, use report_status.',
  ),
  assignee: z
    .string()
    .nullable()
    .optional()
    .describe(`Who becomes accountable for the task, or null to unassign. ${DESCRIPTOR_HINT}`),
  delegate: z
    .string()
    .nullable()
    .optional()
    .describe(`The agent the doing is handed to, or null to take it back. ${DESCRIPTOR_HINT}`),
  lead: z
    .string()
    .nullable()
    .optional()
    .describe(`Who leads the project, or null to clear. ${DESCRIPTOR_HINT}`),
  owner: z
    .string()
    .nullable()
    .optional()
    .describe(`Who owns the program or initiative, or null to clear. ${DESCRIPTOR_HINT}`),
  project: z
    .string()
    .nullable()
    .optional()
    .describe(`The project to file the task under, or null to unfile it. ${DESCRIPTOR_HINT}`),
  milestone: z.string().nullable().optional().describe("The task's milestone, or null to clear."),
  program: z
    .string()
    .nullable()
    .optional()
    .describe(`The program it rolls up to, or null to detach. ${DESCRIPTOR_HINT}`),
  team: z.string().optional().describe(`The team that owns it. ${DESCRIPTOR_HINT}`),
  dueDate: z.iso
    .date()
    .nullable()
    .optional()
    .describe('When the task is due, as `YYYY-MM-DD`, or null to clear.'),
  startDate: z.iso
    .date()
    .nullable()
    .optional()
    .describe('The planned start for a project, or null to clear.'),
  startDateResolution: DateResolution.nullable()
    .optional()
    .describe('The broad Project start resolution; send it with startDate.'),
  targetDate: z.iso
    .date()
    .nullable()
    .optional()
    .describe('The target finish for a project or initiative, or null to clear.'),
  targetDateResolution: DateResolution.nullable()
    .optional()
    .describe('The broad target resolution; send it with targetDate.'),
  labels: labelsSetField,
};

/** The MCP declaration for the bulk update operation. */
export const updateToolDefinition = {
  title: 'Update work',
  description:
    'Change work by describing which work, not by listing ids. One call changes up to 100 items: the scope takes the same filters as list_work, so "everything Sarah has open in the migration project" is one call, and `scope.ids` takes as many ids as you have. Never call this once per item — put every id in one call, or the person watching gets a separate card for each one. Every row you may not write is reported back with a reason rather than skipped quietly, and the whole call is reversible with `undo`.',
  inputSchema: {
    orgId: orgIdParam,
    entity: z.enum(WORK_ENTITIES).describe('What kind of work to update.'),
    scope: z
      .object({
        ids: z
          .array(z.string())
          .optional()
          .describe(
            'Specific items by id, when you already have them — from list_work or find. Names are not accepted here, because a task title is not unique; use the filters to select by name.',
          ),
        ...listWorkFilters,
      })
      .describe(
        'Which work to change. Same filters as list_work, so a query you just listed can be acted on verbatim. At least one narrowing filter (or `ids`) is required.',
      ),
    set: z
      .object(updateSetFields)
      .describe('The fields to change. Anything omitted is left alone.'),
  },
  outputSchema: {
    matched: z.number().int().describe('How many items the scope selected.'),
    listHref: z
      .string()
      .describe('The page listing this kind of work, for what the card cannot fit.'),
    changed: z.number().int().describe('How many were actually written.'),
    entity: z
      .enum(WORK_ENTITIES)
      .describe('The kind every row in `changes`/`skipped` is — the call scope, echoed back.'),
    changes: z
      .array(
        z.object({
          id: z.string(),
          title: z.string(),
          href: z.string().describe('Where it lives in the product app.'),
          fields: z.array(z.object({ field: z.string(), from: z.string(), to: z.string() })),
        }),
      )
      .describe(
        'What moved, per item, as before → after. Empty `fields` means it already matched.',
      ),
    skipped: z
      .array(z.object({ id: z.string(), title: z.string(), reason: z.string() }))
      .describe(
        'Items left alone, and why — `not_permitted` means the caller cannot write that one, and `label_out_of_scope` means a label is limited to a team the item is not in.',
      ),
    changeSetId: z
      .string()
      .nullable()
      .describe('Pass to `undo` to take the whole call back. Null when nothing changed.'),
  },
  _meta: widgetMeta(WIDGET.changeReport),
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
};
