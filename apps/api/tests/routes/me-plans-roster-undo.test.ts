/**
 * The planning canvas's roster read, and what undoing a plan commit leaves on the plan.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';
import type { PlanCommitOut, PlanDraftOut, PlanRoster } from '@docket/work/plan-draft-contract';

import {
  addMember,
  appWithSession,
  fakeSession,
  getDb,
  seedBaseOrg,
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

/** An org whose owner is on its team and may contribute, plus an unrelated user. */
async function seedOwner() {
  const base = await seedBaseOrg(db, schema);
  const ownerUserId = await seedUserWithHub(db, schema, 'Owner');
  const actorId = await addMember(db, schema, base.orgId, ownerUserId, 'owner');
  await db
    .insert(schema.teamMember)
    .values({ organizationId: base.orgId, teamId: base.teamId, actorId });
  await db.insert(schema.grant).values({
    organizationId: base.orgId,
    subjectKind: 'actor',
    subjectId: actorId,
    resourceKind: 'organization',
    resourceId: base.orgId,
    capabilities: ['contribute'],
    effect: 'allow',
    cascades: true,
  });
  const strangerUserId = await seedUserWithHub(db, schema, 'Stranger');
  return {
    orgId: base.orgId,
    teamId: base.teamId,
    actorId,
    app: appWithSession(router, fakeSession(ownerUserId)),
    strangerApp: appWithSession(router, fakeSession(strangerUserId)),
    undoApp: appWithSession(undoRouter, fakeSession(ownerUserId)),
  };
}

/** Start a plan holding a project with a task, and a feature task carrying one subtask. */
async function draftPlan(app: ReturnType<typeof appWithSession>, orgId: string): Promise<string> {
  const started = await app.request('/', {
    method: 'POST',
    headers: J,
    body: JSON.stringify({ organizationId: orgId }),
  });
  const plan = (await started.json()) as PlanDraftOut;
  const upsert = (ref: string, kind: string, parentRef: string | null, title: string) => ({
    op: 'upsert_node',
    node: { ref, kind, parentRef, fields: { title } },
  });
  await app.request(`/${plan.id}`, {
    method: 'PATCH',
    headers: J,
    body: JSON.stringify({
      revision: 0,
      ops: [
        upsert('init', 'initiative', null, 'Journaling launch'),
        upsert('p1', 'project', 'init', 'Mood tracking'),
        upsert('t1', 'task', 'p1', 'Write the copy'),
        upsert('f1', 'task', 'p1', 'Log a mood'),
        upsert('s1', 'task', 'f1', 'Add the endpoint'),
      ],
    }),
  });
  return plan.id;
}

async function commit(
  app: ReturnType<typeof appWithSession>,
  planId: string,
  refs: readonly string[],
): Promise<PlanCommitOut> {
  const res = await app.request(`/${planId}/commit`, {
    method: 'POST',
    headers: J,
    body: JSON.stringify({ refs }),
  });
  return (await res.json()) as PlanCommitOut;
}

describe('GET /v1/me/plans/:id/roster', () => {
  it('lists the people and teams a plan may assign, to its owner only', async () => {
    const { app, strangerApp, orgId, teamId, actorId } = await seedOwner();
    const planId = await draftPlan(app, orgId);
    const res = await app.request(`/${planId}/roster`);
    expect(res.status).toBe(200);
    const roster = (await res.json()) as PlanRoster;
    expect(roster.teams.map((entry) => entry.id)).toContain(teamId);
    const owner = roster.people.find((person) => person.actorId === actorId);
    expect(owner?.teamIds).toEqual([teamId]);
    const foreign = await strangerApp.request(`/${planId}/roster`);
    expect(foreign.status).toBe(404);
  });
});

describe('undoing a plan commit', () => {
  it('returns only the nodes that commit created to draft', async () => {
    const { app, undoApp, orgId } = await seedOwner();
    const planId = await draftPlan(app, orgId);
    await commit(app, planId, ['t1']);
    const second = await commit(app, planId, ['s1']);
    expect(second.createdCounts).toEqual({ initiatives: 0, projects: 0, tasks: 1, subtasks: 1 });
    const undone = await undoApp.request(`/${second.changeSetId ?? ''}/undo`, { method: 'POST' });
    expect(undone.status).toBe(200);
    const plan = (await (await app.request(`/${planId}`)).json()) as PlanDraftOut;
    const statusOf = (ref: string) => plan.document.nodes.find((n) => n.ref === ref)?.status;
    expect(statusOf('t1')).toBe('confirmed');
    expect(statusOf('p1')).toBe('confirmed');
    expect(statusOf('f1')).toBe('draft');
    expect(statusOf('s1')).toBe('draft');
    expect(plan.status).toBe('active');
  });
});
