/**
 * `@docket/api` — labels router (mounted at `/v1/orgs/:orgId/labels`).
 */
import { db, label } from '@docket/db';
import { LabelCreate, LabelOut, LabelUpdate, pageOf } from '@docket/types';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { NotFoundError } from '../error';
import { ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { zJson, zParam } from '../lib/validate';
import { capabilityGuard } from '../permissions/capability-guard';
import { enqueueSearchDelete, enqueueSearchUpsert } from '../search/write-through';

type LabelRow = typeof label.$inferSelect;

function toOut(l: LabelRow): z.input<typeof LabelOut> {
  return {
    id: l.id,
    organizationId: l.organizationId,
    name: l.name,
    color: l.color,
    group: l.group,
    teamId: l.teamId,
    createdAt: l.createdAt.toISOString(),
  };
}

const idParam = z.object({ id: z.string() });

/** Labels router: org-scoped CRUD (org-global or team-scoped); `contribute` to mutate. */
const labels = new Hono<AppEnv>()
  .get(
    '/',
    apiDoc({
      tag: 'Labels',
      summary: 'List labels',
      response: pageOf(LabelOut),
      description: `List every label defined in the org — both org-global labels (\`teamId\` null, available everywhere) and team-scoped labels (\`teamId\` set, intended for one team's tasks). Labels are lightweight, freely-applied tags used to classify and filter work (e.g. \`bug\`, \`design\`, \`needs-triage\`); they are orthogonal to workflow state and priority. The list is unpaginated — labels are a small, bounded set per org. Requires org membership (\`view\`). Returns a page wrapper of {@link LabelOut}.`,
    }),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const rows = await db.select().from(label).where(eq(label.organizationId, orgId));
      return ok(c, pageOf(LabelOut), { items: rows.map(toOut) });
    },
  )
  .post(
    '/',
    capabilityGuard('contribute'),
    apiDoc({
      tag: 'Labels',
      summary: 'Create a label',
      capability: 'contribute',
      response: LabelOut,
      description: `Create a label in the org. Requires \`contribute\`. \`name\` and \`color\` are required; supplying \`teamId\` scopes the label to one team, while omitting it makes the label org-global. An optional \`group\` clusters related labels into a mutually-recognizable set (e.g. a \`priority\` group) for grouped pickers. The \`organizationId\` is always derived from the verified path/context, never the body. Returns the created {@link LabelOut}.`,
    }),
    zJson(LabelCreate),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const body = c.req.valid('json');
      const inserted = await db
        .insert(label)
        .values({
          organizationId: orgId,
          name: body.name,
          color: body.color,
          group: body.group ?? null,
          teamId: body.teamId,
        })
        .returning();
      const row = inserted[0];
      /* v8 ignore next -- @preserve defensive: insert/update always returns a row */
      if (!row) throw new Error('label insert returned no row');
      await enqueueSearchUpsert(orgId, 'label', row.id);
      return ok(c, LabelOut, toOut(row));
    },
  )
  .get(
    '/:id',
    apiDoc({
      tag: 'Labels',
      summary: 'Get a label',
      response: LabelOut,
      description: `Fetch one label by id. The lookup is scoped to the caller's org, so a cross-org or unknown id 404s (\`Label not found\`) — existence is never leaked across tenants. Requires org membership (\`view\`). Returns {@link LabelOut}.`,
    }),
    zParam(idParam),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const rows = await db
        .select()
        .from(label)
        .where(and(eq(label.id, id), eq(label.organizationId, orgId)))
        .limit(1);
      const row = rows[0];
      if (!row) throw new NotFoundError('Label not found');
      return ok(c, LabelOut, toOut(row));
    },
  )
  .patch(
    '/:id',
    capabilityGuard('contribute'),
    apiDoc({
      tag: 'Labels',
      summary: 'Update a label',
      capability: 'contribute',
      response: LabelOut,
      description: `Partially update a label; only the fields present in the body change (\`name\`, \`color\`, \`group\`, \`teamId\`). Requires \`contribute\`. Setting \`teamId\` to null re-scopes a team label to org-global; setting \`group\` to null removes it from its group. The lookup is org-scoped, so a cross-org/unknown id 404s. Returns the updated {@link LabelOut}.`,
    }),
    zParam(idParam),
    zJson(LabelUpdate),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const body = c.req.valid('json');
      const updated = await db
        .update(label)
        .set({
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.color !== undefined ? { color: body.color } : {}),
          ...(body.group !== undefined ? { group: body.group } : {}),
          ...(body.teamId !== undefined ? { teamId: body.teamId } : {}),
        })
        .where(and(eq(label.id, id), eq(label.organizationId, orgId)))
        .returning();
      const row = updated[0];
      if (!row) throw new NotFoundError('Label not found');
      await enqueueSearchUpsert(orgId, 'label', row.id);
      return ok(c, LabelOut, toOut(row));
    },
  )
  .delete(
    '/:id',
    capabilityGuard('contribute'),
    apiDoc({
      tag: 'Labels',
      summary: 'Delete a label',
      capability: 'contribute',
      response: LabelOut,
      description: `Hard-delete a label from the org. Requires \`contribute\`. This removes the label definition itself; any task associations to it are dropped (a label is a tag, not a row that owns work). The lookup is org-scoped, so a cross-org/unknown id 404s. Unusually for a delete, this returns the full deleted {@link LabelOut} row (not a bare acknowledgement) so the client can confirm exactly what was removed.`,
    }),
    zParam(idParam),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const deleted = await db
        .delete(label)
        .where(and(eq(label.id, id), eq(label.organizationId, orgId)))
        .returning();
      const row = deleted[0];
      if (!row) throw new NotFoundError('Label not found');
      await enqueueSearchDelete(orgId, 'label', row.id);
      return ok(c, LabelOut, toOut(row));
    },
  );

export default labels;
