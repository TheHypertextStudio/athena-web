/**
 * `@docket/api` — the task activity-log route, mounted on the tasks router at `/`.
 *
 * @remarks
 * Reads back the metadata history written by `lib/task-audit.ts`. This is deliberately a
 * task-scoped read over the **compliance ledger** (`audit_event`), not over the Stream: the
 * Stream answers "what is happening across my org right now", while this answers "what has
 * happened to this one task, ever" — the GitHub-issue-log question.
 *
 * The log's first entry is **projected from the task row**, never stored. A task's own
 * `createdAt`/`createdBy` already are the record of its creation, so writing a second row saying
 * the same thing would be a duplicate that a dozen different insert sites (the REST create, the
 * subtask create, MCP capture, email-to-task, connector import, calendar promotion, …) would each
 * have to remember to write — and that every task predating this feature would be missing. One
 * derivation covers all of them, retroactively, and cannot drift from the task it describes.
 */
import { actor, auditEvent, db } from '@docket/db';
import { pageOf, taskCreationEntryId, TaskActivityChange, TaskActivityOut } from '@docket/types';
import { and, asc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type { z } from 'zod';

import type { AppEnv } from '../context';
import { NotFoundError } from '../error';
import { ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { zParam } from '../lib/validate';

import { buildTaskViewFilter, idParam, loadTask } from './task-helpers';

/** Task activity-log route, mounted on the tasks router at `/`. */
export const taskActivityRoutes = new Hono<AppEnv>().get(
  '/:id/activity',
  apiDoc({
    tag: 'Tasks',
    summary: "Get a task's activity log",
    response: pageOf(TaskActivityOut),
    description: `Return the complete metadata history of one task — its creation, then one entry per field that has changed since — oldest first, the way a GitHub issue's event log reads. Requires org membership (\`view\`); no extra capability, because reading a task's own history is part of reading the task. A cross-org or unknown id 404s (existence-hiding: another tenant's task is indistinguishable from a non-existent one).

Each entry carries the acting actor (\`actorId\` plus the resolved \`actorName\`, both null for system/automation changes), the exact \`createdAt\` timestamp, and — for an \`updated\` entry — a \`change\` describing one field: its stable machine \`field\` key, its application-owned \`label\`, and the display-ready \`from\`/\`to\` values (\`null\` meaning unset). The \`created\` entry carries \`change: null\`. Values are the display strings resolved when the change was recorded, so renaming a project later never rewrites what history says happened; and the reader never has to resolve an id it may no longer be able to see.

The \`created\` entry is **derived from the task row itself** (\`createdAt\`/\`createdBy\`) rather than stored, so every task has one — however it came into existence (created here, created as a subtask, captured by Athena, imported from a connector) and however long ago, including tasks that predate this endpoint. Its \`id\` is the synthetic \`created:<taskId>\`; every other entry's \`id\` is a ULID.

This is the audit ledger, not the activity Stream. The Stream (\`GET /v1/orgs/:orgId/stream\`) is the org-wide, cross-tool awareness feed and coalesces by design; this endpoint is per-task, complete, and never coalesced — every recorded change is its own entry. Ordering is ascending on \`(createdAt, id)\`, and ids are ULIDs, so entries written in the same millisecond still read back in the order they were applied. Returns a page of {@link TaskActivityOut}.`,
  }),
  zParam(idParam),
  async (c) => {
    const { orgId, actorId } = c.get('actorCtx');
    const { id } = c.req.valid('param');
    // Existence-hiding: 404 before touching the ledger if the task isn't the caller's. The row is
    // also what the creation entry is projected from, so this read is not spent only on the guard.
    const taskRow = await loadTask(orgId, id);
    const canView = await buildTaskViewFilter(orgId, actorId);
    if (!canView(taskRow)) throw new NotFoundError('Task not found');

    // The creator's display name, resolved server-side for the same reason every other value on
    // this log is: a reader must never have to resolve an id, and `createdBy` is nulled out when
    // the actor is deleted, which correctly degrades to an unattributed entry rather than a
    // dangling id.
    const creatorRows = taskRow.createdBy
      ? await db
          .select({ name: actor.displayName })
          .from(actor)
          .where(and(eq(actor.id, taskRow.createdBy), eq(actor.organizationId, orgId)))
          .limit(1)
      : [];

    const items: z.input<typeof TaskActivityOut>[] = [
      {
        id: taskCreationEntryId(taskRow.id),
        taskId: taskRow.id,
        actorId: taskRow.createdBy,
        actorName: creatorRows[0]?.name ?? null,
        type: 'created',
        change: null,
        createdAt: taskRow.createdAt.toISOString(),
      },
    ];

    const rows = await db
      .select({
        id: auditEvent.id,
        actorId: auditEvent.actorId,
        actorName: actor.displayName,
        type: auditEvent.type,
        metadata: auditEvent.metadata,
        createdAt: auditEvent.createdAt,
      })
      .from(auditEvent)
      .leftJoin(actor, eq(auditEvent.actorId, actor.id))
      .where(
        and(
          eq(auditEvent.organizationId, orgId),
          eq(auditEvent.subjectType, 'task'),
          eq(auditEvent.subjectId, id),
          // Only field changes come from the ledger. `created` rows are ignored on purpose: the
          // creation entry above is derived from the task, so honouring a stored one too would
          // show the same event twice for any task created while the ledger also wrote one.
          eq(auditEvent.type, 'updated'),
        ),
      )
      .orderBy(asc(auditEvent.createdAt), asc(auditEvent.id));

    for (const row of rows) {
      // The ledger is shared: rows for a task subject may predate this writer or come from
      // another one entirely. Anything that isn't a shape this log can render is skipped rather
      // than allowed to fail the whole read — a task's history must always be viewable.
      const parsed = TaskActivityChange.safeParse(row.metadata);
      if (!parsed.success) continue;
      items.push({
        id: row.id,
        taskId: id,
        actorId: row.actorId,
        actorName: row.actorName,
        type: 'updated',
        change: parsed.data,
        createdAt: row.createdAt.toISOString(),
      });
    }

    return ok(c, pageOf(TaskActivityOut), { items });
  },
);
