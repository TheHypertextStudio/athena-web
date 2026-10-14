import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import { resetAuthMocks } from '../support/auth-mock';
import { getMigratedDb } from '../support/db';
import {
  LinkHarness,
  payload,
  seedLinkOrg,
  seedTask as seedTaskIn,
  type LinkSeed,
} from './mcp-link-fixtures';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let harness!: LinkHarness;

beforeAll(async () => {
  schema = await getMigratedDb();
  db = schema.db;
  harness = new LinkHarness((await import('../../src/mcp/tools')).registerTools);
});

/** Seed an org that can contribute org-wide, with one of each container. */
function seedOrg(): Promise<LinkSeed> {
  return seedLinkOrg({ schema, db });
}

function seedTask(
  s: LinkSeed,
  values: Partial<typeof schema.task.$inferInsert> = {},
): Promise<string> {
  return seedTaskIn({ schema, db }, s, values);
}

function connect(ctx: LinkSeed['ctx']) {
  return harness.connect(ctx);
}

afterEach(async () => {
  await harness.closeAll();
  resetAuthMocks();
});

describe('link', () => {
  it('records that one task blocks another', async () => {
    const s = await seedOrg();
    const blocker = await seedTask(s, { title: 'Ship the schema' });
    const blocked = await seedTask(s, { title: 'Cut the release' });

    const client = await connect(s.ctx);
    const res = (await client.callTool({
      name: 'link',
      arguments: { orgId: s.orgId, relation: 'blocks', from: blocker, to: blocked },
    })) as CallToolResult;
    expect(payload(res)).toMatchObject({ linked: true, changed: true });

    const edges = await db
      .select({ blocked: schema.taskDependency.blockedTaskId })
      .from(schema.taskDependency)
      .where(eq(schema.taskDependency.blockingTaskId, blocker));
    expect(edges).toEqual([{ blocked }]);
  });

  it('says nothing changed when the relation already held', async () => {
    const s = await seedOrg();
    const a = await seedTask(s);
    const b = await seedTask(s, { title: 'Other' });
    const client = await connect(s.ctx);
    const args = { orgId: s.orgId, relation: 'blocks', from: a, to: b };
    await client.callTool({ name: 'link', arguments: args });
    const again = (await client.callTool({ name: 'link', arguments: args })) as CallToolResult;
    expect(payload(again)).toMatchObject({ changed: false, changeSetId: null });
  });

  it('refuses an edge that would close a cycle', async () => {
    const s = await seedOrg();
    const a = await seedTask(s, { title: 'A' });
    const b = await seedTask(s, { title: 'B' });
    const client = await connect(s.ctx);
    await client.callTool({
      name: 'link',
      arguments: { orgId: s.orgId, relation: 'blocks', from: a, to: b },
    });
    const res = (await client.callTool({
      name: 'link',
      arguments: { orgId: s.orgId, relation: 'blocks', from: b, to: a },
    })) as CallToolResult;
    expect(res.isError).toBe(true);
  });

  it('rolls a project up to an initiative, by name on both sides', async () => {
    const s = await seedOrg();
    const client = await connect(s.ctx);
    const res = (await client.callTool({
      name: 'link',
      arguments: {
        orgId: s.orgId,
        relation: 'contributes_to',
        from: 'Auth Rewrite',
        to: 'Q3 Platform',
      },
    })) as CallToolResult;
    expect(payload(res)).toMatchObject({
      from: s.projectId,
      to: s.initiativeId,
      linked: true,
      changed: true,
    });

    const links = await db
      .select({ projectId: schema.initiativeProject.projectId })
      .from(schema.initiativeProject)
      .where(eq(schema.initiativeProject.initiativeId, s.initiativeId));
    expect(links).toEqual([{ projectId: s.projectId }]);
  });

  it('works out that a program is a program without being told', async () => {
    const s = await seedOrg();
    const client = await connect(s.ctx);
    await client.callTool({
      name: 'link',
      arguments: {
        orgId: s.orgId,
        relation: 'contributes_to',
        from: 'Reliability',
        to: 'Q3 Platform',
      },
    });
    const links = await db
      .select({ programId: schema.initiativeProgram.programId })
      .from(schema.initiativeProgram)
      .where(eq(schema.initiativeProgram.initiativeId, s.initiativeId));
    expect(links).toEqual([{ programId: s.programId }]);
  });

  it('asks which one when a name is both a project and a program', async () => {
    const s = await seedOrg();
    await db.insert(schema.program).values({
      organizationId: s.orgId,
      name: 'Auth Rewrite',
      createdBy: s.actorId,
      status: 'active',
      statusId: s.statusId('program', 'active'),
    });
    const client = await connect(s.ctx);
    const res = (await client.callTool({
      name: 'link',
      arguments: {
        orgId: s.orgId,
        relation: 'contributes_to',
        from: 'Auth Rewrite',
        to: 'Q3 Platform',
      },
    })) as CallToolResult;
    expect(res.isError).toBe(true);
    expect((res.content[0] as { text: string }).text).toContain('from');
  });

  it('undoes a link by deleting the edge it added', async () => {
    const s = await seedOrg();
    const client = await connect(s.ctx);
    const out = payload(
      (await client.callTool({
        name: 'link',
        arguments: {
          orgId: s.orgId,
          relation: 'contributes_to',
          from: 'Auth Rewrite',
          to: 'Q3 Platform',
        },
      })) as CallToolResult,
    ) as { changeSetId: string };

    const undone = payload(
      (await client.callTool({
        name: 'undo',
        arguments: { orgId: s.orgId, changeSetId: out.changeSetId },
      })) as CallToolResult,
    );
    expect(undone).toMatchObject({ reverted: 1, skipped: [] });

    const links = await db
      .select()
      .from(schema.initiativeProject)
      .where(eq(schema.initiativeProject.initiativeId, s.initiativeId));
    expect(links).toEqual([]);
  });

  it('undoes an unlink by putting the edge back', async () => {
    const s = await seedOrg();
    await db.insert(schema.initiativeProject).values({
      organizationId: s.orgId,
      initiativeId: s.initiativeId,
      projectId: s.projectId,
    });

    const client = await connect(s.ctx);
    const out = payload(
      (await client.callTool({
        name: 'link',
        arguments: {
          orgId: s.orgId,
          relation: 'contributes_to',
          from: 'Auth Rewrite',
          to: 'Q3 Platform',
          remove: true,
        },
      })) as CallToolResult,
    ) as { changeSetId: string };

    await client.callTool({
      name: 'undo',
      arguments: { orgId: s.orgId, changeSetId: out.changeSetId },
    });
    const links = await db
      .select({ projectId: schema.initiativeProject.projectId })
      .from(schema.initiativeProject)
      .where(eq(schema.initiativeProject.initiativeId, s.initiativeId));
    expect(links).toEqual([{ projectId: s.projectId }]);
  });

  it('reparents a task, and undo puts it back under the old parent', async () => {
    const s = await seedOrg();
    const first = await seedTask(s, { title: 'First parent' });
    const second = await seedTask(s, { title: 'Second parent' });
    const child = await seedTask(s, { title: 'Child', parentTaskId: first });

    const client = await connect(s.ctx);
    const out = payload(
      (await client.callTool({
        name: 'link',
        arguments: { orgId: s.orgId, relation: 'subtask_of', from: child, to: second },
      })) as CallToolResult,
    ) as { changeSetId: string };

    const [moved] = await db
      .select({ parentTaskId: schema.task.parentTaskId })
      .from(schema.task)
      .where(eq(schema.task.id, child));
    expect(moved?.parentTaskId).toBe(second);

    await client.callTool({
      name: 'undo',
      arguments: { orgId: s.orgId, changeSetId: out.changeSetId },
    });
    const [back] = await db
      .select({ parentTaskId: schema.task.parentTaskId })
      .from(schema.task)
      .where(eq(schema.task.id, child));
    // Reversing a reparent restores the previous parent, not merely no parent.
    expect(back?.parentTaskId).toBe(first);
  });

  it('refuses a two-task subtask cycle', async () => {
    const s = await seedOrg();
    const first = await seedTask(s, { title: 'First' });
    const second = await seedTask(s, { title: 'Second' });
    await db.update(schema.task).set({ parentTaskId: first }).where(eq(schema.task.id, second));
    const client = await connect(s.ctx);

    const result = (await client.callTool({
      name: 'link',
      arguments: { orgId: s.orgId, relation: 'subtask_of', from: first, to: second },
    })) as CallToolResult;

    expect(result.isError).toBe(true);
  });

  it('refuses a three-task subtask cycle', async () => {
    const s = await seedOrg();
    const first = await seedTask(s, { title: 'First' });
    const second = await seedTask(s, { title: 'Second', parentTaskId: first });
    const third = await seedTask(s, { title: 'Third', parentTaskId: second });
    const client = await connect(s.ctx);

    const result = (await client.callTool({
      name: 'link',
      arguments: { orgId: s.orgId, relation: 'subtask_of', from: first, to: third },
    })) as CallToolResult;

    expect(result.isError).toBe(true);
  });

  it('allows a hierarchy link when task dependencies point the other way', async () => {
    const s = await seedOrg();
    const parent = await seedTask(s, { title: 'Parent' });
    const child = await seedTask(s, { title: 'Child' });
    await db.insert(schema.taskDependency).values({
      organizationId: s.orgId,
      blockingTaskId: parent,
      blockedTaskId: child,
    });
    const client = await connect(s.ctx);

    const result = (await client.callTool({
      name: 'link',
      arguments: { orgId: s.orgId, relation: 'subtask_of', from: child, to: parent },
    })) as CallToolResult;

    expect(result.isError).toBeFalsy();
    expect(payload(result)).toMatchObject({ changed: true, linked: true });
  });

  it('evaluates the former parent when a subtask relation is removed', async () => {
    const s = await seedOrg();
    const parent = await seedTask(s, { title: 'Parent' });
    await seedTask(s, {
      title: 'Ended child',
      parentTaskId: parent,
      state: 'done',
      completedAt: new Date(),
    });
    const activeChild = await seedTask(s, { title: 'Active child', parentTaskId: parent });
    const client = await connect(s.ctx);

    const result = (await client.callTool({
      name: 'link',
      arguments: {
        orgId: s.orgId,
        relation: 'subtask_of',
        from: activeChild,
        to: parent,
        remove: true,
      },
    })) as CallToolResult;
    expect(result.isError).toBeFalsy();

    const [updatedParent] = await db
      .select({
        state: schema.task.state,
        autoCompletedBySubtasks: schema.task.autoCompletedBySubtasks,
      })
      .from(schema.task)
      .where(eq(schema.task.id, parent));
    expect(updatedParent?.state).toBe('done');
    expect(updatedParent?.autoCompletedBySubtasks).toBe(true);
  });

  it('refuses to make a task its own parent', async () => {
    const s = await seedOrg();
    const id = await seedTask(s);
    const client = await connect(s.ctx);
    const res = (await client.callTool({
      name: 'link',
      arguments: { orgId: s.orgId, relation: 'subtask_of', from: id, to: id },
    })) as CallToolResult;
    expect(res.isError).toBe(true);
  });
});

