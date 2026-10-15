/** Real MCP authoring/execution acceptance; run only during an exclusive database test window. */
import type * as DbModule from '@docket/db';
import { WorkTemplateCreate } from '@docket/work/work-template-contract';
import { WorkScheduleOut, WorkScheduleRunOut } from '@docket/work/work-schedule-management';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { registerTools as RegisterTools } from '../../src/mcp/tools';
import { getMigratedDb } from '../support/db';
import { resetAuthMocks } from '../support/auth-mock';
import { body, closeCatalogClients, connectCatalog, errorText } from './mcp-catalog-harness';
import { seedMcpUpdateOrg } from './mcp-update-tool-fixtures';

let schema: typeof DbModule;
let registerTools: typeof RegisterTools;
beforeAll(async () => {
  schema = await getMigratedDb();
  registerTools = (await import('../../src/mcp/tools')).registerTools;
});
afterEach(async () => {
  vi.restoreAllMocks();
  await closeCatalogClients();
  resetAuthMocks();
});

async function fixture() {
  const seed = await seedMcpUpdateOrg(schema.db, schema, ['manage']);
  const client = await connectCatalog(registerTools, seed.ctx);
  const { createWorkTemplate, publishWorkTemplate } =
    await import('../../src/lib/templates/service');
  const template = await createWorkTemplate(
    { orgId: seed.orgId, actorId: seed.actorId },
    WorkTemplateCreate.parse({
      targetType: 'project',
      scope: 'organization',
      definition: { name: 'Event', payload: { targetType: 'project' } },
    }),
  );
  await publishWorkTemplate(
    { orgId: seed.orgId, actorId: seed.actorId },
    template.id,
    template.draftRevision,
  );
  const document = {
    kind: 'schedule',
    revision: 1,
    template: { targetType: 'project', workTypeId: template.id, selection: { kind: 'latest' } },
    titlePattern: '{month} Dinner',
    timezone: 'America/Los_Angeles',
    root: { kind: 'project', fields: {}, dates: {}, placement: {} },
    stepOverrides: [],
    optionalChoices: [],
  };
  return { ...seed, client, template, document };
}
const ScheduleReceipt = z.object({
  data: z.object({ result: z.literal('schedule'), schedule: WorkScheduleOut }),
});
const RunReceipt = z.object({
  data: z.object({ result: z.literal('run'), run: WorkScheduleRunOut }),
});

