/** Legacy aliases never confer access to another person's private schedule or literal process body. */
import type * as DbModule from '@docket/db';
import { assertDefined } from '@docket/test-utils';
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type processRouter from '../../src/routes/process-definitions';
import type recurrenceRouter from '../../src/routes/recurrence-series';
import type { registerTools as RegisterTools } from '../../src/mcp/tools';
import { appWithActor, getDb } from '../support/routes-harness';
import { seedMcpUpdateOrg } from '../mcp/mcp-update-tool-fixtures';
import { closeCatalogClients, connectCatalog, errorText } from '../mcp/mcp-catalog-harness';
import { resetAuthMocks } from '../support/auth-mock';
import { legacyPrivacyFixture } from './legacy-schedule-privacy-fixture';
let schema: typeof DbModule;
let processes: typeof processRouter;
let recurrence: typeof recurrenceRouter;
let registerTools: typeof RegisterTools;
beforeAll(async () => {
  schema = await getDb();
  processes = (await import('../../src/routes/process-definitions')).default;
  recurrence = (await import('../../src/routes/recurrence-series')).default;
  registerTools = (await import('../../src/mcp/tools')).registerTools;
});
afterEach(async () => {
  await closeCatalogClients();
  resetAuthMocks();
});
const headers = { 'content-type': 'application/json' };
describe('private legacy process and schedule compatibility', () => {
  it('hides private definitions and non-null legacy series from another contributor or Program manager', async () => {
    const f = await legacyPrivacyFixture(schema, processes, recurrence);
    const detail = await f.otherProcesses.request(`/${f.published.definitionId}`);
    expect(detail.status).toBe(404);
    expect(await detail.text()).not.toContain('PRIVATE');
    expect(await (await f.otherProcesses.request('/')).text()).not.toContain(
      f.published.definitionId,
    );
    expect((await f.otherRecurrence.request(`/${f.series.id}`)).status).toBe(404);
    expect(await (await f.otherRecurrence.request('/')).text()).not.toContain(f.series.id);
    const client = await connectCatalog(registerTools, f.otherContext);
    const scheduled = await client.callTool({
      name: 'schedule_process',
      arguments: {
        orgId: f.orgId,
        series: {
          processDefinitionId: f.published.definitionId,
          name: 'Unauthorized copy',
          trigger: { kind: 'manual' },
          effectiveFrom: '2026-10-15',
        },
      },
    });
    expect(scheduled.isError, errorText(scheduled)).toBe(true);
    expect(errorText(scheduled)).not.toContain('PRIVATE');
  });
  it('retains owner and actual workspace manager access with exactly the same aliases', async () => {
    const f = await legacyPrivacyFixture(schema, processes, recurrence);
    const owner = await f.ownerProcesses.request(`/${f.published.definitionId}`);
    expect(owner.status).toBe(200);
    expect(await owner.json()).toMatchObject({
      id: f.published.definitionId,
      revision: { id: f.published.revisionId },
    });
    await schema.db
      .update(schema.grant)
      .set({ capabilities: ['manage'], cascades: true })
      .where(
        and(
          eq(schema.grant.organizationId, f.orgId),
          eq(schema.grant.subjectId, f.sarahId),
          eq(schema.grant.resourceKind, 'organization'),
        ),
      );
    expect((await f.otherProcesses.request(`/${f.published.definitionId}`)).status).toBe(200);
    const series = await f.otherRecurrence.request(`/${f.series.id}`);
    expect(series.status).toBe(200);
    expect(await series.json()).toMatchObject({
      id: f.series.id,
      processDefinitionId: f.published.definitionId,
      occurrences: [
        expect.objectContaining({ id: f.run.occurrenceId, processInstanceId: f.run.instanceId }),
      ],
    });
  });
  it('hides generated backlinks from another contributor', async () => {
    const f = await legacyPrivacyFixture(schema, processes, recurrence);
    const taskId = assertDefined(f.run.taskIdsByKey['prepare']);
    expect(await (await f.otherRecurrence.request(`/for-task/${taskId}`)).json()).toBeNull();
  });
  it('checks every private source child before snapshot publication', async () => {
    const f = await legacyPrivacyFixture(schema, processes, recurrence);
    const copy = await f.otherProcesses.request('/from-project', {
      method: 'POST',
      headers,
      body: JSON.stringify({ projectId: f.projectId, creationMode: 'all_at_once' }),
    });
    expect(copy.status).toBe(404);
    expect(await copy.text()).not.toContain('PRIVATE SOURCE BODY');
    const definitions = await schema.db
      .select()
      .from(schema.invocationHead)
      .where(eq(schema.invocationHead.organizationId, f.orgId));
    expect(definitions).toHaveLength(1);
  });
  it('retains schedule history aliases while omitting mapped work the current manager cannot view', async () => {
    const f = await legacyPrivacyFixture(schema, processes, recurrence);
    const taskId = assertDefined(f.run.taskIdsByKey['prepare']);
    await schema.db
      .update(schema.task)
      .set({ visibility: 'private' })
      .where(eq(schema.task.id, taskId));
    await schema.db
      .update(schema.grant)
      .set({ capabilities: ['manage'], cascades: false })
      .where(
        and(
          eq(schema.grant.organizationId, f.orgId),
          eq(schema.grant.subjectId, f.sarahId),
          eq(schema.grant.resourceKind, 'organization'),
        ),
      );
    const response = await f.otherRecurrence.request(`/${f.series.id}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      id: f.series.id,
      occurrences: [
        expect.objectContaining({
          id: f.run.occurrenceId,
          processInstanceId: f.run.instanceId,
          taskId: null,
        }),
      ],
    });
    expect(await (await f.otherRecurrence.request(`/for-task/${taskId}`)).json()).toBeNull();
  });
  it('does not resolve definition, schedule or generated-work aliases across tenants', async () => {
    const f = await legacyPrivacyFixture(schema, processes, recurrence);
    const other = await seedMcpUpdateOrg(schema.db, schema, ['manage']);
    const processApp = appWithActor(processes, other.orgId, ['manage'], other.actorId);
    const recurrenceApp = appWithActor(recurrence, other.orgId, ['manage'], other.actorId);
    expect((await processApp.request(`/${f.published.definitionId}`)).status).toBe(404);
    expect((await recurrenceApp.request(`/${f.series.id}`)).status).toBe(404);
    expect(
      await (await recurrenceApp.request(`/for-task/${f.run.taskIdsByKey['prepare']}`)).json(),
    ).toBeNull();
  });
  it('does not partially archive a definition when an associated Program schedule is outside current scope', async () => {
    const f = await legacyPrivacyFixture(schema, processes, recurrence);
    await schema.db.insert(schema.recurrenceSeries).values({
      organizationId: f.orgId,
      definitionId: f.published.definitionId,
      ownerProgramId: f.program.id,
      createdBy: f.actorId,
      name: 'Private Program schedule',
    });
    await schema.db
      .delete(schema.grant)
      .where(and(eq(schema.grant.organizationId, f.orgId), eq(schema.grant.subjectKind, 'role')));
    await schema.db.insert(schema.grant).values({
      organizationId: f.orgId,
      subjectKind: 'actor',
      subjectId: f.actorId,
      resourceKind: 'organization',
      resourceId: f.orgId,
      capabilities: ['contribute'],
      effect: 'allow',
      cascades: false,
    });
    expect(
      (await f.ownerProcesses.request(`/${f.published.definitionId}`, { method: 'DELETE' })).status,
    ).toBe(404);
    const [head] = await schema.db
      .select()
      .from(schema.invocationHead)
      .where(eq(schema.invocationHead.id, f.published.definitionId));
    expect(head?.archivedAt).toBeNull();
    const retained = await schema.db
      .select()
      .from(schema.processDefinition)
      .where(eq(schema.processDefinition.id, f.published.definitionId));
    for (const definition of retained)
      expect(definition).toMatchObject({ status: 'published', archivedAt: null });
    const series = await schema.db
      .select()
      .from(schema.recurrenceSeries)
      .where(eq(schema.recurrenceSeries.definitionId, f.published.definitionId));
    expect(series).toHaveLength(2);
    expect(series.every((row) => row.status === 'active' && row.endedAt === null)).toBe(true);
  });
  it('denies revoked or inactive owners and refuses private metadata, publication and lifecycle writes', async () => {
    const f = await legacyPrivacyFixture(schema, processes, recurrence);
    expect(
      (
        await f.otherProcesses.request(`/${f.published.definitionId}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ name: 'Stolen' }),
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await f.otherProcesses.request(`/${f.published.definitionId}/revisions`, {
          method: 'POST',
          headers,
          body: JSON.stringify(f.definition),
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await f.otherRecurrence.request(`/${f.series.id}/lifecycle`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ action: 'pause' }),
        })
      ).status,
    ).toBe(404);
    await schema.db
      .update(schema.actor)
      .set({ status: 'suspended' })
      .where(eq(schema.actor.id, f.actorId));
    expect((await f.ownerProcesses.request(`/${f.published.definitionId}`)).status).toBe(404);
    await schema.db
      .update(schema.actor)
      .set({ status: 'active' })
      .where(eq(schema.actor.id, f.actorId));
    await schema.db
      .delete(schema.grant)
      .where(and(eq(schema.grant.organizationId, f.orgId), eq(schema.grant.subjectKind, 'role')));
    expect((await f.ownerProcesses.request(`/${f.published.definitionId}`)).status).toBe(404);
    expect((await f.ownerRecurrence.request(`/${f.series.id}`)).status).toBe(404);
  });
});
