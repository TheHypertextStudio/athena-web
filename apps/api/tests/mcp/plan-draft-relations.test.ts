/** Plans that place projects among initiatives, depend on existing work, and commit dependencies. */
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { assertDefined } from '@docket/test-utils';

import { resetAuthMocks } from '../support/auth-mock';
import { getMigratedDb } from '../support/db';
import {
  LinkHarness,
  resultText,
  seedInitiative,
  seedLinkOrg,
  seedProject,
  seedRestrictedMember,
  seedTask,
  type LinkDb,
  type LinkSeed,
} from './mcp-link-fixtures';

let handle!: LinkDb;
let harness!: LinkHarness;

beforeAll(async () => {
  const schema = await getMigratedDb();
  handle = { schema, db: schema.db };
  harness = new LinkHarness((await import('../../src/mcp/tools')).registerTools);
});

afterEach(async () => {
  await harness.closeAll();
  resetAuthMocks();
});

interface PlanNodeOut {
  ref: string;
  kind: string;
  parentRef: string | null;
  initiativeRefs: string[];
  status: string;
  objectId: string | null;
}

interface PlanOut {
  planId: string;
  revision: number;
  document: { nodes: PlanNodeOut[]; edges: { fromRef: string; toRef: string }[] };
}

const FREEFORM = 'This test confirms explicitly authored freeform work.';

async function call(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  return (await client.callTool({ name, arguments: args })) as CallToolResult;
}

function structured(result: CallToolResult): Record<string, unknown> {
  expect(result.isError ?? false, resultText(result)).toBe(false);
  return result.structuredContent ?? {};
}

/** Start a plan and return it. */
async function start(client: Client, args: Record<string, unknown>): Promise<PlanOut> {
  return structured(await call(client, 'plan_start', args)) as unknown as PlanOut;
}

/** Read a plan back. */
async function read(client: Client, planId: string): Promise<PlanOut> {
  return structured(await call(client, 'plan_read', { planId })) as unknown as PlanOut;
}

/** Apply ops against the plan's current revision. */
async function draft(client: Client, planId: string, ops: unknown[]): Promise<CallToolResult> {
  const { revision } = await read(client, planId);
  return call(client, 'plan_draft', { planId, revision, ops });
}

/** Confirm refs as freeform work. */
async function commit(client: Client, planId: string, refs: string[]): Promise<CallToolResult> {
  return call(client, 'plan_commit', { planId, refs, withoutTemplateReason: FREEFORM });
}

/** Every project edge in the org, as `blocking>blocked`. */
async function projectEdges(s: LinkSeed): Promise<string[]> {
  const { db, schema } = handle;
  const rows = await db
    .select()
    .from(schema.projectDependency)
    .where(eq(schema.projectDependency.organizationId, s.orgId));
  return rows.map((row) => `${row.blockingProjectId}>${row.blockedProjectId}`);
}

/** The id of the project a plan node became. */
async function objectIdOf(client: Client, planId: string, ref: string): Promise<string> {
  const plan = await read(client, planId);
  return assertDefined(plan.document.nodes.find((node) => node.ref === ref)?.objectId ?? undefined);
}

/** Link a seeded project to a seeded initiative. */
async function contribute(s: LinkSeed, projectId: string, initiativeId: string): Promise<void> {
  await handle.db
    .insert(handle.schema.initiativeProject)
    .values({ organizationId: s.orgId, projectId, initiativeId });
}

describe('plan_draft initiative membership', () => {
  it('places a project named only through initiativeRefs, and links it on commit', async () => {
    const s = await seedLinkOrg(handle);
    const client = await harness.connect(s.ctx);
    const plan = await start(client, { orgId: s.orgId, title: 'Spring' });

    const drafted = await draft(client, plan.planId, [
      { op: 'upsert_node', node: { ref: 'init', kind: 'initiative', fields: { title: 'Spring' } } },
      {
        op: 'upsert_node',
        node: { ref: 'p1', kind: 'project', initiativeRefs: ['init'], fields: { title: 'P' } },
      },
    ]);
    expect(drafted.isError ?? false, resultText(drafted)).toBe(false);

    const committed = await commit(client, plan.planId, ['p1']);
    expect(committed.isError ?? false, resultText(committed)).toBe(false);
    const projectId = await objectIdOf(client, plan.planId, 'p1');
    const initiativeId = await objectIdOf(client, plan.planId, 'init');
    const links = await handle.db
      .select({ initiativeId: handle.schema.initiativeProject.initiativeId })
      .from(handle.schema.initiativeProject)
      .where(eq(handle.schema.initiativeProject.projectId, projectId));
    expect(links).toEqual([{ initiativeId }]);
  });

  it('names the nodes a parentless project could sit under', async () => {
    const s = await seedLinkOrg(handle);
    const client = await harness.connect(s.ctx);
    const plan = await start(client, { orgId: s.orgId, title: 'Spring' });

    const refused = await draft(client, plan.planId, [
      { op: 'upsert_node', node: { ref: 'init', kind: 'initiative', fields: { title: 'Spring' } } },
      { op: 'upsert_node', node: { ref: 'p1', kind: 'project', fields: { title: 'P' } } },
    ]);

    expect(refused.isError).toBe(true);
    expect(resultText(refused)).toContain('ops.1.parentRef: invalid_option (allowed values: init)');
  });
});

