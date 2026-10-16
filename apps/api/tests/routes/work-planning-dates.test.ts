import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import type * as DbModule from '@docket/db';
import { appWithActor, getDb, seedTaskAccessOrg } from '../support/routes-harness';
import type projectsRouter from '../../src/routes/projects';
import type initiativesRouter from '../../src/routes/initiatives';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let projects!: typeof projectsRouter;
let initiatives!: typeof initiativesRouter;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  projects = (await import('../../src/routes/projects')).default;
  initiatives = (await import('../../src/routes/initiatives')).default;
});

/** Parse a JSON response body as the given shape. */
async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

describe('work planning dates preserve fiscal snapshots', () => {
  it('creates and updates exact or broad planning dates as atomic fiscal snapshots', async () => {
    const { orgId, humanActorId } = await seedTaskAccessOrg(db, schema, 'contribute');
    await db
      .update(schema.organization)
      .set({ fiscalYearStartMonth: 3 })
      .where(eq(schema.organization.id, orgId));
    const writer = appWithActor(projects, orgId, ['contribute'], humanActorId);

    const created = await writer.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Fiscal launch',
        startDate: '2026-04-01',
        startDateResolution: 'quarter',
        targetDate: '2027-03-31',
        targetDateResolution: 'year',
      }),
    });
    expect(created.status).toBe(201);
    const body = await json<{
      id: string;
      startDateResolution: string | null;
      startDateFiscalYearStartMonth: number | null;
      targetDateResolution: string | null;
      targetDateFiscalYearStartMonth: number | null;
    }>(created);
    expect(body).toMatchObject({
      startDateResolution: 'quarter',
      startDateFiscalYearStartMonth: 3,
      targetDateResolution: 'year',
      targetDateFiscalYearStartMonth: 3,
    });

    await db
      .update(schema.organization)
      .set({ fiscalYearStartMonth: 0 })
      .where(eq(schema.organization.id, orgId));
    expect(await json(await writer.request(`/${body.id}`))).toMatchObject({
      startDateResolution: 'quarter',
      startDateFiscalYearStartMonth: 3,
      targetDateResolution: 'year',
      targetDateFiscalYearStartMonth: 3,
    });

    const exact = await writer.request(`/${body.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ targetDate: '2026-12-15' }),
    });
    expect(exact.status).toBe(200);
    expect(await json(exact)).toMatchObject({
      targetDate: '2026-12-15T00:00:00.000Z',
      targetDateResolution: null,
      targetDateFiscalYearStartMonth: null,
    });

    const resolutionOnly = await writer.request(`/${body.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ targetDateResolution: 'month' }),
    });
    expect(resolutionOnly.status).toBe(422);

    const noncanonical = await writer.request(`/${body.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ targetDate: '2026-12-01', targetDateResolution: 'quarter' }),
    });
    expect(noncanonical.status).toBe(422);

    const reversed = await writer.request(`/${body.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ targetDate: '2026-03-01' }),
    });
    expect(reversed.status).toBe(422);
  });

  it('persists broad target periods with the workspace fiscal basis', async () => {
    const { orgId, humanActorId } = await seedTaskAccessOrg(db, schema, 'contribute');
    await db
      .update(schema.organization)
      .set({ fiscalYearStartMonth: 6 })
      .where(eq(schema.organization.id, orgId));
    const writer = appWithActor(initiatives, orgId, ['contribute'], humanActorId);

    const created = await writer.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Second-half initiative',
        targetDate: '2027-06-30',
        targetDateResolution: 'halfYear',
      }),
    });
    expect(created.status).toBe(201);
    const body = await json<{
      id: string;
      targetDateResolution: string | null;
      targetDateFiscalYearStartMonth: number | null;
    }>(created);
    expect(body).toMatchObject({
      targetDateResolution: 'halfYear',
      targetDateFiscalYearStartMonth: 6,
    });

    const invalid = await writer.request(`/${body.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ targetDateResolution: 'month' }),
    });
    expect(invalid.status).toBe(422);

    const cleared = await writer.request(`/${body.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ targetDate: null }),
    });
    expect(cleared.status).toBe(200);
    expect(await json(cleared)).toMatchObject({
      targetDate: null,
      targetDateResolution: null,
      targetDateFiscalYearStartMonth: null,
    });
  });
});