describe('real canonical schedule MCP', () => {
  it('returns owned failure codes and retries the same persisted run without private error text', async () => {
    const f = await fixture();
    const created = await f.client.callTool({
      name: 'manage_work_schedule',
      arguments: {
        orgId: f.orgId,
        command: {
          action: 'create',
          schedule: {
            name: 'Failure dinner',
            document: f.document,
            trigger: { kind: 'manual' },
            effectiveFrom: '2026-10-01',
          },
        },
      },
    });
    const schedule = ScheduleReceipt.parse(body(created)).data.schedule;
    const creation = await import('../../src/lib/work-creation/service');
    vi.spyOn(creation, 'createWorkBatchInTransaction').mockRejectedValueOnce(
      new Error('PRIVATE PROVIDER TOKEN'),
    );
    const failed = await f.client.callTool({
      name: 'manage_work_schedule',
      arguments: {
        orgId: f.orgId,
        command: {
          action: 'run',
          scheduleId: schedule.id,
          run: { scheduledFor: '2026-10-15', occurrenceKey: 'failed-once' },
        },
      },
    });
    const run = RunReceipt.parse(body(failed)).data.run;
    expect(run).toMatchObject({ status: 'failed', canRetry: true, failureCode: 'creation_failed' });
    expect(errorText(failed)).not.toContain('PRIVATE PROVIDER TOKEN');
    const retried = await f.client.callTool({
      name: 'manage_work_schedule',
      arguments: {
        orgId: f.orgId,
        command: { action: 'retry', scheduleId: schedule.id, occurrenceId: run.id },
      },
    });
    const saved = RunReceipt.parse(body(retried)).data.run;
    expect(saved.id).toBe(run.id);
    expect(saved.roots).toHaveLength(1);
    expect(saved.status).toBe('materialized');
    await schema.db.delete(schema.grant).where(eq(schema.grant.organizationId, f.orgId));
    const hidden = await f.client.callTool({
      name: 'list_work_schedules',
      arguments: { orgId: f.orgId, query: { action: 'detail', scheduleId: schedule.id } },
    });
    expect(hidden.isError).toBe(true);
    expect(errorText(hidden)).not.toContain('Failure dinner');
  });
  it('creates, reopens, runs idempotently and applies only checked future revisions', async () => {
    const f = await fixture();
    const invoke = async (command: Record<string, unknown>) => {
      const result = await f.client.callTool({
        name: 'manage_work_schedule',
        arguments: { orgId: f.orgId, command },
      });
      expect(result.isError, errorText(result)).not.toBe(true);
      return body(result);
    };
    const created = ScheduleReceipt.parse(
      await invoke({
        action: 'create',
        schedule: {
          name: 'Dinner',
          document: f.document,
          trigger: { kind: 'manual' },
          effectiveFrom: '2026-10-01',
        },
      }),
    ).data.schedule;
    const listed = await f.client.callTool({
      name: 'list_work_schedules',
      arguments: { orgId: f.orgId, query: { action: 'list' } },
    });
    expect(errorText(listed)).toContain(created.id);
    const run = { scheduledFor: '2026-10-15', occurrenceKey: 'dinner-one' };
    const first = RunReceipt.parse(await invoke({ action: 'run', scheduleId: created.id, run }))
      .data.run;
    const second = RunReceipt.parse(await invoke({ action: 'run', scheduleId: created.id, run }))
      .data.run;
    expect(first.roots).toHaveLength(1);
    expect(second.id).toBe(first.id);
    expect(second.roots).toEqual(first.roots);
    const updated = ScheduleReceipt.parse(
      await invoke({
        action: 'revise',
        scheduleId: created.id,
        revision: {
          name: 'Dinner future',
          document: { ...f.document, titlePattern: '{month} Community Dinner' },
          trigger: { kind: 'manual' },
          effectiveFrom: '2099-11-01',
          expectedRevisionId: created.revision.id,
        },
      }),
    ).data.schedule;
    expect(updated.revision.number).toBe(2);
    const stale = await f.client.callTool({
      name: 'manage_work_schedule',
      arguments: {
        orgId: f.orgId,
        command: {
          action: 'revise',
          scheduleId: created.id,
          revision: {
            document: f.document,
            trigger: { kind: 'manual' },
            effectiveFrom: '2099-12-01',
            expectedRevisionId: created.revision.id,
          },
        },
      },
    });
    expect(stale.isError).toBe(true);
    expect(
      await schema.db
        .select()
        .from(schema.project)
        .where(eq(schema.project.organizationId, f.orgId)),
    ).toHaveLength(2);
    expect(
      ScheduleReceipt.parse(await invoke({ action: 'pause', scheduleId: created.id })).data.schedule
        .status,
    ).toBe('paused');
    expect(
      ScheduleReceipt.parse(await invoke({ action: 'resume', scheduleId: created.id })).data
        .schedule.status,
    ).toBe('active');
  });

  it('preserves Program defaults on omitted authoring and clears only an explicit empty list', async () => {
    const f = await fixture();
    const define = async (args: Record<string, unknown>) => {
      const result = await f.client.callTool({
        name: 'define_template',
        arguments: { orgId: f.orgId, ...args },
      });
      expect(result.isError, errorText(result)).not.toBe(true);
      return body<{ revision: number; changes: { id: string }[] }>(result);
    };
    const created = await define({
      action: 'draft',
      name: 'Dinner Program',
      payload: { targetType: 'program' },
      defaultSchedules: [
        {
          key: 'dinner',
          name: 'Dinner',
          template: {
            targetType: 'project',
            workTypeId: f.template.id,
            selection: { kind: 'latest' },
          },
          titlePattern: '{month} Dinner',
          cadence: { kind: 'daily', interval: 1, startOffsetDays: 0 },
          teamRule: 'none',
          actorRule: 'unassigned',
        },
      ],
    });
    const templateId = created.changes[0]?.id ?? '';
    const updated = await define({
      action: 'draft',
      template: templateId,
      expectedRevision: created.revision,
      name: 'Community dinners',
    });
    const [saved] = await schema.db
      .select()
      .from(schema.template)
      .where(eq(schema.template.id, templateId));
    expect(saved?.draftDefinition.defaultSchedules).toHaveLength(1);
    const refused = await f.client.callTool({
      name: 'define_template',
      arguments: { orgId: f.orgId, template: templateId, defaultSchedules: [] },
    });
    expect(refused.isError).toBe(true);
    const lifecycle = await f.client.callTool({
      name: 'define_template',
      arguments: {
        orgId: f.orgId,
        action: 'publish',
        template: templateId,
        expectedRevision: updated.revision,
        defaultSchedules: [],
      },
    });
    expect(lifecycle.isError).toBe(true);
    await define({
      action: 'draft',
      template: templateId,
      expectedRevision: updated.revision,
      defaultSchedules: [],
    });
    const [cleared] = await schema.db
      .select()
      .from(schema.template)
      .where(eq(schema.template.id, templateId));
    expect(cleared?.draftDefinition.defaultSchedules).toEqual([]);
  });
});
