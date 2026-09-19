import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';
import type { PlanCommitOut, PlanDraftOut } from '@docket/work/plan-draft-contract';
import { eq } from 'drizzle-orm';

import {
  addMember,
  appWithSession,
  fakeSession,
  getDb,
  seedBaseOrg,
  seedInitiative,
  seedProject,
  seedUserWithHub,
} from '../support/routes-harness';
import type mePlansRouter from '../../src/routes/me-plans';
import type meAthenaChangesRouter from '../../src/routes/me-athena-undo';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let router!: typeof mePlansRouter;
let undoRouter!: typeof meAthenaChangesRouter;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  router = (await import('../../src/routes/me-plans')).default;
  undoRouter = (await import('../../src/routes/me-athena-undo')).default;
});

const J = { 'content-type': 'application/json' };
async function body<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

/** An org with one member whose actor is linked to a real user, plus a second unrelated user. */
async function seedOwner() {
  const base = await seedBaseOrg(db, schema);
  const ownerUserId = await seedUserWithHub(db, schema, 'Owner');
  const humanActorId = await addMember(db, schema, base.orgId, ownerUserId, 'owner');
  await db.insert(schema.teamMember).values({
    organizationId: base.orgId,
    teamId: base.teamId,
    actorId: humanActorId,
  });
  await db.insert(schema.grant).values({
    organizationId: base.orgId,
    subjectKind: 'actor',
    subjectId: humanActorId,
    resourceKind: 'organization',
    resourceId: base.orgId,
    capabilities: ['contribute'],
    effect: 'allow',
    cascades: true,
  });
  const strangerUserId = await seedUserWithHub(db, schema, 'Stranger');
  return {
    ...base,
    humanActorId,
    ownerUserId,
    strangerUserId,
    app: appWithSession(router, fakeSession(ownerUserId)),
    strangerApp: appWithSession(router, fakeSession(strangerUserId)),
    undoApp: appWithSession(undoRouter, fakeSession(ownerUserId)),
    strangerUndoApp: appWithSession(undoRouter, fakeSession(strangerUserId)),
  };
}

async function startPlan(
  app: ReturnType<typeof appWithSession>,
  orgId: string,
  initiativeId?: string,
): Promise<PlanDraftOut> {
  const res = await app.request('/', {
    method: 'POST',
    headers: J,
    body: JSON.stringify({ organizationId: orgId, ...(initiativeId ? { initiativeId } : {}) }),
  });
  expect(res.status).toBe(201);
  return body<PlanDraftOut>(res);
}

const SEED_OPS = [
  { op: 'upsert_node', node: { ref: 'init', kind: 'initiative', fields: { title: 'Spring' } } },
  {
    op: 'upsert_node',
    node: { ref: 'p1', kind: 'project', parentRef: 'init', fields: { title: 'Outreach' } },
  },
  {
    op: 'upsert_node',
    node: { ref: 't1', kind: 'task', parentRef: 'p1', fields: { title: 'Segment donors' } },
  },
];

/** The seed tree plus a feature task carrying one engineering subtask. */
const SUBTASK_OPS = [
  ...SEED_OPS,
  {
    op: 'upsert_node',
    node: { ref: 'f1', kind: 'task', parentRef: 'p1', fields: { title: 'Mood entry' } },
  },
  {
    op: 'upsert_node',
    node: { ref: 's1', kind: 'task', parentRef: 'f1', fields: { title: 'Add the endpoint' } },
  },
];

/** Start a plan and draft the subtask tree into it, returning the plan id. */
async function draftSubtaskPlan(
  app: ReturnType<typeof appWithSession>,
  orgId: string,
): Promise<string> {
  const plan = await startPlan(app, orgId);
  await app.request(`/${plan.id}`, {
    method: 'PATCH',
    headers: J,
    body: JSON.stringify({ revision: 0, ops: SUBTASK_OPS }),
  });
  return plan.id;
}