describe('plan_start on an existing initiative', () => {
  it('omits private projects and tasks the plan owner cannot view', async () => {
    const s = await seedLinkOrg(handle);
    const hidden = await seedProject(handle, s, 'Private launch');
    await handle.db
      .update(handle.schema.project)
      .set({ visibility: 'private' })
      .where(eq(handle.schema.project.id, hidden));
    await contribute(s, hidden, s.initiativeId);
    await contribute(s, s.projectId, s.initiativeId);
    const hiddenTask = await seedTask(handle, s, {
      title: 'Private task',
      projectId: s.projectId,
      visibility: 'private',
    });
    const visibleTask = await seedTask(handle, s, {
      title: 'Visible task',
      projectId: s.projectId,
    });
    const restricted = await seedRestrictedMember(handle, s, []);
    const client = await harness.connect(restricted);
    const plan = await start(client, { orgId: s.orgId, initiative: s.initiativeId });
    const ids = plan.document.nodes.map((node) => node.objectId);
    expect(ids).not.toContain(hidden);
    expect(ids).not.toContain(hiddenTask);
    expect(ids).toContain(s.projectId);
    expect(ids).toContain(visibleTask);
  });

  it('shows the projects already under it and their open tasks as created nodes', async () => {
    const s = await seedLinkOrg(handle);
    const outside = await seedProject(handle, s, 'Elsewhere');
    await contribute(s, s.projectId, s.initiativeId);
    const open = await seedTask(handle, s, { title: 'Open', projectId: s.projectId });
    await seedTask(handle, s, {
      title: 'Done',
      projectId: s.projectId,
      state: 'done',
      completedAt: new Date(),
    });
    await seedTask(handle, s, { title: 'Elsewhere task', projectId: outside });
    const client = await harness.connect(s.ctx);

    const plan = await start(client, { orgId: s.orgId, initiative: s.initiativeId });

    const created = plan.document.nodes.filter((node) => node.status === 'confirmed');
    expect(created.map((node) => node.objectId).sort()).toEqual(
      [s.initiativeId, s.projectId, open].sort(),
    );
    const project = created.find((node) => node.objectId === s.projectId);
    expect(project).toMatchObject({ kind: 'project', parentRef: 'root' });
    expect(created.find((node) => node.objectId === open)).toMatchObject({
      kind: 'task',
      parentRef: project?.ref,
    });
  });

  it('adds work linked since the plan was opened when it is reopened', async () => {
    const s = await seedLinkOrg(handle);
    const client = await harness.connect(s.ctx);
    const first = await start(client, { orgId: s.orgId, initiative: s.initiativeId });
    expect(first.document.nodes).toHaveLength(1);
    await contribute(s, s.projectId, s.initiativeId);

    const again = await start(client, { orgId: s.orgId, initiative: s.initiativeId });

    expect(again.planId).toBe(first.planId);
    expect(again.revision).toBe(first.revision + 1);
    expect(again.document.nodes.map((node) => node.objectId)).toContain(s.projectId);
  });

  it('commits a new project that depends on an existing one, and a task into an existing project', async () => {
    const s = await seedLinkOrg(handle);
    await contribute(s, s.projectId, s.initiativeId);
    const client = await harness.connect(s.ctx);
    const plan = await start(client, { orgId: s.orgId, initiative: s.initiativeId });
    const existing = assertDefined(
      plan.document.nodes.find((node) => node.objectId === s.projectId),
    );

    const drafted = await draft(client, plan.planId, [
      {
        op: 'upsert_node',
        node: { ref: 'launch', kind: 'project', parentRef: 'root', fields: { title: 'Launch' } },
      },
      {
        op: 'upsert_node',
        node: { ref: 'docs', kind: 'task', parentRef: existing.ref, fields: { title: 'Docs' } },
      },
      { op: 'add_edge', fromRef: existing.ref, toRef: 'launch' },
    ]);
    expect(drafted.isError ?? false, resultText(drafted)).toBe(false);
    const committed = await commit(client, plan.planId, ['launch', 'docs']);
    expect(committed.isError ?? false, resultText(committed)).toBe(false);

    const launch = await objectIdOf(client, plan.planId, 'launch');
    const docs = await objectIdOf(client, plan.planId, 'docs');
    expect(await projectEdges(s)).toEqual([`${s.projectId}>${launch}`]);
    const [task] = await handle.db
      .select({ projectId: handle.schema.task.projectId })
      .from(handle.schema.task)
      .where(eq(handle.schema.task.id, docs));
    expect(task?.projectId).toBe(s.projectId);
  });

  it('ignores initiatives other than the root when hydrating', async () => {
    const s = await seedLinkOrg(handle);
    const other = await seedInitiative(handle, s, 'Q4');
    await contribute(s, s.projectId, other);
    const client = await harness.connect(s.ctx);

    const plan = await start(client, { orgId: s.orgId, initiative: s.initiativeId });

    expect(plan.document.nodes.map((node) => node.objectId)).toEqual([s.initiativeId]);
  });
});

