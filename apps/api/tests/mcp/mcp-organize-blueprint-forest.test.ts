import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type * as DbModule from '@docket/db';
import { BlueprintStep } from '@docket/work/work-template-blueprint';
import { WorkTemplateCreate } from '@docket/work/work-template-contract';
import { PlanDocument, PlanNode } from '@docket/work/plan-draft-contract';
import { and, eq, sql } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { getDb, seedTaskAccessOrg } from '../support/routes-harness';
import { createWorkTemplate, publishWorkTemplate } from '../../src/lib/templates/service';
import { rawResultRows } from '../../src/lib/raw-result';
import { flushDeferredWork } from '../../src/lib/after-response';
import { commitPlanNodes } from '../../src/lib/plan-draft/commit';
import { appProvenance } from '../../src/lib/provenance/context';

let schema: typeof DbModule;
const clients: { client: Client; server: McpServer }[] = [];
beforeAll(async () => {
  schema = await getDb();
});
afterEach(async () => {
  await flushDeferredWork();
  for (const { client, server } of clients.splice(0)) {
    await client.close();
    await server.close();
  }
  for (const table of ['task', 'project', 'program'] as const) {
    await schema.db.execute(
      sql.raw(`DROP TRIGGER IF EXISTS count_planned_work_insert ON ${table}`),
    );
  }
  await schema.db.execute(sql`DROP FUNCTION IF EXISTS pg_temp.count_planned_work_insert()`);
  await schema.db.execute(sql`DROP SEQUENCE IF EXISTS pg_temp.planned_work_insert_attempts`);
});

