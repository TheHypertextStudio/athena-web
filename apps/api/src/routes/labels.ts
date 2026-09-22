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
} from '@docket/work/label-contract';
import { CursorQuery, pageOf } from '../contracts/pagination';
import { and, asc, eq, gt, or, type SQL } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { ConflictError, NotFoundError, ValidationError } from '../error';
import {
  createLabel,
  createLabelGroup,
  requireLabel,
  toLabelGroupOut as groupToOut,
  toLabelOut as toOut,
  updateLabel,
  updateLabelGroup,
} from '../lib/label-catalog';
import { labelUsageCounts, mergeLabelAttachments } from '../lib/labels';
import { created, ok } from '../lib/ok';
import {
  decodeTupleCursor,
  pageResultById,
  pageResultByTuple,
  seekAfterId,
} from '../lib/list-cursor';
import { apiDoc } from '../lib/openapi-route';
import { zJson, zParam, zQuery } from '../lib/validate';
import { capabilityGuard } from '../permissions/capability-guard';
import { enqueueSearchDelete, enqueueSearchUpsert } from '../search/write-through';

const idParam = z.object({ id: z.string() });
const listQuery = CursorQuery.extend({
  withCounts: z
    .enum(['0', '1'])
    .optional()
    .describe('Set to `1` to include `usageCount` on every label.'),
});

function labelGroupSeek(cursor: string | undefined): SQL | undefined {
  const boundary = decodeTupleCursor(cursor);
  if (!boundary) return undefined;
  if (
    boundary.length !== 3 ||
    typeof boundary[0] !== 'number' ||
    !Number.isInteger(boundary[0]) ||
    typeof boundary[1] !== 'string' ||
    typeof boundary[2] !== 'string'
  ) {
    throw new ValidationError([{ path: ['cursor'], message: 'The cursor is invalid or expired.' }]);
  }
  const [sortOrder, name, id] = boundary as [number, string, string];
  return or(
    gt(labelGroup.sortOrder, sortOrder),
    and(
      eq(labelGroup.sortOrder, sortOrder),
      or(gt(labelGroup.name, name), and(eq(labelGroup.name, name), gt(labelGroup.id, id))),
    ),
  );
}

/** Labels router: org-scoped CRUD, merge, and label groups. */
const labels = new Hono<AppEnv>()
  .get(
    '/',
    apiDoc({
      tag: 'Labels',
      summary: 'List labels',
      response: pageOf(LabelOut),
      description: `List workspace-wide and team-specific labels. A workspace-wide label has \`teamId: null\` and may be used anywhere. A team-specific label may be used only for work in that team. Labels classify and filter work independently from workflow state and priority.

Results use stable label-ID order. The default page size is 50 and the maximum is 100. The final page omits \`nextCursor\`. Reuse a cursor only with the same \`withCounts\` value. Set \`withCounts=1\` to include each label's total \`usageCount\` across supported resource types.`,
    }),
    zQuery(listQuery),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { cursor, limit, withCounts } = c.req.valid('query');
      const rows = await db
        .select()
        .from(label)
        .where(and(eq(label.organizationId, orgId), seekAfterId(label.id, cursor, 'asc')))
        .orderBy(asc(label.id))
        .limit(limit + 1);
      if (withCounts !== '1') {
        return ok(
          c,
          pageOf(LabelOut),
          pageResultById(
            rows.map((r) => toOut(r)),
            limit,
          ),
        );
      }
      const counts = await labelUsageCounts(orgId);
      return ok(
        c,
        pageOf(LabelOut),
        pageResultById(
          rows.map((r) => toOut(r, counts.get(r.id) ?? 0)),
          limit,
        ),
      );
    },
  )
  .post(
    '/',
    capabilityGuard('contribute'),
    apiDoc({
      status: 201,
      tag: 'Labels',
      summary: 'Create a label',
      capability: 'contribute',
      response: LabelOut,
      description: `Create a workspace-wide label. Requires \`contribute\`. Omit \`color\` to let Docket choose the next palette color. Label names are unique without regard to letter case, so creating \`Bug\` when \`bug\` exists returns 409. Use the update operation to limit a label to a team later. Returns the created {@link LabelOut}.`,
    }),
    zJson(LabelCreate),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const body = c.req.valid('json');
      // A REST label is born workspace-wide, so a team-limited group refuses it rather than
      // silently splitting the dimension.
      const row = await createLabel(orgId, { ...body, teamId: null });
      return created(c, LabelOut, toOut(row, 0), null);
    },
  )
  // Registered before `/:id` so the literal path is not swallowed by the parameter.
  .get(
    '/groups',
    apiDoc({
      tag: 'Labels',
      summary: 'List label groups',
      response: pageOf(LabelGroupOut),
      description: `List the org's label groups. A group is a named set of related labels and the only place *exclusivity* is recorded. Results follow \`sortOrder, name, id\`, default to 50 items, accept at most 100, and omit \`nextCursor\` at exhaustion. A non-exclusive group is purely visual clustering. Requires org membership (\`view\`).`,
    }),
    zQuery(CursorQuery),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { cursor, limit } = c.req.valid('query');
      const rows = await db
        .select()
        .from(labelGroup)
        .where(and(eq(labelGroup.organizationId, orgId), labelGroupSeek(cursor)))
        .orderBy(asc(labelGroup.sortOrder), asc(labelGroup.name), asc(labelGroup.id))
        .limit(limit + 1);
      return ok(
        c,
        pageOf(LabelGroupOut),
        pageResultByTuple(rows.map(groupToOut), limit, (item) => [
          item.sortOrder,
          item.name,
          item.id,
        ]),
      );
    },
  )
  .post(
    '/groups',
    capabilityGuard('manage'),
    apiDoc({
      status: 201,
      tag: 'Labels',
      summary: 'Create a label group',
      capability: 'manage',
      response: LabelGroupOut,
      description: `Create a label group. Requires \`manage\`: unlike creating a single label, defining a group declares a *dimension* for the whole workspace, which is a structural decision rather than an in-the-flow one. \`exclusive\` defaults to true — a group whose members can all coexist is just visual clustering, so the stronger meaning is the default and the weaker one an explicit opt-out. Returns the created {@link LabelGroupOut}.`,
    }),
    zJson(LabelGroupCreate),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const row = await createLabelGroup(orgId, c.req.valid('json'));
      return created(c, LabelGroupOut, groupToOut(row), null);
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
      const row = await updateLabelGroup(orgId, id, c.req.valid('json'));
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
      return ok(c, LabelOut, toOut(await requireLabel(orgId, id)));
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
      const row = await updateLabel(orgId, id, c.req.valid('json'));
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
      description: `Move every use of this label to \`intoId\`, delete this label, and return the surviving {@link LabelOut}. The change applies to tasks, projects, initiatives, programs, and library resources. When a resource already has both labels, it keeps one copy of the surviving label.

The merge is all-or-nothing. A failure leaves both labels and their assignments unchanged. Merging a label into itself returns 422.`,
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
      description: `Permanently delete a label and remove it from every attached record. No work is deleted. Requires \`manage\`. Show \`usageCount\` before confirmation so the user can see how many records will change. Use \`POST /:id/merge\` to replace a duplicate label without losing attachments. An absent or inaccessible label returns 404. Returns the deleted {@link LabelOut}.`,
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