describe('plan_commit dependencies', () => {
  it('writes a dependency between two new projects, and undo removes it', async () => {
    const s = await seedLinkOrg(handle);
    const client = await harness.connect(s.ctx);
    const plan = await start(client, { orgId: s.orgId, title: 'Spring' });
    await draft(client, plan.planId, [
      { op: 'upsert_node', node: { ref: 'init', kind: 'initiative', fields: { title: 'Spring' } } },
      {
        op: 'upsert_node',
        node: { ref: 'a', kind: 'project', parentRef: 'init', fields: { title: 'A' } },
      },
      {
        op: 'upsert_node',
        node: { ref: 'b', kind: 'project', parentRef: 'init', fields: { title: 'B' } },
      },
      { op: 'add_edge', fromRef: 'a', toRef: 'b' },
    ]);

    const committed = structured(await commit(client, plan.planId, ['a', 'b']));
    const a = await objectIdOf(client, plan.planId, 'a');
    const b = await objectIdOf(client, plan.planId, 'b');
    expect(await projectEdges(s)).toEqual([`${a}>${b}`]);

    await call(client, 'undo', { orgId: s.orgId, changeSetId: committed['changeSetId'] });
    expect(await projectEdges(s)).toEqual([]);
  });

  it('refuses a commit whose edge would close a cycle with existing dependencies', async () => {
    const s = await seedLinkOrg(handle);
    const other = await seedProject(handle, s, 'Billing');
    await contribute(s, s.projectId, s.initiativeId);
    await contribute(s, other, s.initiativeId);
    await handle.db.insert(handle.schema.projectDependency).values({
      organizationId: s.orgId,
      blockingProjectId: s.projectId,
      blockedProjectId: other,
    });
    const client = await harness.connect(s.ctx);
    const plan = await start(client, { orgId: s.orgId, initiative: s.initiativeId });
    const refOf = (id: string) =>
      assertDefined(plan.document.nodes.find((node) => node.objectId === id)).ref;
    await draft(client, plan.planId, [
      {
        op: 'upsert_node',
        node: { ref: 'x', kind: 'project', parentRef: 'root', fields: { title: 'X' } },
      },
      { op: 'add_edge', fromRef: refOf(other), toRef: 'x' },
      { op: 'add_edge', fromRef: 'x', toRef: refOf(s.projectId) },
    ]);

    const refused = await commit(client, plan.planId, ['x']);

    expect(refused.isError).toBe(true);
    expect(resultText(refused)).toContain('dependency_cycle');
    expect(await projectEdges(s)).toEqual([`${s.projectId}>${other}`]);
    const [created] = await handle.db
      .select({ id: handle.schema.project.id })
      .from(handle.schema.project)
      .where(
        and(eq(handle.schema.project.name, 'X'), eq(handle.schema.project.organizationId, s.orgId)),
      );
    expect(created).toBeUndefined();
  });
});
