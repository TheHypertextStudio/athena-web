import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { and, eq } from 'drizzle-orm';
import { beforeAll, afterEach, describe, expect, it } from 'vitest';
import type { registerWorkGraphTool as RegisterGraph } from '../../src/mcp/work-graph-tool';
import type { registerViewPlanTools as RegisterViews } from '../../src/mcp/view-plan-tools';
import type { registerApps as RegisterApps } from '../../src/mcp/apps';
import type * as DbModule from '@docket/db';
import { getMigratedDb } from '../support/db';
import { seedMcpSurfaceOrg } from './mcp-surface-fixtures';
import { resetAuthMocks } from '../support/auth-mock';
import type { GraphSnapshot } from '../../src/work-graph/contract';

let schema: typeof DbModule;
let register: typeof RegisterGraph;
let apps: typeof RegisterApps;
let views: typeof RegisterViews;
const open: (() => Promise<void>)[] = [];
beforeAll(async () => {
  schema = await getMigratedDb();
  register = (await import('../../src/mcp/work-graph-tool')).registerWorkGraphTool;
  apps = (await import('../../src/mcp/apps')).registerApps;
  views = (await import('../../src/mcp/view-plan-tools')).registerViewPlanTools;
});
afterEach(async () => {
  resetAuthMocks();
  await Promise.all(open.splice(0).map((close) => close()));
});
async function seedGraph() {
  const s = await seedMcpSurfaceOrg(schema.db, schema, ['view']);
  await schema.db
    .update(schema.task)
    .set({ projectId: s.projectId })
    .where(eq(schema.task.id, s.taskId));
  await schema.db
    .insert(schema.taskDependency)
    .values({ organizationId: s.orgId, blockingTaskId: s.task2Id, blockedTaskId: s.taskId });
  const server = new McpServer(
    { name: 'graph-test', version: '1' },
    { capabilities: { tools: {}, resources: {} } },
  );
  register(server, s.ctx);
  views(server, s.ctx);
  apps(server);
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '1' });
  await Promise.all([server.connect(st), client.connect(ct)]);
  open.push(async () => {
    await client.close();
    await server.close();
  });
  return { ...s, client };
}
function evidence(name: string, data: unknown) {
  const dir = process.env['GRAPH_EVIDENCE_DIR'];
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name + '.json'), JSON.stringify(data));
}
describe('view_work_graph', () => {
  it('exposes a read-only graph with visible external blockers and a real app resource', async () => {
    const s = await seedGraph();
    const tool = (await s.client.listTools()).tools.find((t) => t.name === 'view_work_graph');
    expect(tool?.annotations?.readOnlyHint).toBe(true);
    expect(tool?._meta?.['ui']).toMatchObject({ resourceUri: 'ui://docket/work-graph' });
    const result = await s.client.callTool({
      name: 'view_work_graph',
      arguments: { orgId: s.orgId, scope: { kind: 'project', id: s.projectId } },
    });
    expect(result.isError).not.toBe(true);
    const data = result.structuredContent as GraphSnapshot;
    expect(data.totals.total).toBe(1);
    expect(data.nodes.find((n) => n.id === s.task2Id)?.external).toBe(true);
    expect(data.edges).toContainEqual(
      expect.objectContaining({ source: `task:${s.task2Id}`, target: `task:${s.taskId}` }),
    );
    evidence('resource', await s.client.readResource({ uri: 'ui://docket/work-graph' }));
    evidence('populated', data);
  });
  it('never exposes private dependency titles, identities or counts and rechecks revoked access', async () => {
    const s = await seedGraph();
    await schema.db
      .update(schema.grant)
      .set({ cascades: false })
      .where(eq(schema.grant.organizationId, s.orgId));
    await schema.db
      .update(schema.task)
      .set({ visibility: 'private' })
      .where(eq(schema.task.id, s.task2Id));
    const args = { orgId: s.orgId, scope: { kind: 'project', id: s.projectId } };
    const result = await s.client.callTool({ name: 'view_work_graph', arguments: args });
    expect(JSON.stringify(result)).not.toContain(s.task2Id);
    expect((result.structuredContent as GraphSnapshot).totals.total).toBe(1);
    await schema.db
      .update(schema.project)
      .set({ visibility: 'private' })
      .where(eq(schema.project.id, s.projectId));
    await schema.db
      .delete(schema.grant)
      .where(and(eq(schema.grant.organizationId, s.orgId), eq(schema.grant.resourceId, s.orgId)));
    const denied = await s.client.callTool({ name: 'view_work_graph', arguments: args });
    expect(denied.isError).toBe(true);
    expect(JSON.stringify(denied)).not.toContain('Proj');
  });
  it('traverses program placement and initiative contributions without duplicate work', async () => {
    const s = await seedGraph();
    await schema.db
      .update(schema.project)
      .set({ programId: s.programId })
      .where(eq(schema.project.id, s.projectId));
    await schema.db
      .update(schema.task)
      .set({ programId: s.programId })
      .where(eq(schema.task.id, s.task2Id));
    await schema.db
      .insert(schema.initiativeProject)
      .values({ organizationId: s.orgId, initiativeId: s.initiativeId, projectId: s.projectId });
    await schema.db
      .insert(schema.initiativeProgram)
      .values({ organizationId: s.orgId, initiativeId: s.initiativeId, programId: s.programId });
    const result = await s.client.callTool({
      name: 'view_work_graph',
      arguments: {
        orgId: s.orgId,
        scope: { kind: 'initiative', id: s.initiativeId },
        display: 'fullscreen',
        expanded: [`program:${s.programId}`, `project:${s.projectId}`],
      },
    });
    expect(result.isError).not.toBe(true);
    const data = result.structuredContent as GraphSnapshot;
    expect(data.totals.total).toBe(2);
    expect(new Set(data.nodes.map((n) => n.key)).size).toBe(data.nodes.length);
    expect(data.relations.some((r) => r.kind === 'contributes')).toBe(true);
    evidence('grouped', data);
  });
  it('does not accept a root from another workspace', async () => {
    const s = await seedGraph();
    const other = await seedMcpSurfaceOrg(schema.db, schema, ['view']);
    const result = await s.client.callTool({
      name: 'view_work_graph',
      arguments: { orgId: s.orgId, scope: { kind: 'project', id: other.projectId } },
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).not.toContain(other.projectId);
  });
  it('uses custom status categories and highlights list matches without removing dependency context', async () => {
    const s = await seedGraph();
    const [status] = await schema.db
      .insert(schema.workStatus)
      .values({
        organizationId: s.orgId,
        entityType: 'task',
        key: 'released',
        name: 'Released',
        category: 'completed',
        position: 3,
      })
      .returning();
    if (!status) throw new Error('Status fixture was not created');
    await schema.db
      .update(schema.task)
      .set({ state: 'released', statusId: status.id, completedAt: new Date() })
      .where(eq(schema.task.id, s.taskId));
    const result = await s.client.callTool({
      name: 'view_work_graph',
      arguments: {
        orgId: s.orgId,
        scope: { kind: 'project', id: s.projectId },
        completion: 'all',
        focusFilter: { project: s.projectId, state: ['released'] },
      },
    });
    expect(result.isError).not.toBe(true);
    const data = result.structuredContent as GraphSnapshot;
    expect(data.totals.completed).toBe(1);
    expect(data.nodes.find((n) => n.id === s.taskId)).toMatchObject({
      category: 'completed',
      status: 'Released',
      matched: true,
    });
    expect(data.nodes.find((n) => n.id === s.task2Id)).toMatchObject({
      external: true,
      matched: false,
    });
  });
  it('does not disclose a private project identity through the list graph entrypoint', async () => {
    const s = await seedGraph();
    await schema.db
      .update(schema.grant)
      .set({ cascades: false })
      .where(eq(schema.grant.organizationId, s.orgId));
    await schema.db
      .update(schema.task)
      .set({ projectId: null })
      .where(eq(schema.task.id, s.taskId));
    await schema.db
      .update(schema.project)
      .set({ visibility: 'private' })
      .where(eq(schema.project.id, s.projectId));
    const result = await s.client.callTool({
      name: 'list_work',
      arguments: { orgId: s.orgId, entity: 'task', project: 'Proj' },
    });
    expect(result.isError).not.toBe(true);
    const response = result.structuredContent as { items: unknown[]; graphScope?: unknown };
    expect(response.items).toEqual([]);
    expect(response.graphScope).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain(s.projectId);
  });
  it('requires organization read authorization as well as workspace membership', async () => {
    const s = await seedGraph();
    await schema.db.delete(schema.grant).where(eq(schema.grant.organizationId, s.orgId));
    const result = await s.client.callTool({
      name: 'view_work_graph',
      arguments: { orgId: s.orgId, scope: { kind: 'project', id: s.projectId } },
    });
    expect(result.isError).toBe(true);
  });
});
