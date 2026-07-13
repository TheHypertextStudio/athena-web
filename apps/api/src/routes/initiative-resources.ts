/** URL-only resource routes for Initiative strategic documents. */
import { attachment, db } from '@docket/db';
import { AttachmentOut, AttachmentRemoved, InitiativeResourceCreate, pageOf } from '@docket/types';
import { and, asc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { NotFoundError } from '../error';
import { ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { zJson, zParam } from '../lib/validate';
import { capabilityGuard } from '../permissions/capability-guard';
import { idParam, loadInitiative } from './initiative-helpers';

const resourceParam = z.object({ id: z.string(), resourceId: z.string() });

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

/** Initiative resource router, mounted beside core Initiative routes. */
const initiativeResources = new Hono<AppEnv>()
  .get(
    '/:id/resources',
    apiDoc({
      tag: 'Initiatives',
      summary: 'List Initiative URL resources',
      response: pageOf(AttachmentOut),
    }),
    zParam(idParam),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      await loadInitiative(orgId, id);
      const rows = await db
        .select()
        .from(attachment)
        .where(
          and(
            eq(attachment.organizationId, orgId),
            eq(attachment.subjectType, 'initiative'),
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
      tag: 'Initiatives',
      summary: 'Attach an Initiative URL resource',
      capability: 'contribute',
      response: AttachmentOut,
    }),
    zParam(idParam),
    zJson(InitiativeResourceCreate),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const body = c.req.valid('json');
      await loadInitiative(orgId, id);
      const rows = await db
        .insert(attachment)
        .values({
          organizationId: orgId,
          createdBy: actorId,
          subjectType: 'initiative',
          subjectId: id,
          kind: 'url',
          title: body.title,
          url: body.url,
        })
        .returning();
      const row = rows[0];
      /* v8 ignore next -- @preserve defensive: insert always returns one row */
      if (!row) throw new Error('Initiative resource insert returned no row');
      return ok(c, AttachmentOut, attachmentOut(row));
    },
  )
  .delete(
    '/:id/resources/:resourceId',
    capabilityGuard('contribute'),
    apiDoc({
      tag: 'Initiatives',
      summary: 'Remove an Initiative URL resource',
      capability: 'contribute',
      response: AttachmentRemoved,
    }),
    zParam(resourceParam),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id, resourceId } = c.req.valid('param');
      await loadInitiative(orgId, id);
      const rows = await db
        .delete(attachment)
        .where(
          and(
            eq(attachment.id, resourceId),
            eq(attachment.organizationId, orgId),
            eq(attachment.subjectType, 'initiative'),
            eq(attachment.subjectId, id),
            eq(attachment.kind, 'url'),
          ),
        )
        .returning({ id: attachment.id });
      const row = rows[0];
      if (!row) throw new NotFoundError('Initiative resource not found');
      return ok(c, AttachmentRemoved, { id: row.id, removed: true });
    },
  );

export default initiativeResources;
