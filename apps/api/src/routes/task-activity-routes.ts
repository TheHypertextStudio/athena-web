/**
 * `@docket/api` — the task activity-log route, mounted on the tasks router at `/`.
 *
 * @remarks
 * Reads back the metadata history written by `lib/task-audit.ts`. This is deliberately a
 * task-scoped read over the **compliance ledger** (`audit_event`), not over the Stream: the
 * Stream answers "what is happening across my org right now", while this answers "what has
 * happened to this one task, ever" — the GitHub-issue-log question.
 */
import { actor, auditEvent, db } from '@docket/db';
import { pageOf, TaskActivityChange, TaskActivityOut } from '@docket/types';
import { and, asc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type { z } from 'zod';

import type { AppEnv } from '../context';
import { ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { zParam } from '../lib/validate';

import { idParam, loadTask } from './task-helpers';

/** Task activity-log route, mounted on the tasks router at `/`. */
export const taskActivityRoutes = new Hono<AppEnv>().get(
  '/:id/activity',
  apiDoc({
    tag: 'Tasks',
    summary: "Get a task's activity log",
    response: pageOf(TaskActivityOut),
    description: `Return the complete metadata history of one task — its creation, then one entry per field that has changed since — oldest first, the way a GitHub issue's event log reads. Requires org membership (\`view\`); no extra capability, because reading a task's own history is part of reading the task. A cross-org or unknown id 404s (existence-hiding: another tenant's task is indistinguishable from a non-existent one).

Each entry carries the acting actor (\`actorId\` plus the resolved \`actorName\`, both null for system/automation changes), the exact \`createdAt\` timestamp, and — for an \`updated\` entry — a \`change\` describing one field: its stable machine \`field\` key, its application-owned \`label\`, and the display-ready \`from\`/\`to\` values (\`null\` meaning unset). The \`created\` entry carries \`change: null\`. Values are the display strings resolved when the change was recorded, so renaming a project later never rewrites what history says happened; and the reader never has to resolve an id it may no longer be able to see.

This is the audit ledger, not the activity Stream. The Stream (\`GET /v1/orgs/:orgId/stream\`) is the org-wide, cross-tool awareness feed and coalesces by design; this endpoint is per-task, complete, and never coalesced — every recorded change is its own entry. Ordering is ascending on \`(createdAt, id)\`, and ids are ULIDs, so entries written in the same millisecond still read back in the order they were applied. Returns a page of {@link TaskActivityOut}.`,
  }),
  zParam(idParam),
  async (c) => {
    const { orgId } = c.get('actorCtx');
    const { id } = c.req.valid('param');
    // Existence-hiding: 404 before touching the ledger if the task isn't the caller's.
    await loadTask(orgId, id);

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
        ),
      )
      .orderBy(asc(auditEvent.createdAt), asc(auditEvent.id));

    const items: z.input<typeof TaskActivityOut>[] = [];
    for (const row of rows) {
      // The ledger is shared: rows for a task subject may predate this writer or come from
      // another one entirely. Anything that isn't a shape this log can render is skipped rather
      // than allowed to fail the whole read — a task's history must always be viewable.
      if (row.type !== 'created' && row.type !== 'updated') continue;
      const parsed = TaskActivityChange.safeParse(row.metadata);
      if (row.type === 'updated' && !parsed.success) continue;
      items.push({
        id: row.id,
        taskId: id,
        actorId: row.actorId,
        actorName: row.actorName,
        type: row.type,
        change: row.type === 'updated' && parsed.success ? parsed.data : null,
        createdAt: row.createdAt.toISOString(),
      });
    }

    return ok(c, pageOf(TaskActivityOut), { items });
  },
);
