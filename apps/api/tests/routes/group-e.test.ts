import { beforeAll, describe, expect, it, vi } from 'vitest';

import type * as DbModule from '@docket/db';

import { appWithActor, getDb, seedBaseOrg } from '../support/routes-harness';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
const r: Record<string, unknown> = {};

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  r['cycles'] = (await import('../../src/routes/cycles')).default;
  r['programs'] = (await import('../../src/routes/programs')).default;
  r['saved-views'] = (await import('../../src/routes/saved-views')).default;
  r['labels'] = (await import('../../src/routes/labels')).default;
  r['agents'] = (await import('../../src/routes/agents')).default;
  r['roles'] = (await import('../../src/routes/roles')).default;
  r['integrations'] = (await import('../../src/routes/integrations')).default;
  r['billing'] = (await import('../../src/routes/billing')).default;
});

const MISSING = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const J = { 'content-type': 'application/json' };
async function body<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

describe('minimal patches cover the "field-absent" spread branches', () => {
  it('cycles: patch a single field', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const w = appWithActor(r['cycles'], orgId, ['contribute'], humanActorId);
    const created = await w.request('/', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ teamId, number: 1, startsAt: '2026-01-01', endsAt: '2026-01-14' }),
    });
    const id = (await body<{ id: string }>(created)).id;
    const patched = await w.request(`/${id}`, {
      method: 'PATCH',
      headers: J,
      body: JSON.stringify({ status: 'active' }),
    });
    expect(patched.status).toBe(200);
  });

  it('programs: patch a single field', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const w = appWithActor(r['programs'], orgId, ['manage'], humanActorId);
    const created = await w.request('/', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ name: 'P' }),
    });
    const id = (await body<{ id: string }>(created)).id;
    expect(
      (
        await w.request(`/${id}`, {
          method: 'PATCH',
          headers: J,
          body: JSON.stringify({ status: 'paused' }),
        })
      ).status,
    ).toBe(200);
  });

  it('saved-views: patch a single field', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const w = appWithActor(r['saved-views'], orgId, ['contribute'], humanActorId);
    const created = await w.request('/', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ name: 'V' }),
    });
    const id = (await body<{ id: string }>(created)).id;
    expect(
      (
        await w.request(`/${id}`, {
          method: 'PATCH',
          headers: J,
          body: JSON.stringify({ name: 'V2' }),
        })
      ).status,
    ).toBe(200);
  });

  it('labels: create with a teamless/groupless body + patch a single field', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const w = appWithActor(r['labels'], orgId, ['contribute'], humanActorId);
    // No group (covers `group ?? null` null side) and no teamId.
    const created = await w.request('/', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ name: 'plain', color: '#111' }),
    });
    expect(created.status).toBe(200);
    const id = (await body<{ id: string }>(created)).id;
    expect(
      (
        await w.request(`/${id}`, {
          method: 'PATCH',
          headers: J,
          body: JSON.stringify({ color: '#222' }),
        })
      ).status,
    ).toBe(200);
  });

  it('agents: create without approvalPolicy + patch a single field', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const w = appWithActor(r['agents'], orgId, ['manage'], humanActorId);
    const created = await w.request('/', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ displayName: 'NoPolicy' }),
    });
    expect(created.status).toBe(200);
    const id = (await body<{ id: string }>(created)).id;
    expect(
      (
        await w.request(`/${id}`, {
          method: 'PATCH',
          headers: J,
          body: JSON.stringify({ guidance: 'x' }),
        })
      ).status,
    ).toBe(200);
  });

  it('roles: patch a single field', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const w = appWithActor(r['roles'], orgId, ['manage']);
    const created = await w.request('/', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ key: 'k', name: 'K' }),
    });
    const id = (await body<{ id: string }>(created)).id;
    expect(
      (
        await w.request(`/${id}`, {
          method: 'PATCH',
          headers: J,
          body: JSON.stringify({ name: 'K2' }),
        })
      ).status,
    ).toBe(200);
  });

  it('integrations: patch a single field', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const w = appWithActor(r['integrations'], orgId, ['manage'], humanActorId);
    const created = await w.request('/', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ provider: 'github', pattern: 'connector' }),
    });
    const id = (await body<{ id: string }>(created)).id;
    expect(
      (
        await w.request(`/${id}`, {
          method: 'PATCH',
          headers: J,
          body: JSON.stringify({ syncMode: 'import' }),
        })
      ).status,
    ).toBe(200);
  });
});

