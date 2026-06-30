/**
 * `@docket/api` — attachment routes, mounted on the tasks router at `/`
 * (so the surface is `/v1/orgs/:orgId/tasks/:id/attachments`).
 *
 * @remarks
 * An attachment is a typed reference from a task to an external/stored resource — the first
 * use of the general attachment model (`docs/engineering/specs/email-to-task.md`). The
 * subject is always derived from the route (`task` + the `:id` param), never the body, so a
 * caller can only attach to a task it can already address. Every handler loads the host task
 * first via {@link loadTask}, which 404s a cross-org/unknown id — that single check is the
 * tenant boundary for the whole router. Reads require org membership; mutations require
 * `contribute`, matching the tasks router.
 */
import { attachment, db } from '@docket/db';
import { AttachmentCreate, AttachmentOut, AttachmentRemoved, pageOf } from '@docket/types';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { NotFoundError } from '../error';
import { ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { zJson, zParam } from '../lib/validate';
import { capabilityGuard } from '../permissions/capability-guard';
import { loadTask } from './task-helpers';

type AttachmentRow = typeof attachment.$inferSelect;

/** Project an attachment row into its wire {@link AttachmentOut} shape. */
function toOut(a: AttachmentRow): z.input<typeof AttachmentOut> {
  return {
    id: a.id,
    organizationId: a.organizationId,
    subjectType: a.subjectType,
    subjectId: a.subjectId,
    kind: a.kind,
    title: a.title,
    url: a.url,
    sourceIntegrationId: a.sourceIntegrationId,
    externalId: a.externalId,
    metadata: (a.metadata as Record<string, unknown> | null) ?? null,
    createdAt: a.createdAt.toISOString(),
  };
}

const taskParam = z.object({ id: z.string() });
const attParam = z.object({ id: z.string(), attachmentId: z.string() });

/**
 * Attachment routes: list / create / remove attachments on a task.
 *
 * @remarks
 * Mounted on the tasks router, so `:id` is the host task. The host task is loaded on every
 * request (404 for a cross-org or unknown id) before any attachment work, keeping the router
 * tenant-isolated by construction.
 */
export const attachmentRoutes = new Hono<AppEnv>()
  .get(
    '/:id/attachments',
    apiDoc({
      tag: 'Tasks',
      summary: 'List task attachments',
      response: pageOf(AttachmentOut),
      description: `List a task's attachments — typed references from the task to an external or stored resource (a pasted \`url\` link, or an integration-backed \`email\` pointer whose content stays in Gmail). Ordered oldest-first by creation. The subject is always derived from the route (\`task\` + \`:id\`), never the body, so a caller can only read attachments on a task it can already address; the host task is loaded first (cross-org/unknown 404s) and that single check is the tenant boundary. Archived attachments are excluded. Requires org membership (\`view\`). Returns a page of {@link AttachmentOut}.`,
    }),
    zParam(taskParam),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      await loadTask(orgId, id);
      const rows = await db
        .select()
        .from(attachment)
        .where(
          and(
            eq(attachment.organizationId, orgId),
            eq(attachment.subjectType, 'task'),
            eq(attachment.subjectId, id),
            isNull(attachment.archivedAt),
          ),
        )
        .orderBy(asc(attachment.createdAt));
      return ok(c, pageOf(AttachmentOut), { items: rows.map(toOut) });
    },
  )
  .post(
    '/:id/attachments',
    capabilityGuard('contribute'),
    apiDoc({
      tag: 'Tasks',
      summary: 'Add a task attachment',
      capability: 'contribute',
      response: AttachmentOut,
      description: `Attach a resource to a task. The subject (\`task\` + the \`:id\`) is taken from the route, never the body. Requires \`contribute\`. The host task is loaded first (cross-org/unknown 404s), so an attachment can only be added to a task the caller can address.

The \`kind\` determines the required fields, enforced at the schema edge: a \`url\` attachment requires \`url\`; an \`email\` attachment requires both \`sourceIntegrationId\` and \`externalId\` (the Gmail thread id) — a half-specified body 422s. \`metadata\` is an optional free-form JSON bag for kind-specific extras (e.g. fetched favicon, sender). Returns the created {@link AttachmentOut}.`,
    }),
    zParam(taskParam),
    zJson(AttachmentCreate),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const inputBody = c.req.valid('json');
      await loadTask(orgId, id);

      const inserted = await db
        .insert(attachment)
        .values({
          organizationId: orgId,
          createdBy: actorId,
          subjectType: 'task',
          subjectId: id,
          kind: inputBody.kind,
          title: inputBody.title,
          url: inputBody.url ?? null,
          sourceIntegrationId: inputBody.sourceIntegrationId ?? null,
          externalId: inputBody.externalId ?? null,
          metadata: inputBody.metadata ?? null,
        })
        .returning();
      const row = inserted[0];
      /* v8 ignore next -- @preserve defensive: insert always returns a row */
      if (!row) throw new Error('attachment insert returned no row');
      return ok(c, AttachmentOut, toOut(row));
    },
  )
  .delete(
    '/:id/attachments/:attachmentId',
    capabilityGuard('contribute'),
    apiDoc({
      tag: 'Tasks',
      summary: 'Remove a task attachment',
      capability: 'contribute',
      response: AttachmentRemoved,
      description: `Hard-delete an attachment from a task. Requires \`contribute\`. The host task is loaded first so a cross-org or unknown task id 404s before the attachment is addressable — the attachment id alone never leaks across tenants. The delete is additionally scoped to (\`organizationId\`, \`subjectType = task\`, \`subjectId = :id\`), so an attachment id that belongs to a different task or org 404s (\`Attachment not found\`). Returns an {@link AttachmentRemoved} acknowledgement.`,
    }),
    zParam(attParam),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id, attachmentId } = c.req.valid('param');
      // Load the host task first so a cross-org/unknown task id 404s before the attachment
      // is addressable — the attachment id alone never leaks across tenants.
      await loadTask(orgId, id);

      const removed = await db
        .delete(attachment)
        .where(
          and(
            eq(attachment.id, attachmentId),
            eq(attachment.organizationId, orgId),
            eq(attachment.subjectType, 'task'),
            eq(attachment.subjectId, id),
          ),
        )
        .returning();
      const row = removed[0];
      if (!row) throw new NotFoundError('Attachment not found');
      return ok(c, AttachmentRemoved, { id: row.id, removed: true });
    },
  );
