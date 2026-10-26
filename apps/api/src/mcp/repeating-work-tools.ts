/**
 * `@docket/api` — Athena-compatible repeating-work authoring commands.
 *
 * @remarks
 * These intent-shaped tools accept the same named Docket contracts as the HTTP API and delegate
 * to the same process and recurrence services. Athena translates a person's request into those
 * contracts; it does not interpret dates, materialization windows, or process readiness itself.
 */
import { db } from '@docket/db';
import {
  ProcessDefinitionCreate,
  RecurrenceSeriesCreate,
  RecurrenceSeriesDetailOut,
  RecurringTaskCreate,
  RecurringTaskCreated,
} from '../contracts/recurrence';
import { ProcessDefinitionId, ProcessRevisionId } from '@docket/work/ids';
import { z } from 'zod';

import { createScheduledProcess } from '../lib/recurrence/authoring';
import { createPublishedProcessDefinition } from '../lib/recurrence/process-definition';
import { createRecurringTask } from '../lib/recurrence/recurring-task';
import type { McpContext } from './auth';
import type { McpRegistrar } from './catalog';
import { authorize, jsonResult, runTool, scopedActor } from './result';
import { orgIdParam } from './tools-shared';
import { taskFromTemplate } from './template-application';
import {
  templateDecisionFields,
  requireTemplateDecisions,
  mergeTemplateSelection,
} from './template-selection';

const MUTATION_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const;

/** Register reusable-process, scheduled-process, and ordinary repeating-task authoring tools. */
export function registerRepeatingWorkTools(server: McpRegistrar, ctx: McpContext): void {
  server.registerTool(
    'define_process',
    {
      title: 'Define process',
      description:
        'Save a private reusable process with step dependencies and timing. Only its owner or current workspace manager may read/schedule it.\n\nSave a private reusable Docket process. Its owner or a current workspace manager can read or schedule it. Step keys express dependencies and relative timing for related work that repeats; Docket validates and publishes the immutable revision.',
      inputSchema: {
        orgId: orgIdParam,
        definition: ProcessDefinitionCreate.describe(
          'The reusable project, milestones, tasks, dependencies, and timing to publish.',
        ),
      },
      outputSchema: {
        definitionId: ProcessDefinitionId,
        revisionId: ProcessRevisionId,
        revisionNumber: z.number().int().positive(),
      },
      annotations: MUTATION_ANNOTATIONS,
    },
    (input) =>
      runTool(async () => {
        const actorCtx = await scopedActor(ctx, input.orgId, 'work:write');
        await authorize(actorCtx, 'contribute', {
          kind: 'organization',
          id: input.orgId,
          orgId: input.orgId,
        });
        const published = await createPublishedProcessDefinition(db, {
          organizationId: input.orgId,
          actorId: actorCtx.actorId,
          definition: input.definition,
        });
        return jsonResult({
          definitionId: published.definitionId,
          revisionId: published.revisionId,
          revisionNumber: published.revisionNumber,
        });
      }),
  );

  server.registerTool(
    'schedule_process',
    {
      title: 'Schedule process',
      description:
        'Schedule an owned/managed private process with a typed trigger. Docket calculates occurrences, rolling windows and missed work.\n\nSchedule a private process you own or manage at workspace scope. Use a calendar rule, actual completion, event, or manual trigger. Docket owns rolling windows and missed work; pass the typed trigger without calculating occurrences yourself.',
      inputSchema: {
        orgId: orgIdParam,
        series: RecurrenceSeriesCreate.describe(
          'The published process, readable series name, trigger, and optional effective date.',
        ),
      },
      outputSchema: RecurrenceSeriesDetailOut.shape,
      annotations: MUTATION_ANNOTATIONS,
    },
    (input) =>
      runTool(async () => {
        const actorCtx = await scopedActor(ctx, input.orgId, 'work:write');
        await authorize(actorCtx, 'contribute', {
          kind: 'organization',
          id: input.orgId,
          orgId: input.orgId,
        });
        const detail = await createScheduledProcess(db, {
          organizationId: input.orgId,
          actorId: actorCtx.actorId,
          series: input.series,
        });
        return jsonResult(detail);
      }),
  );

  registerRepeatTask(server, ctx);
}

/** Register one-task recurrence separately from reusable multi-step processes. */
function registerRepeatTask(server: McpRegistrar, ctx: McpContext): void {
  server.registerTool(
    'repeat_task',
    {
      title: 'Repeat task',
      description:
        'Create recurring tasks. Read list_templates and fill its body; select workTypeId/version or give withoutTemplateReason. Undecided calls write nothing.\n\nCreate tasks on calendar or completion cadence. First read list_templates and fill its Markdown body, keeping headings. Select workTypeId/version or a legacy template, or give withoutTemplateReason. Explicit fields win; undecided calls write nothing.',
      inputSchema: {
        orgId: orgIdParam,
        recurringTask: RecurringTaskCreate.describe(
          'The ordinary task draft plus its calendar or after-completion schedule.',
        ),
        ...templateDecisionFields,
      },
      outputSchema: RecurringTaskCreated.shape,
      annotations: MUTATION_ANNOTATIONS,
    },
    (input) =>
      runTool(async () => {
        const actorCtx = await scopedActor(ctx, input.orgId, 'work:write');
        await authorize(actorCtx, 'contribute', {
          kind: 'organization',
          id: input.orgId,
          orgId: input.orgId,
        });
        const choice = mergeTemplateSelection(input, input.recurringTask.task);
        const selection = await requireTemplateDecisions(
          input.orgId,
          actorCtx.actorId,
          [
            {
              ...input,
              ...choice,
              ref: 'recurringTask',
              kind: 'task',
              teamId: input.recurringTask.task.teamId,
            },
          ],
          ctx.scopes,
        );
        if (selection) return selection;
        const recurringTask =
          choice.template === undefined && choice.workTypeId === undefined
            ? input.recurringTask
            : {
                ...input.recurringTask,
                task: await taskFromTemplate(
                  input.orgId,
                  actorCtx.actorId,
                  choice.template ?? choice.workTypeId ?? '',
                  input.recurringTask.task,
                  {
                    workTypeVersionId: choice.workTypeVersionId,
                    publishedOnly: choice.workTypeId !== undefined,
                  },
                ),
              };
        const created = await createRecurringTask(db, {
          organizationId: input.orgId,
          actorId: actorCtx.actorId,
          recurringTask,
        });
        return jsonResult(created);
      }),
  );
}
