import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';
import type { TemplateOut } from '@docket/types';

import { appWithActor, getDb, seedBaseOrg } from '../support/routes-harness';
import type templatesRouter from '../../src/routes/templates';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let router!: typeof templatesRouter;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  router = (await import('../../src/routes/templates')).default;
});

const J = { 'content-type': 'application/json' };
async function body<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

const BUG_TEMPLATE = {
  targetType: 'task',
  name: 'Escalation',
  description: 'A customer-reported break that needs an owner today.',
  payload: {
    targetType: 'task',
    title: 'Escalation: ',
    description: '## What broke\n\n## Who is affected',
    priority: 'urgent',
  },
};

describe('templates router', () => {
  it('creates, reads, updates, and deletes a template (payload round-trip)', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const w = appWithActor(router, orgId, ['contribute'], humanActorId);

    const created = await body<TemplateOut>(
      await w.request('/', { method: 'POST', headers: J, body: JSON.stringify(BUG_TEMPLATE) }),
    );
    expect(created.name).toBe('Escalation');
    expect(created.targetType).toBe('task');
    expect(created.scope).toBe('personal');
    expect(created.ownerActorId).toBe(humanActorId);
    expect(created.isSeed).toBe(false);
    expect(created.payload).toMatchObject({ targetType: 'task', priority: 'urgent' });

    const fetched = await body<TemplateOut>(await w.request(`/${created.id}`));
    expect(fetched.payload).toEqual(created.payload);

    const renamed = await body<TemplateOut>(
      await w.request(`/${created.id}`, {
        method: 'PATCH',
        headers: J,
        body: JSON.stringify({
          name: 'Customer escalation',
          payload: { targetType: 'task', description: '## What broke', priority: 'high' },
        }),
      }),
    );
    expect(renamed.name).toBe('Customer escalation');
    expect(renamed.payload).toEqual({
      targetType: 'task',
      description: '## What broke',
      priority: 'high',
    });

    expect((await w.request(`/${created.id}`, { method: 'DELETE' })).status).toBe(200);
    expect((await w.request(`/${created.id}`)).status).toBe(404);
  });

  it('seeds the shipped defaults on the first list read, and only once', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const w = appWithActor(router, orgId, ['contribute'], humanActorId);

    const first = await body<{ items: TemplateOut[] }>(await w.request('/'));
    expect(first.items).toHaveLength(12);
    expect(first.items.every((t) => t.isSeed)).toBe(true);
    expect(first.items.every((t) => t.scope === 'organization')).toBe(true);
    for (const kind of ['task', 'project', 'initiative', 'program'] as const) {
      expect(first.items.filter((t) => t.targetType === kind)).toHaveLength(3);
    }

    const second = await body<{ items: TemplateOut[] }>(await w.request('/'));
    expect(second.items).toHaveLength(12);
  });

  it('gives every seeded template of a kind a distinct body', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const w = appWithActor(router, orgId, ['contribute'], humanActorId);
    const { items } = await body<{ items: TemplateOut[] }>(await w.request('/'));

    for (const kind of ['task', 'project', 'initiative', 'program'] as const) {
      const bodies = items
        .filter((t) => t.targetType === kind)
        .map((t) => ('description' in t.payload ? t.payload.description : undefined));
      expect(bodies.every((value) => typeof value === 'string' && value.length > 0)).toBe(true);
      expect(new Set(bodies).size).toBe(bodies.length);
    }
  });

  it('does not resurrect a deleted default', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const w = appWithActor(router, orgId, ['contribute'], humanActorId);

    const { items } = await body<{ items: TemplateOut[] }>(await w.request('/'));
    const victim = items[0];
    if (!victim) throw new Error('expected the seed to have installed a template');
    expect((await w.request(`/${victim.id}`, { method: 'DELETE' })).status).toBe(200);

    const after = await body<{ items: TemplateOut[] }>(await w.request('/'));
    expect(after.items).toHaveLength(11);
    expect(after.items.some((t) => t.id === victim.id)).toBe(false);
  });

  it('filters the list by targetType', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const w = appWithActor(router, orgId, ['contribute'], humanActorId);

    const initiatives = await body<{ items: TemplateOut[] }>(
      await w.request('/?targetType=initiative'),
    );
    expect(initiatives.items).toHaveLength(3);
    expect(initiatives.items.every((t) => t.targetType === 'initiative')).toBe(true);
  });

  it('rejects a payload that describes a different kind than the template creates', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const w = appWithActor(router, orgId, ['contribute'], humanActorId);

    const mismatched = await w.request('/', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({
        targetType: 'task',
        name: 'Confused',
        payload: { targetType: 'project', name: 'Not a task' },
      }),
    });
    expect(mismatched.status).toBe(422);
  });

  it('refuses to change the kind a template creates', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const w = appWithActor(router, orgId, ['contribute'], humanActorId);
    const created = await body<TemplateOut>(
      await w.request('/', { method: 'POST', headers: J, body: JSON.stringify(BUG_TEMPLATE) }),
    );

    const rekind = await w.request(`/${created.id}`, {
      method: 'PATCH',
      headers: J,
      body: JSON.stringify({ payload: { targetType: 'program', name: 'Now a program' } }),
    });
    expect(rekind.status).toBe(422);
  });

  it('requires a team when the scope is team, and clears it when the scope moves away', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const w = appWithActor(router, orgId, ['contribute'], humanActorId);

    const teamless = await w.request('/', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ ...BUG_TEMPLATE, scope: 'team' }),
    });
    expect(teamless.status).toBe(422);

    const scoped = await body<TemplateOut>(
      await w.request('/', {
        method: 'POST',
        headers: J,
        body: JSON.stringify({ ...BUG_TEMPLATE, scope: 'team', teamId }),
      }),
    );
    expect(scoped.teamId).toBe(teamId);

    const widened = await body<TemplateOut>(
      await w.request(`/${scoped.id}`, {
        method: 'PATCH',
        headers: J,
        body: JSON.stringify({ scope: 'organization' }),
      }),
    );
    expect(widened.scope).toBe('organization');
    expect(widened.teamId).toBeNull();
  });

  it('drops a team id supplied on a personal-scoped template', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const w = appWithActor(router, orgId, ['contribute'], humanActorId);

    const created = await body<TemplateOut>(
      await w.request('/', {
        method: 'POST',
        headers: J,
        body: JSON.stringify({ ...BUG_TEMPLATE, scope: 'personal', teamId }),
      }),
    );
    expect(created.teamId).toBeNull();
  });

  it('requires `contribute` for mutations (403) but allows reads', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const viewer = appWithActor(router, orgId, ['view'], humanActorId);
    expect(
      (
        await viewer.request('/', {
          method: 'POST',
          headers: J,
          body: JSON.stringify(BUG_TEMPLATE),
        })
      ).status,
    ).toBe(403);
    expect((await viewer.request('/')).status).toBe(200);
  });

  it('isolates templates by tenant', async () => {
    const a = await seedBaseOrg(db, schema);
    const wa = appWithActor(router, a.orgId, ['contribute'], a.humanActorId);
    const created = await body<TemplateOut>(
      await wa.request('/', { method: 'POST', headers: J, body: JSON.stringify(BUG_TEMPLATE) }),
    );

    const b = await seedBaseOrg(db, schema);
    const wb = appWithActor(router, b.orgId, ['contribute'], b.humanActorId);
    expect((await wb.request(`/${created.id}`)).status).toBe(404);
    expect((await wb.request(`/${created.id}`, { method: 'DELETE' })).status).toBe(404);

    const bList = await body<{ items: TemplateOut[] }>(await wb.request('/'));
    expect(bList.items.some((t) => t.id === created.id)).toBe(false);
  });
});
