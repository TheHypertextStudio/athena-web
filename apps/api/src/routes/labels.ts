/**
 * `@docket/api` — labels router (mounted at `/v1/orgs/:orgId/labels`).
 *
 * @remarks
 * ## Why two capabilities
 *
 * Creating and applying a label needs `contribute`; renaming, recoloring, re-grouping,
 * re-scoping, merging, and deleting one need `manage`. The split is not arbitrary: adding
 * vocabulary is cheap and reversible, while restructuring or destroying vocabulary the whole
 * workspace already depends on is neither. Gating *creation* on `manage` would also break the
 * feature's hot path — labels are mostly born inline from a picker, mid-thought, by whoever is
 * doing the work.
 */
import { db, label, labelGroup } from '@docket/db';
import {
  LabelCreate,
  LabelGroupCreate,
  LabelGroupOut,
  LabelGroupUpdate,
  LabelMerge,
  LabelOut,
  LabelUpdate,
  nextLabelColor,
  normalizeLabelName,
  pageOf,
} from '@docket/types';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { ConflictError, NotFoundError } from '../error';
import { labelUsageCounts, mergeLabelAttachments } from '../lib/labels';
import { ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { zJson, zParam, zQuery } from '../lib/validate';
import { capabilityGuard } from '../permissions/capability-guard';
import { enqueueSearchDelete, enqueueSearchUpsert } from '../search/write-through';

type LabelRow = typeof label.$inferSelect;
type LabelGroupRow = typeof labelGroup.$inferSelect;

function toOut(l: LabelRow, usageCount?: number): z.input<typeof LabelOut> {
  return {
    id: l.id,
    organizationId: l.organizationId,
    name: l.name,
    color: l.color,
    groupId: l.groupId,
    teamId: l.teamId,
    ...(usageCount === undefined ? {} : { usageCount }),
    external: l.externalId != null,
    createdAt: l.createdAt.toISOString(),
  };
}

function groupToOut(g: LabelGroupRow): z.input<typeof LabelGroupOut> {
  return {
    id: g.id,
    organizationId: g.organizationId,
    name: g.name,
    exclusive: g.exclusive,
    sortOrder: g.sortOrder,
    teamId: g.teamId,
    createdAt: g.createdAt.toISOString(),
  };
}

const idParam = z.object({ id: z.string() });
const listQuery = z.object({
  withCounts: z
    .enum(['0', '1'])
    .optional()
    .describe('Set to `1` to include `usageCount` on every label.'),
});

/**
 * Resolve a group id within the org, returning the row.
 *
 * @throws {NotFoundError} When the group is unknown or belongs to another org.
 */
async function requireGroup(orgId: string, groupId: string): Promise<LabelGroupRow> {
  const rows = await db
    .select()
    .from(labelGroup)
    .where(and(eq(labelGroup.id, groupId), eq(labelGroup.organizationId, orgId)))
    .limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError('Label group not found');
  return row;
}

/** Labels router: org-scoped CRUD, merge, and label groups. */
const labels = new Hono<AppEnv>()
  .get(
    '/',
    apiDoc({
      tag: 'Labels',
      summary: 'List labels',
      response: pageOf(LabelOut),
      description: `List every label defined in the org — both workspace-wide labels (\`teamId\` null, offered everywhere) and team-limited labels (\`teamId\` set, offered only inside that team). Labels are Docket's one open-ended dimension: freely-applied tags used to classify and filter work (e.g. \`bug\`, \`design\`, \`needs-triage\`), orthogonal to workflow state and priority. Pass \`withCounts=1\` to include \`usageCount\` (total attachments across tasks, projects, initiatives, programs, and library resources) — this is what powers the settings page's counts and its "Unused" section. The list is unpaginated: labels are a small, bounded set per org. Requires org membership (\`view\`). Returns a page wrapper of {@link LabelOut}.`,
    }),
    zQuery(listQuery),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { withCounts } = c.req.valid('query');
      const rows = await db.select().from(label).where(eq(label.organizationId, orgId));
      if (withCounts !== '1') {
        return ok(c, pageOf(LabelOut), { items: rows.map((r) => toOut(r)) });
      }
      const counts = await labelUsageCounts(orgId);
      return ok(c, pageOf(LabelOut), {
        items: rows.map((r) => toOut(r, counts.get(r.id) ?? 0)),
      });
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
      description: `Create a label in the org. Requires \`contribute\` — not \`manage\` — because labels are mostly born inline from a picker by whoever is doing the work, and an admin gate there would defeat the affordance. Every label is created **workspace-wide**; narrowing it to a team is a later curation step via PATCH, so the create path never asks about org topology. \`color\` is optional: omit it and the server assigns the next palette token by rotation, which is why inline creation can be a single keystroke. \`name\` is matched case-insensitively against existing labels and a collision 409s, so \`Bug\` cannot become a near-duplicate beside \`bug\`. The \`organizationId\` is always derived from the verified context, never the body. Returns the created {@link LabelOut}.`,
    }),
    zJson(LabelCreate),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const body = c.req.valid('json');
      const name = body.name.trim().replace(/\s+/g, ' ');

      if (body.groupId) {
        const group = await requireGroup(orgId, body.groupId);
        // A group and its labels share one scope; a label is born workspace-wide, so a
        // team-limited group cannot take it without silently splitting the dimension.
        if (group.teamId !== null) {
          throw new ConflictError(
            'A new label is workspace-wide and cannot join a team-limited group',
          );
        }
      }

      const existing = await db
        .select({ id: label.id, name: label.name })
        .from(label)
        .where(eq(label.organizationId, orgId));
      const normalized = normalizeLabelName(name);
      if (existing.some((l) => normalizeLabelName(l.name) === normalized)) {
        throw new ConflictError('A label with that name already exists');
      }

      const inserted = await db
        .insert(label)
        .values({
          organizationId: orgId,
          name,
          color: body.color ?? nextLabelColor(existing.length),
          groupId: body.groupId ?? null,
        })
        .returning();
      const row = inserted[0];
      /* v8 ignore next -- @preserve defensive: insert/update always returns a row */
      if (!row) throw new Error('label insert returned no row');
      await enqueueSearchUpsert(orgId, 'label', row.id);
      return ok(c, LabelOut, toOut(row, 0));
    },
  )
  // Registered before `/:id` so the literal path is not swallowed by the parameter.
  .get(
    '/groups',
    apiDoc({
      tag: 'Labels',
      summary: 'List label groups',
      response: pageOf(LabelGroupOut),
      description: `List the org's label groups. A group is a named set of related labels and the only place *exclusivity* is recorded: when \`exclusive\` is true (the default), applying one member releases every other member, which is how an org expresses a single-select dimension like \`Type\` or \`Stage\` without Docket growing a custom-field engine. A non-exclusive group is purely visual clustering. Requires org membership (\`view\`). Returns a page wrapper of {@link LabelGroupOut}.`,
    }),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const rows = await db
        .select()
        .from(labelGroup)
        .where(eq(labelGroup.organizationId, orgId))
        .orderBy(labelGroup.sortOrder, labelGroup.name);
      return ok(c, pageOf(LabelGroupOut), { items: rows.map(groupToOut) });
    },
  )
  .post(
    '/groups',
    capabilityGuard('manage'),
    apiDoc({
      tag: 'Labels',
      summary: 'Create a label group',
      capability: 'manage',
      response: LabelGroupOut,
      description: `Create a label group. Requires \`manage\`: unlike creating a single label, defining a group declares a *dimension* for the whole workspace, which is a structural decision rather than an in-the-flow one. \`exclusive\` defaults to true — a group whose members can all coexist is just visual clustering, so the stronger meaning is the default and the weaker one an explicit opt-out. Returns the created {@link LabelGroupOut}.`,
    }),
    zJson(LabelGroupCreate),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const body = c.req.valid('json');
      const inserted = await db
        .insert(labelGroup)
        .values({
          organizationId: orgId,
          name: body.name.trim(),
          exclusive: body.exclusive ?? true,
          sortOrder: body.sortOrder ?? 0,
        })
        .returning();
      const row = inserted[0];
      /* v8 ignore next -- @preserve defensive: insert always returns a row */
      if (!row) throw new Error('label group insert returned no row');
      return ok(c, LabelGroupOut, groupToOut(row));
    },
  )
  .patch(
    '/groups/:id',
    capabilityGuard('manage'),
    apiDoc({
      tag: 'Labels',
      summary: 'Update a label group',
      capability: 'manage',
      response: LabelGroupOut,
      description: `Partially update a label group; only the fields present in the body change. Requires \`manage\`. Turning \`exclusive\` on does **not** retroactively strip subjects that already carry two members — it governs writes from that point forward, because silently detaching labels across the workspace is not something a settings toggle should do. Re-scoping via \`teamId\` moves the group's members with it, since a group and its labels must share one scope. Returns the updated {@link LabelGroupOut}.`,
    }),
    zParam(idParam),
    zJson(LabelGroupUpdate),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const body = c.req.valid('json');
      const patch = {
        ...(body.name !== undefined ? { name: body.name.trim() } : {}),
        ...(body.exclusive !== undefined ? { exclusive: body.exclusive } : {}),
        ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
        ...(body.teamId !== undefined ? { teamId: body.teamId } : {}),
      };
      const where = and(eq(labelGroup.id, id), eq(labelGroup.organizationId, orgId));
      if (Object.keys(patch).length === 0) {
        const rows = await db.select().from(labelGroup).where(where).limit(1);
        const existing = rows[0];
        if (!existing) throw new NotFoundError('Label group not found');
        return ok(c, LabelGroupOut, groupToOut(existing));
      }

      const row = await db.transaction(async (tx) => {
        const updated = await tx.update(labelGroup).set(patch).where(where).returning();
        const changed = updated[0];
        if (!changed) return undefined;
        // Members follow the group's scope, so the two can never disagree.
        if (body.teamId !== undefined) {
          await tx
            .update(label)
            .set({ teamId: body.teamId })
            .where(and(eq(label.groupId, id), eq(label.organizationId, orgId)));
        }
        return changed;
      });
      if (!row) throw new NotFoundError('Label group not found');
      return ok(c, LabelGroupOut, groupToOut(row));
    },
  )
  .delete(
    '/groups/:id',
    capabilityGuard('manage'),
    apiDoc({
      tag: 'Labels',
      summary: 'Delete a label group',
      capability: 'manage',
      response: LabelGroupOut,
      description: `Delete a label group. Requires \`manage\`. The group's **labels survive** and become ungrouped (\`group_id\` nulls out via \`on delete set null\`) — dissolving a dimension must never silently delete the vocabulary inside it, or a mis-click would strip labels off every entity carrying them. Returns the deleted {@link LabelGroupOut}.`,
    }),
    zParam(idParam),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const deleted = await db
        .delete(labelGroup)
        .where(and(eq(labelGroup.id, id), eq(labelGroup.organizationId, orgId)))
        .returning();
      const row = deleted[0];
      if (!row) throw new NotFoundError('Label group not found');
      return ok(c, LabelGroupOut, groupToOut(row));
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
    capabilityGuard('manage'),
    apiDoc({
      tag: 'Labels',
      summary: 'Update a label',
      capability: 'manage',
      response: LabelOut,
      description: `Partially update a label (\`name\`, \`color\`, \`groupId\`, \`teamId\`). Requires \`manage\`, unlike creation: renaming or recoloring changes vocabulary the whole workspace already reads. Setting \`teamId\` limits the label to one team and is **non-destructive** — subjects outside that team keep the label, it simply stops being offered to them; setting it to null promotes the label back to workspace-wide, which is how a label mirrored from a connected tool gets adopted. Setting \`groupId\` to null removes the label from its group. A rename that collides with an existing name 409s; the client's move there is to offer a merge (\`POST /:id/merge\`) rather than a second attempt. The lookup is org-scoped, so a cross-org/unknown id 404s. Returns the updated {@link LabelOut}.`,
    }),
    zParam(idParam),
    zJson(LabelUpdate),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const body = c.req.valid('json');

      if (body.name !== undefined) {
        const normalized = normalizeLabelName(body.name);
        const siblings = await db
          .select({ id: label.id, name: label.name })
          .from(label)
          .where(eq(label.organizationId, orgId));
        if (siblings.some((l) => l.id !== id && normalizeLabelName(l.name) === normalized)) {
          throw new ConflictError('A label with that name already exists');
        }
      }

      // A group and its labels must share one scope, so joining a group adopts its scope.
      let adoptedTeamId: string | null | undefined;
      if (body.groupId != null) {
        adoptedTeamId = (await requireGroup(orgId, body.groupId)).teamId;
      }

      const patch = {
        ...(body.name !== undefined ? { name: body.name.trim().replace(/\s+/g, ' ') } : {}),
        ...(body.color !== undefined ? { color: body.color } : {}),
        ...(body.groupId !== undefined ? { groupId: body.groupId } : {}),
        ...(body.teamId !== undefined
          ? { teamId: body.teamId }
          : adoptedTeamId !== undefined
            ? { teamId: adoptedTeamId }
            : {}),
      };
      const where = and(eq(label.id, id), eq(label.organizationId, orgId));
      if (Object.keys(patch).length === 0) {
        const rows = await db.select().from(label).where(where).limit(1);
        const existing = rows[0];
        if (!existing) throw new NotFoundError('Label not found');
        return ok(c, LabelOut, toOut(existing));
      }

      const updated = await db.update(label).set(patch).where(where).returning();
      const row = updated[0];
      if (!row) throw new NotFoundError('Label not found');
      await enqueueSearchUpsert(orgId, 'label', row.id);
      return ok(c, LabelOut, toOut(row));
    },
  )
  .post(
    '/:id/merge',
    capabilityGuard('manage'),
    apiDoc({
      tag: 'Labels',
      summary: 'Merge a label into another',
      capability: 'manage',
      response: LabelOut,
      description: `Dissolve this label into \`intoId\`: every attachment across tasks, projects, initiatives, programs, and library resources is reassigned to the surviving label, then this one is deleted. Requires \`manage\`. The whole operation is one transaction, so a failure leaves the taxonomy exactly as it was. A subject already carrying both labels collapses to a single attachment rather than erroring. This is the affordance that makes importing from a connected tool survivable — a mirrored label set arrives with duplicates nobody chose, and re-tagging them by hand is not a real option. Merging a label into itself 422s. Returns the surviving {@link LabelOut}.`,
    }),
    zParam(idParam),
    zJson(LabelMerge),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const { intoId } = c.req.valid('json');
      if (id === intoId) throw new ConflictError('A label cannot be merged into itself');

      const rows = await db.select().from(label).where(eq(label.organizationId, orgId));
      const source = rows.find((r) => r.id === id);
      const target = rows.find((r) => r.id === intoId);
      if (!source || !target) throw new NotFoundError('Label not found');

      await db.transaction(async (tx) => {
        await mergeLabelAttachments(tx, orgId, id, intoId);
      });
      await enqueueSearchDelete(orgId, 'label', id);
      await enqueueSearchUpsert(orgId, 'label', intoId);
      return ok(c, LabelOut, toOut(target));
    },
  )
  .delete(
    '/:id',
    capabilityGuard('manage'),
    apiDoc({
      tag: 'Labels',
      summary: 'Delete a label',
      capability: 'manage',
      response: LabelOut,
      description: `Hard-delete a label from the org. Requires \`manage\`. This removes the label definition itself and every attachment to it cascades away (a label is a tag, not a row that owns work) — no work is deleted. Clients should show the label's \`usageCount\` in the confirmation, since the count is the only signal of how much this will change. To retire a duplicate without losing its attachments, use \`POST /:id/merge\` instead. The lookup is org-scoped, so a cross-org/unknown id 404s. Unusually for a delete, this returns the full deleted {@link LabelOut} row (not a bare acknowledgement) so the client can confirm exactly what was removed.`,
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
