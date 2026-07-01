/**
 * `@docket/api` — dependency-graph route tests.
 *
 * @remarks
 * Covers the bulk scope-level graph read (`GET /v1/orgs/:orgId/graph`): the node set is
 * filtered to what the caller may view (public, or grant on the task / an ancestor), edges
 * are pruned to in-set endpoints, both `dependency` and `subtask` edge kinds are emitted,
 * and the three scopes (org / project / task-neighborhood) select the right candidates.
 * Mirrors `harness.test.ts`.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';
import type { GraphOut } from '@docket/types';

import { appWithActor, getDb, one, seedBaseOrg } from './harness.test';
import type graphRouter from '../../src/routes/dependency-graph';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let graph!: typeof graphRouter;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  graph = (await import('../../src/routes/dependency-graph')).default;
});

/**
 * Insert a task row directly (bypassing workflow-state validation) and return its id.
 *
 * @remarks
 * The return type is inferred from the `id` column so it carries the branded `TaskId` the
 * `task_dependency` insert expects — annotating it `string` would widen the brand away.
 */
async function seedTask(
  orgId: string,
  teamId: string,
  opts: {
    title: string;
    visibility?: 'public' | 'private';
    projectId?: string;
    parentTaskId?: string;
  },
) {
  return one(
    await db
      .insert(schema.task)
      .values({
        organizationId: orgId,
        title: opts.title,
        teamId,
        state: 'todo',
        visibility: opts.visibility ?? 'public',
        projectId: opts.projectId,
        parentTaskId: opts.parentTaskId,
      })
      .returning({ id: schema.task.id }),
  ).id;
}

/** GET the graph for a scope and return the parsed payload. */
async function fetchGraph(orgId: string, actorId: string, query = ''): Promise<GraphOut> {
  const app = appWithActor(graph, orgId, ['view'], actorId);
  const res = await app.request(`/${query}`, { method: 'GET' });
  expect(res.status).toBe(200);
  return (await res.json()) as GraphOut;
}

describe('dependency graph — org scope', () => {
  it('returns public nodes with both edge kinds and omits private (ungranted) tasks', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const a = await seedTask(orgId, teamId, { title: 'A' });
    const b = await seedTask(orgId, teamId, { title: 'B' });
    const parent = await seedTask(orgId, teamId, { title: 'Parent' });
    const child = await seedTask(orgId, teamId, { title: 'Child', parentTaskId: parent });
    const secret = await seedTask(orgId, teamId, { title: 'Secret', visibility: 'private' });

    // A blocks B (dependency edge), and a dangling edge A → secret that must be pruned.
    await db
      .insert(schema.taskDependency)
      .values({ organizationId: orgId, blockingTaskId: a, blockedTaskId: b });
    await db
      .insert(schema.taskDependency)
      .values({ organizationId: orgId, blockingTaskId: a, blockedTaskId: secret });

    const out = await fetchGraph(orgId, humanActorId);
    const nodeIds = new Set<string>(out.nodes.map((n) => n.id));

    expect(nodeIds.has(a)).toBe(true);
    expect(nodeIds.has(b)).toBe(true);
    expect(nodeIds.has(parent)).toBe(true);
    expect(nodeIds.has(child)).toBe(true);
    expect(nodeIds.has(secret)).toBe(false); // private, no grant

    // Dependency edge A→B is present; A→secret is pruned (endpoint not viewable).
    const dep = out.edges.filter((e) => e.kind === 'dependency');
    expect(dep).toEqual([expect.objectContaining({ source: a, target: b, kind: 'dependency' })]);
    // Subtask edge parent→child is present.
    const sub = out.edges.filter((e) => e.kind === 'subtask');
    expect(sub).toEqual([
      expect.objectContaining({ source: parent, target: child, kind: 'subtask' }),
    ]);
  });

  it('reveals a private task once the actor holds a grant on it', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const secret = await seedTask(orgId, teamId, { title: 'Secret', visibility: 'private' });

    // Without a grant: hidden.
    expect((await fetchGraph(orgId, humanActorId)).nodes.some((n) => n.id === secret)).toBe(false);

    // Grant the actor view on the task itself.
    await db.insert(schema.grant).values({
      organizationId: orgId,
      subjectKind: 'actor',
      subjectId: humanActorId,
      resourceKind: 'task',
      resourceId: secret,
      capabilities: ['view'],
      effect: 'allow',
    });

    expect((await fetchGraph(orgId, humanActorId)).nodes.some((n) => n.id === secret)).toBe(true);
  });
});

describe('dependency graph — project scope', () => {
  it('narrows the node set to a single project', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const proj = one(
      await db
        .insert(schema.project)
        .values({ organizationId: orgId, name: 'P', teamId, createdBy: humanActorId })
        .returning({ id: schema.project.id }),
    ).id;
    const inProj = await seedTask(orgId, teamId, { title: 'In', projectId: proj });
    const outProj = await seedTask(orgId, teamId, { title: 'Out' });

    const out = await fetchGraph(orgId, humanActorId, `?projectId=${proj}`);
    const nodeIds = new Set<string>(out.nodes.map((n) => n.id));
    expect(nodeIds.has(inProj)).toBe(true);
    expect(nodeIds.has(outProj)).toBe(false);
  });
});

describe('dependency graph — task neighborhood scope', () => {
  it('returns the depth-bounded neighborhood around a root task', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const a = await seedTask(orgId, teamId, { title: 'A' });
    const b = await seedTask(orgId, teamId, { title: 'B' });
    const cTask = await seedTask(orgId, teamId, { title: 'C' });
    const far = await seedTask(orgId, teamId, { title: 'Far' });
    // Chain A → B → C, plus C → Far (2 hops from B).
    for (const [x, y] of [
      [a, b],
      [b, cTask],
      [cTask, far],
    ] as const) {
      await db
        .insert(schema.taskDependency)
        .values({ organizationId: orgId, blockingTaskId: x, blockedTaskId: y });
    }

    const out = await fetchGraph(orgId, humanActorId, `?rootTaskId=${b}&depth=1`);
    const nodeIds = new Set<string>(out.nodes.map((n) => n.id));
    expect(nodeIds.has(a)).toBe(true); // 1 hop (A → B)
    expect(nodeIds.has(b)).toBe(true); // root
    expect(nodeIds.has(cTask)).toBe(true); // 1 hop (B → C)
    expect(nodeIds.has(far)).toBe(false); // 2 hops away
  });

  it('returns an empty graph for a non-existent root', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const out = await fetchGraph(orgId, humanActorId, '?rootTaskId=01ARZ3NDEKTSV4RRFFQ69G5FAV');
    expect(out.nodes).toHaveLength(0);
    expect(out.edges).toHaveLength(0);
  });
});