async function fixture() {
  const base = await seedTaskAccessOrg(schema.db, schema, 'manage');
  const [user] = await schema.db
    .insert(schema.user)
    .values({ name: 'Forest author', email: `${base.orgId}@forest.test` })
    .returning();
  if (!user) throw new Error('User fixture missing');
  await schema.db
    .update(schema.actor)
    .set({ userId: user.id })
    .where(eq(schema.actor.id, base.humanActorId));
  const server = new McpServer(
    { name: 'forest-test', version: '0.0.0' },
    { capabilities: { tools: {} } },
  );
  const { registerTools } = await import('../../src/mcp/tools');
  registerTools(
    server,
    {
      principal: { kind: 'user', userId: user.id, userName: user.name, userEmail: user.email },
      scopes: ['work:read', 'work:write', 'agents:run', 'connectors:link'],
    },
    'forest-session',
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'forest-client', version: '0.0.0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  clients.push({ client, server });
  return {
    ...base,
    userId: user.id,
    client,
    actor: { orgId: base.orgId, actorId: base.humanActorId, capabilities: ['manage'] },
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;

function step(key: string) {
  return BlueprintStep.parse({
    key,
    kind: 'task',
    parentStepKey: null,
    sort: 0,
    fields: { title: key },
    template: null,
    teamRule: 'parent_team',
    actorRule: 'unassigned',
    cycleRule: 'none',
    dates: {},
    optional: { enabled: false, selectedByDefault: true },
  });
}
async function published(f: Fixture, kind: 'project' | 'program', count: number) {
  const row = await createWorkTemplate(
    f.actor,
    WorkTemplateCreate.parse({
      targetType: kind,
      definition: {
        name: `Prepared ${kind}`,
        payload: { targetType: kind },
        blueprint: {
          steps: Array.from({ length: count }, (_, index) => step(`child_${index}`)),
          dependencies: [],
        },
      },
    }),
  );
  return publishWorkTemplate(f.actor, row.id, row.draftRevision);
}
async function observeInsertAttempts() {
  await schema.db.execute(sql`CREATE TEMP SEQUENCE planned_work_insert_attempts`);
  await schema.db.execute(
    sql`CREATE FUNCTION pg_temp.count_planned_work_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM nextval('pg_temp.planned_work_insert_attempts'); RETURN NEW; END $$`,
  );
  for (const table of ['task', 'project', 'program'] as const) {
    await schema.db.execute(
      sql.raw(
        `CREATE TRIGGER count_planned_work_insert BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION pg_temp.count_planned_work_insert()`,
      ),
    );
  }
}
async function attemptedInsert() {
  const result = await schema.db.execute(
    sql`SELECT is_called FROM pg_temp.planned_work_insert_attempts`,
  );
  return rawResultRows<{ is_called: boolean }>(result)[0]?.is_called;
}
async function organize(f: Fixture, items: Record<string, unknown>[]) {
  return (await f.client.callTool({
    name: 'organize',
    arguments: { orgId: f.orgId, items },
  })) as CallToolResult;
}

describe('read-first organize blueprint forests', () => {
  it('requires checkpoint Project contribution before inserting an earlier root or attaching a matched Task', async () => {
    const f = await fixture();
    await schema.db
      .update(schema.grant)
      .set({ capabilities: ['contribute'], cascades: false })
      .where(
        and(eq(schema.grant.organizationId, f.orgId), eq(schema.grant.subjectId, f.humanActorId)),
      );
    const [project] = await schema.db
      .insert(schema.project)
      .values({
        organizationId: f.orgId,
        name: 'Read-only Project',
        teamId: f.teamId,
        statusId: f.statusId('project', 'planned'),
      })
      .returning();
    if (!project) throw new Error('Project fixture missing');
    const [checkpoint] = await schema.db
      .insert(schema.milestone)
      .values({
        organizationId: f.orgId,
        projectId: project.id,
        name: 'Checkpoint',
      })
      .returning();
    if (!checkpoint) throw new Error('Checkpoint fixture missing');
    const [existing] = await schema.db
      .insert(schema.task)
      .values({
        organizationId: f.orgId,
        teamId: f.teamId,
        projectId: project.id,
        title: 'Existing Task',
        state: 'todo',
        statusId: f.statusId('task', 'todo'),
      })
      .returning();
    if (!existing) throw new Error('Task fixture missing');
    await schema.db.insert(schema.grant).values({
      organizationId: f.orgId,
      subjectKind: 'actor',
      subjectId: f.humanActorId,
      resourceKind: 'task',
      resourceId: existing.id,
      capabilities: ['contribute'],
      effect: 'allow',
      cascades: false,
    });
    await observeInsertAttempts();
    const result = await organize(f, [
      {
        ref: 'first',
        kind: 'task',
        title: 'Must remain unwritten',
        withoutTemplateReason: 'Ordinary capture',
      },
      {
        ref: 'matched',
        kind: 'task',
        title: 'Existing Task',
        milestone: checkpoint.id,
        withoutTemplateReason: 'Existing Task attachment',
      },
    ]);
    expect(result.isError).toBe(true);
    await expect(attemptedInsert()).resolves.toBe(false);
  });

  it('refuses aggregate502 rows before any physical work insert is attempted', async () => {
    const f = await fixture();
    const template = await published(f, 'project', 250);
    await observeInsertAttempts();
    const result = await organize(
      f,
      ['first', 'second'].map((ref) => ({
        ref,
        kind: 'project',
        title: ref,
        workTypeId: template.id,
      })),
    );
    expect(result.isError).toBe(true);
    await expect(attemptedInsert()).resolves.toBe(false);
    expect(
      await schema.db
        .select()
        .from(schema.project)
        .where(eq(schema.project.organizationId, f.orgId)),
    ).toEqual([]);
  });

  it('refuses a later missing generated-team context before inserting an earlier valid root', async () => {
    const f = await fixture();
    const template = await published(f, 'program', 1);
    await observeInsertAttempts();
    const result = await organize(f, [
      {
        ref: 'first',
        kind: 'task',
        title: 'Must remain unwritten',
        withoutTemplateReason: 'Ordinary capture',
      },
      { ref: 'later', kind: 'program', title: 'Needs a creation team', workTypeId: template.id },
    ]);
    expect(result.isError).toBe(true);
    await expect(attemptedInsert()).resolves.toBe(false);
  });

  it('matches later explicit items against earlier generated children and remembers the one receipt', async () => {
    const f = await fixture();
    const template = await published(f, 'project', 2);
    const result = await organize(f, [
      { ref: 'root', kind: 'project', title: 'Reusable preparation', workTypeId: template.id },
      {
        ref: 'first',
        kind: 'task',
        title: 'child_0',
        parent: 'root',
        withoutTemplateReason: 'Existing generated child',
      },
      {
        ref: 'repeat',
        kind: 'task',
        title: 'CHILD_0',
        parent: 'root',
        withoutTemplateReason: 'Same existing child',
      },
    ]);
    expect(result.isError).toBeFalsy();
    const output = result.structuredContent as {
      created: number;
      matched: number;
      changeSetId: string;
      placed: { ref: string; id: string }[];
    };
    expect(output).toMatchObject({ created: 1, matched: 2 });
    expect(output.placed[1]?.id).toBe(output.placed[2]?.id);
    const roots = await schema.db
      .select()
      .from(schema.project)
      .where(eq(schema.project.organizationId, f.orgId));
    expect(roots).toHaveLength(1);
    expect(roots[0]?.blueprintState?.lastApplicationChangeSetId).toBe(output.changeSetId);
    expect(
      await schema.db.select().from(schema.task).where(eq(schema.task.organizationId, f.orgId)),
    ).toHaveLength(2);
    expect(
      await schema.db
        .select()
        .from(schema.changeSetEntry)
        .where(eq(schema.changeSetEntry.changeSetId, output.changeSetId)),
    ).toHaveLength(3);
  });
});

function planNode(ref: string, fields: Record<string, unknown> = {}): PlanNode {
  return PlanNode.parse({
    ref,
    kind: 'task',
    parentRef: null,
    initiativeRefs: [],
    initiativeIds: [],
    fields: { title: ref },
    templateId: null,
    status: 'draft',
    objectId: null,
    ...fields,
  });
}
async function acceptedPlan(f: Fixture, document: PlanDocument, refs: string[]) {
  const [row] = await schema.db
    .insert(schema.planDraft)
    .values({
      ownerUserId: f.userId,
      organizationId: f.orgId,
      title: 'Prepared plan',
      document,
    })
    .returning();
  if (!row) throw new Error('Plan fixture missing');
  return commitPlanNodes({
    row,
    refs,
    actorId: f.humanActorId,
    origin: { ...appProvenance(), v: 2, tool: 'plan_commit' },
  });
}

describe('read-first accepted-plan blueprint forests', () => {
  it('rejects the complete502-row plan before attempting a work insert', async () => {
    const f = await fixture();
    const template = await published(f, 'project', 250);
    await observeInsertAttempts();
    const nodes = ['first', 'second'].map((ref) =>
      planNode(ref, {
        kind: 'project',
        templateId: template.id,
        workTypeVersionId: template.latestPublishedVersionId ?? undefined,
        fields: { title: ref, teamId: f.teamId },
      }),
    );
    await expect(
      acceptedPlan(f, PlanDocument.parse({ nodes, edges: [] }), ['first', 'second']),
    ).rejects.toMatchObject({ code: 'blueprint_limit' });
    await expect(attemptedInsert()).resolves.toBe(false);
  });

  it('checks proposed dependencies together with current workspace paths before any insert', async () => {
    const f = await fixture();
    const rows = await schema.db
      .insert(schema.task)
      .values(
        ['first', 'last'].map((title) => ({
          title,
          organizationId: f.orgId,
          teamId: f.teamId,
          createdBy: f.humanActorId,
          state: 'todo' as const,
          statusId: f.statusId('task', 'todo'),
        })),
      )
      .returning();
    const first = rows[0],
      last = rows[1];
    if (!first || !last) throw new Error('Task fixture missing');
    await schema.db.insert(schema.taskDependency).values({
      organizationId: f.orgId,
      blockingTaskId: first.id,
      blockedTaskId: last.id,
    });
    await observeInsertAttempts();
    const document = PlanDocument.parse({
      nodes: [
        planNode('first', { status: 'confirmed', objectId: first.id }),
        planNode('last', { status: 'confirmed', objectId: last.id }),
        planNode('new'),
      ],
      edges: [
        { fromRef: 'last', toRef: 'new', kind: 'blocks' },
        { fromRef: 'new', toRef: 'first', kind: 'blocks' },
      ],
    });
    await expect(acceptedPlan(f, document, ['new'])).rejects.toMatchObject({ name: 'CycleError' });
    await expect(attemptedInsert()).resolves.toBe(false);
  });

  it('confirms a generated-child match without duplicating it and records all descendants once', async () => {
    const f = await fixture();
    const template = await published(f, 'project', 2);
    const document = PlanDocument.parse({
      nodes: [
        planNode('root', {
          kind: 'project',
          templateId: template.id,
          fields: { title: 'Plan root', teamId: f.teamId },
        }),
        planNode('child', { parentRef: 'root', fields: { title: 'child_0' } }),
      ],
      edges: [],
    });
    const result = await acceptedPlan(f, document, ['child']);
    expect(result.placed.map((entry) => entry.created)).toEqual([true, false]);
    const roots = await schema.db
      .select()
      .from(schema.project)
      .where(eq(schema.project.organizationId, f.orgId));
    expect(roots[0]?.blueprintState?.lastApplicationChangeSetId).toBe(result.changeSetId);
    const tasks = await schema.db
      .select()
      .from(schema.task)
      .where(eq(schema.task.organizationId, f.orgId));
    expect(tasks).toHaveLength(2);
    expect(result.row.document.nodes[1]?.objectId).toBe(
      tasks.find((row) => row.title === 'child_0')?.id,
    );
    expect(
      await schema.db
        .select()
        .from(schema.changeSetEntry)
        .where(eq(schema.changeSetEntry.changeSetId, result.changeSetId ?? '')),
    ).toHaveLength(3);
  });
});
