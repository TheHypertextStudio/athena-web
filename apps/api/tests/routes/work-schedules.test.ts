import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type * as DbModule from '@docket/db';
import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import {
  WorkScheduleDetailOut,
  WorkScheduleRunOut,
  WorkSchedulePreviewOut,
} from '@docket/work/work-schedule-management';
import * as creation from '../../src/lib/work-creation/service';
import type schedulesRouter from '../../src/routes/work-schedules';
import type recurrenceRouter from '../../src/routes/recurrence-series';
import { appWithActor, getDb, one, seedBaseOrg } from '../support/routes-harness';
import { createSchedule, scheduleRouteFixture } from './work-schedule-fixture';
let schema: typeof DbModule;
let router: typeof schedulesRouter;
let legacyRouter: typeof recurrenceRouter;
beforeAll(async () => {
  schema = await getDb();
  router = (await import('../../src/routes/work-schedules')).default;
  legacyRouter = (await import('../../src/routes/recurrence-series')).default;
});
afterEach(() => vi.restoreAllMocks());
const headers = { 'content-type': 'application/json' };
describe('canonical Program schedule routes', () => {
  it('rejects backdated, equal-boundary and ended edits through both preview and revision routes', async () => {
    const f = await scheduleRouteFixture(schema, router);
    const schedule = await createSchedule(f);
    const revision = {
      document: f.command.document,
      trigger: { kind: 'manual' },
      effectiveFrom: '2099-11-01',
      expectedRevisionId: schedule.revision.id,
    };
    const response = await f.app.request(`/${schedule.id}/revisions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(revision),
    });
    expect(response.status).toBe(200);
    const current = WorkScheduleDetailOut.parse(await response.json());
    for (const suffix of ['preview', 'revisions']) {
      for (const effectiveFrom of ['2000-01-01', '2099-10-31', '2099-11-01']) {
        const rejected = await f.app.request(`/${schedule.id}/${suffix}`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            ...revision,
            effectiveFrom,
            expectedRevisionId: current.revision.id,
          }),
        });
        expect(rejected.status).toBe(409);
      }
    }
    expect(
      (
        await f.app.request(`/${schedule.id}/lifecycle`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ action: 'end' }),
        })
      ).status,
    ).toBe(200);
    for (const suffix of ['preview', 'revisions']) {
      expect(
        (
          await f.app.request(`/${schedule.id}/${suffix}`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              ...revision,
              effectiveFrom: '2099-12-01',
              expectedRevisionId: current.revision.id,
            }),
          })
        ).status,
      ).toBe(409);
    }
    const unchanged = WorkScheduleDetailOut.parse(
      await (await f.app.request(`/${schedule.id}`)).json(),
    );
    expect(unchanged.revision.id).toBe(current.revision.id);
    expect(unchanged.revision.number).toBe(2);
  });

  it('accepts inherited organization params on the actual mounted detail, preview and lifecycle paths', async () => {
    const f = await scheduleRouteFixture(schema, router);
    const mounted = new Hono().route('/v1/orgs/:orgId/work-schedules', f.app);
    const prefix = `/v1/orgs/${f.orgId}/work-schedules`;
    const created = await mounted.request(prefix, {
      method: 'POST',
      headers,
      body: JSON.stringify(f.command),
    });
    expect(created.status).toBe(201);
    const schedule = WorkScheduleDetailOut.parse(await created.json());
    expect((await mounted.request(`${prefix}/${schedule.id}`)).status).toBe(200);
    const preview = await mounted.request(`${prefix}/${schedule.id}/preview`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        document: f.command.document,
        trigger: f.command.trigger,
        effectiveFrom: '2026-11-01',
        expectedRevisionId: schedule.revision.id,
      }),
    });
    expect(preview.status).toBe(200);
    const pause = await mounted.request(`${prefix}/${schedule.id}/lifecycle`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ action: 'pause' }),
    });
    expect(pause.status).toBe(200);
  });

  it('previews real first-run dates and overrides without creating work or schedules', async () => {
    const f = await scheduleRouteFixture(schema, router);
    const response = await f.app.request('/preview', {
      method: 'POST',
      headers,
      body: JSON.stringify(f.command),
    });
    expect(response.status).toBe(200);
    const preview = WorkSchedulePreviewOut.parse(await response.json());
    expect(preview).toMatchObject({ scheduledFor: '2026-10-08', title: 'October Dinner' });
    expect(preview.descendants).toEqual([
      expect.objectContaining({ title: 'Book venue', dates: { dueDate: '2026-10-01' } }),
    ]);
    expect(
      await schema.db
        .select()
        .from(schema.recurrenceSeries)
        .where(eq(schema.recurrenceSeries.organizationId, f.orgId)),
    ).toHaveLength(0);
    expect(
      await schema.db
        .select()
        .from(schema.project)
        .where(eq(schema.project.organizationId, f.orgId)),
    ).toHaveLength(0);
  });
  it('creates one dinner, records safe failed-run history, and retries without duplicate work', async () => {
    const f = await scheduleRouteFixture(schema, router);
    const schedule = await createSchedule(f);
    vi.spyOn(creation, 'createWorkBatchInTransaction').mockRejectedValueOnce(
      new Error('PRIVATE PROVIDER DUMP'),
    );
    const failedResponse = await f.app.request(`/${schedule.id}/runs`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ scheduledFor: '2026-10-08' }),
    });
    expect(failedResponse.status).toBe(200);
    const failed = WorkScheduleRunOut.parse(await failedResponse.json());
    expect(failed).toMatchObject({
      status: 'failed',
      failureCode: 'creation_failed',
      canRetry: true,
      roots: [],
    });
    const history = WorkScheduleDetailOut.parse(
      await (await f.app.request(`/${schedule.id}`)).json(),
    );
    expect(history.runs.items).toHaveLength(1);
    expect(history.failedRunCount).toBe(1);
    expect(JSON.stringify(history)).not.toContain('PRIVATE PROVIDER');
    const retriedResponse = await f.app.request(`/${schedule.id}/runs/${failed.id}/retry`, {
      method: 'POST',
    });
    expect(retriedResponse.status).toBe(200);
    const retried = WorkScheduleRunOut.parse(await retriedResponse.json());
    expect(retried).toMatchObject({
      id: failed.id,
      status: 'materialized',
      attempt: 2,
      canRetry: false,
    });
    expect(retried.roots).toHaveLength(1);
    const recovered = WorkScheduleDetailOut.parse(
      await (await f.app.request(`/${schedule.id}`)).json(),
    );
    expect(recovered.failedRunCount).toBe(0);
    expect(
      await schema.db
        .select()
        .from(schema.project)
        .where(eq(schema.project.organizationId, f.orgId)),
    ).toEqual([expect.objectContaining({ name: 'October Dinner', programId: f.program.id })]);
    expect(
      await schema.db.select().from(schema.task).where(eq(schema.task.organizationId, f.orgId)),
    ).toHaveLength(1);
  });
  it('keeps pause/resume/end idempotent and refuses execution after ending', async () => {
    const f = await scheduleRouteFixture(schema, router);
    const schedule = await createSchedule(f);
    for (const action of ['pause', 'pause', 'resume', 'end', 'end']) {
      const response = await f.app.request(`/${schedule.id}/lifecycle`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ action }),
      });
      expect(response.status).toBe(200);
    }
    expect(
      (
        await f.app.request(`/${schedule.id}/lifecycle`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ action: 'resume' }),
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await f.app.request(`/${schedule.id}/runs`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ scheduledFor: '2026-10-08' }),
        })
      ).status,
    ).toBe(404);
    expect(
      await schema.db
        .select()
        .from(schema.processOccurrence)
        .where(eq(schema.processOccurrence.organizationId, f.orgId)),
    ).toHaveLength(0);
  });
  it('hides another tenant and a nonowner contributor before names, draft details or pagination keys', async () => {
    const f = await scheduleRouteFixture(schema, router);
    const schedule = await createSchedule(f);
    const foreign = await seedBaseOrg(schema.db, schema);
    const foreignApp = appWithActor(router, foreign.orgId, ['manage'], foreign.humanActorId);
    expect((await foreignApp.request(`/${schedule.id}`)).status).toBe(404);
    const other = one(
      await schema.db
        .insert(schema.actor)
        .values({ organizationId: f.orgId, kind: 'human', displayName: 'Other member' })
        .returning(),
    );
    await schema.db.insert(schema.grant).values({
      organizationId: f.orgId,
      subjectKind: 'actor',
      subjectId: other.id,
      resourceKind: 'organization',
      resourceId: f.orgId,
      capabilities: ['contribute'],
      effect: 'allow',
      cascades: true,
    });
    const otherApp = appWithActor(router, f.orgId, ['contribute'], other.id);
    const legacyOther = appWithActor(legacyRouter, f.orgId, ['contribute'], other.id);
    expect((await legacyOther.request(`/${schedule.id}`)).status).toBe(404);
    expect(await (await legacyOther.request('/')).json()).toEqual({ items: [] });
    expect(
      (
        await legacyOther.request(`/${schedule.id}/lifecycle`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ action: 'pause' }),
        })
      ).status,
    ).toBe(404);

    expect((await otherApp.request(`/${schedule.id}`)).status).toBe(404);
    expect(await (await otherApp.request(`/?ownerProgramId=${f.program.id}`)).json()).toEqual({
      items: [],
    });
    expect(
      (
        await otherApp.request(`/${schedule.id}/lifecycle`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ action: 'pause' }),
        })
      ).status,
    ).toBe(404);
  });
  it('rejects a stale future revision without changing historical runs or ownership', async () => {
    const f = await scheduleRouteFixture(schema, router);
    const schedule = await createSchedule(f);
    const body = {
      document: f.command.document,
      trigger: { kind: 'manual' },
      effectiveFrom: '2026-11-01',
      expectedRevisionId: schedule.revision.id,
    };
    const first = await f.app.request(`/${schedule.id}/revisions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    expect(first.status).toBe(200);
    expect(
      (
        await f.app.request(`/${schedule.id}/revisions`, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
        })
      ).status,
    ).toBe(409);
    const detail = WorkScheduleDetailOut.parse(
      await (await f.app.request(`/${schedule.id}`)).json(),
    );
    expect(detail.ownerProgramId).toBe(f.program.id);
    expect(detail.revision.number).toBe(2);
    expect(detail.runs.items).toHaveLength(0);
  });
  it('shows the authorized actual upcoming title after manual renaming and a future pattern edit', async () => {
    const f = await scheduleRouteFixture(schema, router);
    const schedule = await createSchedule(f);
    const response = await f.app.request(`/${schedule.id}/runs`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ scheduledFor: '2099-11-12' }),
    });
    expect(response.status).toBe(200);
    const run = WorkScheduleRunOut.parse(await response.json());
    const root = one(run.roots);
    expect(root.kind).toBe('project');
    await schema.db
      .update(schema.project)
      .set({ name: 'Dinner at the community hall' })
      .where(eq(schema.project.id, root.id));
    const edited = await f.app.request(`/${schedule.id}/revisions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        document: { ...f.command.document, titlePattern: '{month} Gathering' },
        trigger: { kind: 'manual' },
        effectiveFrom: '2099-11-01',
        expectedRevisionId: schedule.revision.id,
      }),
    });
    expect(edited.status).toBe(200);
    const detail = WorkScheduleDetailOut.parse(await edited.json());
    expect(detail.nextRunDate).toBe('2099-11-12');
    expect(detail.nextWorkTitle).toBe('Dinner at the community hall');
  });
});