describe('archive', () => {
  it('takes a scoped set out of view without deleting it', async () => {
    const s = await seedOrg();
    const filed = await seedTask(s, { title: 'Filed', projectId: s.projectId });
    const loose = await seedTask(s, { title: 'Loose' });

    const client = await connect(s.ctx);
    const res = (await client.callTool({
      name: 'archive',
      arguments: { orgId: s.orgId, entity: 'task', scope: { project: 'Auth Rewrite' } },
    })) as CallToolResult;
    expect(payload(res)).toMatchObject({
      matched: 1,
      changed: 1,
      items: [{ id: filed, title: 'Filed' }],
    });

    const rows = await db
      .select({ id: schema.task.id, archivedAt: schema.task.archivedAt })
      .from(schema.task)
      .where(eq(schema.task.organizationId, s.orgId));
    const byId = new Map(rows.map((row) => [row.id, row.archivedAt]));
    expect(byId.get(filed)).not.toBeNull();
    expect(byId.get(loose)).toBeNull();
  });

  it('applies the subtask policy after archiving the final active child', async () => {
    const s = await seedOrg();
    const parentId = await seedTask(s, { title: 'Parent' });
    await seedTask(s, {
      title: 'Completed child',
      parentTaskId: parentId,
      state: 'done',
      completedAt: new Date(),
    });
    const activeChildId = await seedTask(s, { title: 'Active child', parentTaskId: parentId });

    const client = await connect(s.ctx);
    const res = (await client.callTool({
      name: 'archive',
      arguments: { orgId: s.orgId, entity: 'task', scope: { ids: [activeChildId] } },
    })) as CallToolResult;
    expect(payload(res)).toMatchObject({ changed: 1 });

    const [parent] = await db
      .select({ state: schema.task.state, completedAt: schema.task.completedAt })
      .from(schema.task)
      .where(eq(schema.task.id, parentId));
    expect(parent?.state).toBe('done');
    expect(parent?.completedAt).not.toBeNull();
  });

  it('restores from the archived pool', async () => {
    const s = await seedOrg();
    const id = await seedTask(s, {
      title: 'Buried',
      projectId: s.projectId,
      archivedAt: new Date(),
    });

    const client = await connect(s.ctx);
    const res = (await client.callTool({
      name: 'archive',
      arguments: {
        orgId: s.orgId,
        entity: 'task',
        scope: { project: 'Auth Rewrite' },
        restore: true,
      },
    })) as CallToolResult;
    expect(payload(res)).toMatchObject({ changed: 1 });

    const [row] = await db
      .select({ archivedAt: schema.task.archivedAt })
      .from(schema.task)
      .where(eq(schema.task.id, id));
    expect(row?.archivedAt).toBeNull();
  });

  it('reports an item that is already where it was asked to go', async () => {
    const s = await seedOrg();
    const id = await seedTask(s, { title: 'Already gone', archivedAt: new Date() });
    const client = await connect(s.ctx);
    const res = (await client.callTool({
      name: 'archive',
      arguments: { orgId: s.orgId, entity: 'task', scope: { ids: [id] } },
    })) as CallToolResult;
    expect(payload(res)).toMatchObject({
      changed: 0,
      skipped: [{ id, title: 'Already gone', reason: 'already_archived' }],
    });
  });

  it('refuses an unscoped archive', async () => {
    const s = await seedOrg();
    await seedTask(s, { title: 'Precious' });
    const client = await connect(s.ctx);
    const res = (await client.callTool({
      name: 'archive',
      arguments: { orgId: s.orgId, entity: 'task', scope: {} },
    })) as CallToolResult;
    expect(res.isError).toBe(true);

    const [row] = await db
      .select({ archivedAt: schema.task.archivedAt })
      .from(schema.task)
      .where(and(eq(schema.task.organizationId, s.orgId)));
    expect(row?.archivedAt).toBeNull();
  });

  it('is reversible', async () => {
    const s = await seedOrg();
    const id = await seedTask(s, { title: 'Comes back', projectId: s.projectId });
    const client = await connect(s.ctx);
    const out = payload(
      (await client.callTool({
        name: 'archive',
        arguments: { orgId: s.orgId, entity: 'task', scope: { project: 'Auth Rewrite' } },
      })) as CallToolResult,
    ) as { changeSetId: string };

    await client.callTool({
      name: 'undo',
      arguments: { orgId: s.orgId, changeSetId: out.changeSetId },
    });
    const [row] = await db
      .select({ archivedAt: schema.task.archivedAt })
      .from(schema.task)
      .where(eq(schema.task.id, id));
    expect(row?.archivedAt).toBeNull();
  });
});