describe('billing checkout/portal defaults (no urls/price/email provided)', () => {
  it('checkout uses defaultPriceKey + appUrl defaults', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const w = appWithActor(r['billing'], `${orgId}-defaults`, ['manage']);
    const res = await w.request('/checkout', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    expect((await body<{ url: string }>(res)).url).toMatch(/^https?:\/\//);
  });

  it('checkout passes through a customerEmail when provided', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const w = appWithActor(r['billing'], `${orgId}-email`, ['manage']);
    const res = await w.request('/checkout', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ customerEmail: 'a@e.com', priceKey: 'docket_team' }),
    });
    expect(res.status).toBe(200);
  });

  it('portal returns a hosted url', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const w = appWithActor(r['billing'], `${orgId}-portal`, ['manage']);
    const res = await w.request('/portal', { method: 'POST' });
    expect(res.status).toBe(200);
  });

  it('GET / returns a subscription without a trialEnd (covers the trialEnd-absent branch)', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const { getContainer } = await import('../../src/container');
    const spy = vi.spyOn(getContainer().billing, 'getSubscription').mockResolvedValueOnce({
      id: 'sub_x',
      referenceId: orgId,
      status: 'active',
      currentPeriodEnd: '2030-01-01T00:00:00.000Z',
      // No trialEnd.
    } as never);
    const w = appWithActor(r['billing'], orgId, ['view']);
    const res = await w.request('/', { method: 'GET' });
    expect(res.status).toBe(200);
    const sub = await body<{ trialEnd?: string }>(res);
    expect(sub.trialEnd).toBeUndefined();
    spy.mockRestore();
  });
});

describe('integrations import: configured-team path + null-branch coverage via a connector spy', () => {
  it('imports using the integration config.teamId and maps an item without body/externalUrl', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    // Spy on the prototype so the per-request MockConnector instance (created by connectorFor)
    // also returns the null-body / null-externalUrl fixture item.
    const { MockConnector } = await import('@docket/integrations');
    const spy = vi.spyOn(MockConnector.prototype, 'importWork').mockResolvedValueOnce([
      // An item with no `body` and no `externalUrl` → covers both `?? null` null sides.
      {
        id: 'x1',
        kind: 'issue',
        title: 'No body',
        provenance: {
          provider: 'github',
          externalId: 'ext-nobody',
          importedAt: '2026-01-01T00:00:00.000Z',
        },
      },
    ] as never);

    const [intg] = await db
      .insert(schema.integration)
      .values({
        organizationId: orgId,
        provider: 'github',
        pattern: 'connector',
        roles: ['work'],
        config: { teamId },
        createdBy: humanActorId,
      })
      .returning({ id: schema.integration.id });

    const w = appWithActor(r['integrations'], orgId, ['contribute'], humanActorId);
    const res = await w.request(`/${intg!.id}/import`, { method: 'POST', headers: J, body: '{}' });
    expect(res.status).toBe(200);
    const out = await body<{ items: { provenance: { externalUrl: string | null } }[] }>(res);
    expect(out.items).toHaveLength(1);
    expect(out.items[0]!.provenance.externalUrl).toBeNull();
    spy.mockRestore();
  });

  it('passes the connection externalWorkspaceId and lands on a stateless team (backlog)', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    // A team with NO workflow states so importItems' state falls back to 'backlog'.
    const [statelessTeam] = await db
      .insert(schema.team)
      .values({
        organizationId: orgId,
        name: 'NS',
        key: `N${Math.random().toString(36).slice(2, 6)}`,
        workflowStates: [],
      })
      .returning({ id: schema.team.id });
    const [intg] = await db
      .insert(schema.integration)
      .values({
        organizationId: orgId,
        provider: 'github',
        pattern: 'connector',
        roles: ['work'],
        // A connection carrying an externalWorkspaceId → covers that spread's truthy side.
        connection: { externalWorkspaceId: 'ws-123' },
        config: { teamId: statelessTeam!.id },
        createdBy: humanActorId,
      })
      .returning({ id: schema.integration.id });
    const w = appWithActor(r['integrations'], orgId, ['contribute'], humanActorId);
    const res = await w.request(`/${intg!.id}/import`, { method: 'POST', headers: J, body: '{}' });
    expect(res.status).toBe(200);
  });

  it('falls back to the org first team when config.teamId points outside the org', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const [intg] = await db
      .insert(schema.integration)
      .values({
        organizationId: orgId,
        provider: 'gmail',
        pattern: 'connector',
        roles: ['work'],
        // A configured teamId that is NOT in this org → the configured-but-not-found branch.
        config: { teamId: MISSING },
        createdBy: humanActorId,
      })
      .returning({ id: schema.integration.id });
    const w = appWithActor(r['integrations'], orgId, ['contribute'], humanActorId);
    // gmail fixture item has no externalUrl → covers that null side too.
    const res = await w.request(`/${intg!.id}/import`, { method: 'POST', headers: J, body: '{}' });
    expect(res.status).toBe(200);
  });
});
