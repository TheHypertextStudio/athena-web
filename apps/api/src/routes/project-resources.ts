/** URL-only resource routes for Project operating records. */
import { attachment, db, project } from '@docket/db';
import { AttachmentOut, AttachmentRemoved, ProjectResourceCreate, pageOf } from '@docket/types';
import { and, asc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { NotFoundError } from '../error';
import { ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { zJson, zParam } from '../lib/validate';
import { capabilityGuard } from '../permissions/capability-guard';

const idParam = z.object({ id: z.string() });
const resourceParam = z.object({ id: z.string(), resourceId: z.string() });

async function loadProject(organizationId: string, projectId: string): Promise<void> {
  const rows = await db
    .select({ id: project.id })
    .from(project)
    .where(and(eq(project.organizationId, organizationId), eq(project.id, projectId)))
    .limit(1);
  if (!rows[0]) throw new NotFoundError('Project not found');
}

function attachmentOut(row: typeof attachment.$inferSelect): z.input<typeof AttachmentOut> {
  return {
    id: row.id,
    organizationId: row.organizationId,
    subjectType: row.subjectType,
    subjectId: row.subjectId,
    kind: row.kind,
    title: row.title,
    url: row.url,
    sourceIntegrationId: row.sourceIntegrationId,
    externalId: row.externalId,
    metadata: row.metadata as Record<string, unknown> | null,
    fileName: row.fileName,
    mimeType: row.mimeType,
    byteSize: row.byteSize,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Project resource router, mounted beside the Project aggregate routes. */
const projectResources = new Hono<AppEnv>()
  .get(
    '/:id/resources',
    apiDoc({
      tag: 'Projects',
      summary: 'List Project URL resources',
      description: 'Lists URL resources attached directly to the selected Project.',
      response: pageOf(AttachmentOut),
    }),
    zParam(idParam),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      await loadProject(orgId, id);
      const rows = await db
        .select()
        .from(attachment)
        .where(
          and(
            eq(attachment.organizationId, orgId),
            eq(attachment.subjectType, 'project'),
            eq(attachment.subjectId, id),
            eq(attachment.kind, 'url'),
          ),
        )
        .orderBy(asc(attachment.createdAt));
      return ok(c, pageOf(AttachmentOut), { items: rows.map(attachmentOut) });
    },
  )
  .post(
    '/:id/resources',
    capabilityGuard('contribute'),
    apiDoc({
      tag: 'Projects',
      summary: 'Attach a Project URL resource',
      description: 'Attaches a titled external URL to the selected Project.',
      capability: 'contribute',
      response: AttachmentOut,
    }),
    zParam(idParam),
    zJson(ProjectResourceCreate),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const body = c.req.valid('json');
      await loadProject(orgId, id);
      const rows = await db
        .insert(attachment)
        .values({
          organizationId: orgId,
          createdBy: actorId,
          subjectType: 'project',
          subjectId: id,
          kind: 'url',
          title: body.title,
          url: body.url,
        })
        .returning();
      const row = rows[0];
      /* v8 ignore next -- @preserve the insert returns its single created row */
      if (!row) throw new Error('Project resource insert returned no row');
      return ok(c, AttachmentOut, attachmentOut(row));
    },
  )
  .delete(
    '/:id/resources/:resourceId',
    capabilityGuard('contribute'),
    apiDoc({
      tag: 'Projects',
      summary: 'Remove a Project URL resource',
      description: 'Removes a URL resource after verifying Project and workspace ownership.',
      capability: 'contribute',
      response: AttachmentRemoved,
    }),
    zParam(resourceParam),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id, resourceId } = c.req.valid('param');
      await loadProject(orgId, id);
      const rows = await db
        .delete(attachment)
        .where(
          and(
            eq(attachment.id, resourceId),
            eq(attachment.organizationId, orgId),
            eq(attachment.subjectType, 'project'),
            eq(attachment.subjectId, id),
            eq(attachment.kind, 'url'),
          ),
        )
        .returning({ id: attachment.id });
      const row = rows[0];
      if (!row) throw new NotFoundError('Project resource not found');
      return ok(c, AttachmentRemoved, { id: row.id, removed: true });
    },
  );

export default projectResources;
