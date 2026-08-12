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
  ProcessDefinitionId,
  ProcessRevisionId,
  RecurrenceSeriesCreate,
  RecurrenceSeriesDetailOut,
  RecurringTaskCreate,
  RecurringTaskCreated,
} from '@docket/types';
import { z } from 'zod';

import { createScheduledProcess } from '../lib/recurrence/authoring';
import { createPublishedProcessDefinition } from '../lib/recurrence/process-definition';
import { createRecurringTask } from '../lib/recurrence/recurring-task';
import type { McpContext } from './auth';
import type { McpRegistrar } from './catalog';
import { authorize, jsonResult, runTool, scopedActor } from './result';
import { orgIdParam } from './tools-shared';

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
        'Save a reusable multi-step Docket process. Use this for a workshop, book-club season, recruiting pipeline, or other collection of related work that should be instantiated more than once. Step keys express dependencies and relative timing; Docket validates and publishes the immutable revision.',
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
        'Schedule a published Docket process from a calendar rule, actual completion, an event, or a manual trigger. Docket owns rolling-window materialization and missed-work behavior; pass the typed trigger without calculating occurrences yourself.',
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

  server.registerTool(
    'repeat_task',
    {
      title: 'Repeat task',
      description:
        'Create one ordinary repeating Docket task in a single call. Use this for routines such as a daily run or a weekly meetup action. Docket creates the underlying one-step process, recurrence series, and rolling window of ordinary tasks.',
      inputSchema: {
        orgId: orgIdParam,
        recurringTask: RecurringTaskCreate.describe(
          'The ordinary task draft plus its calendar or after-completion schedule.',
        ),
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
        const created = await createRecurringTask(db, {
          organizationId: input.orgId,
          actorId: actorCtx.actorId,
          recurringTask: input.recurringTask,
        });
        return jsonResult(created);
      }),
  );
}