async function commitRefs(
  app: ReturnType<typeof appWithSession>,
  planId: string,
  refs: readonly string[],
): Promise<PlanCommitOut> {
  return body<PlanCommitOut>(
    await app.request(`/${planId}/commit`, {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ refs }),
    }),
  );
}

/** The parent task and project a committed node's real task row carries. */
async function taskParentage(
  result: PlanCommitOut,
  ref: string,
): Promise<{ parentTaskId: string | null; projectId: string | null } | undefined> {
  const [row] = await db
    .select({ parentTaskId: schema.task.parentTaskId, projectId: schema.task.projectId })
    .from(schema.task)
    .where(eq(schema.task.id, result.placed.find((item) => item.ref === ref)?.id ?? ''));
  return row;
}

/** A work table an undo archives rows in. */
type ArchivableTable = typeof DbModule.task | typeof DbModule.project | typeof DbModule.initiative;

/** Whether the workspace holds rows of that kind and every one of them is archived. */
async function allArchived(table: ArchivableTable, orgId: string): Promise<boolean> {
  const rows = await db
    .select({ archivedAt: table.archivedAt })
    .from(table)
    .where(eq(table.organizationId, orgId));
  return rows.length > 0 && rows.every((row) => row.archivedAt !== null);
}

describe('/v1/me/plans', () => {
  it('starts an empty plan in a workspace the caller belongs to', async () => {
    const { app, orgId } = await seedOwner();
    const plan = await startPlan(app, orgId);
    expect(plan.status).toBe('active');
    expect(plan.revision).toBe(0);
    expect(plan.document).toEqual({ nodes: [], edges: [] });
    expect(plan.organizationId).toBe(orgId);
  });

  it('refuses a workspace the caller is not a member of', async () => {
    const { strangerApp, orgId } = await seedOwner();
    const res = await strangerApp.request('/', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ organizationId: orgId }),
    });
    expect(res.status).toBe(404);
  });

  it('roots a plan on an existing initiative once and reopens it after', async () => {
    const { app, orgId, statusId } = await seedOwner();
    const root = await seedInitiative(db, schema, statusId, {
      organizationId: orgId,
      name: 'Spring giving',
    });
    const first = await startPlan(app, orgId, root.id);
    expect(first.rootInitiativeId).toBe(root.id);
    expect(first.title).toBe('Spring giving');
    expect(first.document.nodes).toHaveLength(1);
    expect(first.document.nodes[0]).toMatchObject({
      ref: 'root',
      kind: 'initiative',
      status: 'confirmed',
      objectId: root.id,
    });
    expect(first.objects['root']?.name).toBe('Spring giving');
    const second = await startPlan(app, orgId, root.id);
    expect(second.id).toBe(first.id);
  });

  it('hides another user’s plan from reads, edits, and archive', async () => {
    const { app, strangerApp, orgId } = await seedOwner();
    const plan = await startPlan(app, orgId);
    expect((await strangerApp.request(`/${plan.id}`)).status).toBe(404);
    expect(
      (
        await strangerApp.request(`/${plan.id}`, {
          method: 'PATCH',
          headers: J,
          body: JSON.stringify({ revision: 0, ops: [{ op: 'set_title', title: 'Mine' }] }),
        })
      ).status,
    ).toBe(404);
    expect((await strangerApp.request(`/${plan.id}/archive`, { method: 'POST' })).status).toBe(404);
    const list = await body<{ items: PlanDraftOut[] }>(await strangerApp.request('/'));
    expect(list.items).toHaveLength(0);
  });

  it('applies a batch, renames through set_title, and bumps the revision', async () => {
    const { app, orgId } = await seedOwner();
    const plan = await startPlan(app, orgId);
    const res = await app.request(`/${plan.id}`, {
      method: 'PATCH',
      headers: J,
      body: JSON.stringify({
        revision: 0,
        ops: [...SEED_OPS, { op: 'set_title', title: 'Spring campaign' }],
      }),
    });
    expect(res.status).toBe(200);
    const next = await body<PlanDraftOut>(res);
    expect(next.revision).toBe(1);
    expect(next.title).toBe('Spring campaign');
    expect(next.document.nodes.map((node) => node.ref)).toEqual(['init', 'p1', 't1']);
    const listed = await body<{ items: PlanDraftOut[] }>(await app.request('/'));
    expect(listed.items.map((item) => item.id)).toContain(plan.id);
  });

  it('refuses a stale revision with 412', async () => {
    const { app, orgId } = await seedOwner();
    const plan = await startPlan(app, orgId);
    await app.request(`/${plan.id}`, {
      method: 'PATCH',
      headers: J,
      body: JSON.stringify({ revision: 0, ops: SEED_OPS }),
    });
    const stale = await app.request(`/${plan.id}`, {
      method: 'PATCH',
      headers: J,
      body: JSON.stringify({ revision: 0, ops: [{ op: 'set_title', title: 'Late' }] }),
    });
    expect(stale.status).toBe(412);
    expect((await body<{ code: string }>(stale)).code).toBe('precondition_failed');
  });

  it('reports a rejected op as 422 naming its path', async () => {
    const { app, orgId } = await seedOwner();
    const plan = await startPlan(app, orgId);
    const res = await app.request(`/${plan.id}`, {
      method: 'PATCH',
      headers: J,
      body: JSON.stringify({
        revision: 0,
        ops: [{ op: 'set_fields', ref: 'nope', fields: { summary: 'x' } }],
      }),
    });
    expect(res.status).toBe(422);
    const problem = await body<{ fieldErrors: Record<string, unknown[]> }>(res);
    expect(Object.keys(problem.fieldErrors)).toEqual(['ops.0.ref']);
    const unchanged = await body<PlanDraftOut>(await app.request(`/${plan.id}`));
    expect(unchanged.revision).toBe(0);
  });

  it('applies a visible template and refuses one from another workspace', async () => {
    const { app, orgId, humanActorId } = await seedOwner();
    const other = await seedBaseOrg(db, schema);
    const [mine] = await db
      .insert(schema.template)
      .values({
        organizationId: orgId,
        targetType: 'project',
        name: 'Campaign',
        scope: 'organization',
        ownerActorId: humanActorId,
        payload: { targetType: 'project', summary: 'From the template', description: '## Goal' },
      })
      .returning({ id: schema.template.id });
    const [theirs] = await db
      .insert(schema.template)
      .values({
        organizationId: other.orgId,
        targetType: 'project',
        name: 'Elsewhere',
        scope: 'organization',
        ownerActorId: other.humanActorId,
        payload: { targetType: 'project', summary: 'Should not apply' },
      })
      .returning({ id: schema.template.id });
    if (!mine || !theirs) throw new Error('template seeding failed');
    const plan = await startPlan(app, orgId);
    const applied = await app.request(`/${plan.id}`, {
      method: 'PATCH',
      headers: J,
      body: JSON.stringify({
        revision: 0,
        ops: [...SEED_OPS, { op: 'apply_template', ref: 'p1', templateId: mine.id }],
      }),
    });
    expect(applied.status).toBe(200);
    const next = await body<PlanDraftOut>(applied);
    const p1 = next.document.nodes.find((node) => node.ref === 'p1');
    expect(p1?.fields.summary).toBe('From the template');
    expect(p1?.templateId).toBe(mine.id);
    const refused = await app.request(`/${plan.id}`, {
      method: 'PATCH',
      headers: J,
      body: JSON.stringify({
        revision: next.revision,
        ops: [{ op: 'apply_template', ref: 'p1', templateId: theirs.id }],
      }),
    });
    expect(refused.status).toBe(422);
  });

  it('archives a plan and lets a new one start on the same root', async () => {
    const { app, orgId, statusId } = await seedOwner();
    const root = await seedInitiative(db, schema, statusId, {
      organizationId: orgId,
      name: 'Rooted',
    });
    const plan = await startPlan(app, orgId, root.id);
    const archived = await body<PlanDraftOut>(
      await app.request(`/${plan.id}/archive`, { method: 'POST' }),
    );
    expect(archived.status).toBe('archived');
    expect((await app.request(`/${plan.id}/archive`, { method: 'POST' })).status).toBe(200);
    const edit = await app.request(`/${plan.id}`, {
      method: 'PATCH',
      headers: J,
      body: JSON.stringify({ revision: 0, ops: [{ op: 'set_title', title: 'Late' }] }),
    });
    expect(edit.status).toBe(404);
    const fresh = await startPlan(app, orgId, root.id);
    expect(fresh.id).not.toBe(plan.id);
  });

  describe('commit', () => {
    it('creates the closure parents-first, links initiatives, and writes ids back', async () => {
      const { app, orgId, statusId } = await seedOwner();
      const existingInitiative = await seedInitiative(db, schema, statusId, {
        organizationId: orgId,
        name: 'Brand refresh',
      });
      const plan = await startPlan(app, orgId);
      const drafted = await body<PlanDraftOut>(
        await app.request(`/${plan.id}`, {
          method: 'PATCH',
          headers: J,
          body: JSON.stringify({
            revision: 0,
            ops: [
              ...SEED_OPS,
              {
                op: 'upsert_node',
                node: {
                  ref: 'p2',
                  kind: 'project',
                  parentRef: 'init',
                  initiativeIds: [existingInitiative.id],
                  fields: { title: 'Push' },
                },
              },
              { op: 'add_edge', fromRef: 'p1', toRef: 'p2' },
            ],
          }),
        }),
      );
      expect(drafted.revision).toBe(1);
      const res = await app.request(`/${plan.id}/commit`, {
        method: 'POST',
        headers: J,
        body: JSON.stringify({ refs: ['t1', 'p2'] }),
      });
      expect(res.status).toBe(200);
      const result = await body<PlanCommitOut>(res);
      expect(result.placed.map((item) => item.ref)).toEqual(['init', 'p1', 't1', 'p2']);
      expect(result.placed.every((item) => item.created)).toBe(true);
      expect(result.changeSetId).not.toBeNull();
      expect(result.plan.revision).toBe(2);
      expect(result.plan.status).toBe('committed');
      for (const ref of ['init', 'p1', 't1', 'p2']) {
        const node = result.plan.document.nodes.find((entry) => entry.ref === ref);
        expect(node?.status).toBe('confirmed');
        expect(node?.objectId).not.toBeNull();
        expect(result.plan.objects[ref]?.href).toContain(`/orgs/${orgId}/`);
      }
      const p1Id = result.placed.find((item) => item.ref === 'p1')?.id ?? '';
      const p2Id = result.placed.find((item) => item.ref === 'p2')?.id ?? '';
      const initId = result.placed.find((item) => item.ref === 'init')?.id ?? '';
      const links = await db
        .select()
        .from(schema.initiativeProject)
        .where(eq(schema.initiativeProject.projectId, p2Id));
      expect(links.map((link) => link.initiativeId).sort()).toEqual(
        [initId, existingInitiative.id].sort(),
      );
      const deps = await db
        .select()
        .from(schema.projectDependency)
        .where(eq(schema.projectDependency.blockedProjectId, p2Id));
      expect(deps.map((dep) => dep.blockingProjectId)).toEqual([p1Id]);
      const taskRows = await db
        .select({ projectId: schema.task.projectId })
        .from(schema.task)
        .where(eq(schema.task.organizationId, orgId));
      expect(taskRows.map((row) => row.projectId)).toEqual([p1Id]);
    });

    it('matches an existing project by name instead of duplicating it', async () => {
      const { app, orgId, statusId, teamId } = await seedOwner();
      await seedProject(db, schema, statusId, {
        organizationId: orgId,
        teamId,
        name: 'Outreach',
      });
      const plan = await startPlan(app, orgId);
      await app.request(`/${plan.id}`, {
        method: 'PATCH',
        headers: J,
        body: JSON.stringify({ revision: 0, ops: SEED_OPS }),
      });
      const result = await body<PlanCommitOut>(
        await app.request(`/${plan.id}/commit`, {
          method: 'POST',
          headers: J,
          body: JSON.stringify({ refs: ['p1'] }),
        }),
      );
      expect(result.placed.find((item) => item.ref === 'p1')?.created).toBe(false);
      expect(result.plan.status).toBe('active');
      const t1 = result.plan.document.nodes.find((node) => node.ref === 't1');
      expect(t1?.status).toBe('draft');
    });

    it('refuses to commit when the caller cannot contribute, with application copy', async () => {
      const { app, orgId } = await seedOwner();
      const plan = await startPlan(app, orgId);
      await app.request(`/${plan.id}`, {
        method: 'PATCH',
        headers: J,
        body: JSON.stringify({ revision: 0, ops: SEED_OPS }),
      });
      await db
        .update(schema.actor)
        .set({ status: 'suspended' })
        .where(eq(schema.actor.organizationId, orgId));
      const res = await app.request(`/${plan.id}/commit`, {
        method: 'POST',
        headers: J,
        body: JSON.stringify({ refs: ['init'] }),
      });
      expect([403, 404]).toContain(res.status);
    });

    it('creates a task under a task as its subtask, in the parent’s project', async () => {
      const { app, orgId } = await seedOwner();
      const planId = await draftSubtaskPlan(app, orgId);
      const result = await commitRefs(app, planId, ['s1']);
      expect(result.placed.map((item) => item.ref)).toEqual(['init', 'p1', 'f1', 's1']);
      expect(result.createdCounts).toEqual({ initiatives: 1, projects: 1, tasks: 1, subtasks: 1 });
      expect(await taskParentage(result, 's1')).toEqual({
        parentTaskId: result.placed.find((item) => item.ref === 'f1')?.id,
        projectId: result.placed.find((item) => item.ref === 'p1')?.id,
      });
    });

    it('hangs a subtask off a feature task confirmed by an earlier commit', async () => {
      const { app, orgId } = await seedOwner();
      const planId = await draftSubtaskPlan(app, orgId);
      const first = await commitRefs(app, planId, ['f1']);
      const second = await commitRefs(app, planId, ['s1']);
      expect(second.placed.map((item) => item.ref)).toEqual(['s1']);
      expect(second.createdCounts).toEqual({ initiatives: 0, projects: 0, tasks: 0, subtasks: 1 });
      expect(await taskParentage(second, 's1')).toEqual({
        parentTaskId: first.placed.find((item) => item.ref === 'f1')?.id,
        projectId: first.placed.find((item) => item.ref === 'p1')?.id,
      });
    });

    it('lets the owner undo their own commit, and hides it from everyone else', async () => {
      const { app, undoApp, strangerUndoApp, orgId } = await seedOwner();
      const planId = await draftSubtaskPlan(app, orgId);
      const changeSetId = (await commitRefs(app, planId, ['s1'])).changeSetId ?? '';
      expect(changeSetId).not.toBe('');
      const refused = await strangerUndoApp.request(`/${changeSetId}/undo`, { method: 'POST' });
      expect(refused.status).toBe(404);
      const undone = await undoApp.request(`/${changeSetId}/undo`, { method: 'POST' });
      expect(undone.status).toBe(200);
      expect(await allArchived(schema.task, orgId)).toBe(true);
      expect(await allArchived(schema.project, orgId)).toBe(true);
      expect(await allArchived(schema.initiative, orgId)).toBe(true);
    });

    it('rejects an empty closure', async () => {
      const { app, orgId, statusId } = await seedOwner();
      const root = await seedInitiative(db, schema, statusId, {
        organizationId: orgId,
        name: 'Rooted',
      });
      const plan = await startPlan(app, orgId, root.id);
      const res = await app.request(`/${plan.id}/commit`, {
        method: 'POST',
        headers: J,
        body: JSON.stringify({ refs: ['root', 'nope'] }),
      });
      expect(res.status).toBe(422);
    });
  });
});
