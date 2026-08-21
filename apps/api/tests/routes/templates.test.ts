import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';
import type { TemplateOut } from '@docket/types';
import { inArray } from 'drizzle-orm';

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

async function seedScopedTemplates() {
  const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
  const [otherActor] = await db
    .insert(schema.actor)
    .values({ organizationId: orgId, kind: 'human', displayName: 'Grace' })
    .returning({ id: schema.actor.id });
  const [otherTeam] = await db
    .insert(schema.team)
    .values({
      organizationId: orgId,
      name: 'Other',
      key: `O${Math.random().toString(36).slice(2, 6)}`,
    })
    .returning({ id: schema.team.id });
  if (!otherActor || !otherTeam) throw new Error('failed to seed template visibility fixtures');

  await db.insert(schema.teamMember).values([
    { organizationId: orgId, teamId, actorId: humanActorId },
    { organizationId: orgId, teamId: otherTeam.id, actorId: otherActor.id },
  ]);
  const rows = await db
    .insert(schema.template)
    .values([
      {
        organizationId: orgId,
        targetType: 'task',
        name: 'Mine',
        scope: 'personal',
        ownerActorId: humanActorId,
        payload: { targetType: 'task', description: 'mine' },
      },
      {
        organizationId: orgId,
        targetType: 'task',
        name: 'Theirs',
        scope: 'personal',
        ownerActorId: otherActor.id,
        payload: { targetType: 'task', description: 'theirs' },
      },
      {
        organizationId: orgId,
        targetType: 'task',
        name: 'My team',
        scope: 'team',
        teamId,
        payload: { targetType: 'task', description: 'my team' },
      },
      {
        organizationId: orgId,
        targetType: 'task',
        name: 'Other team',
        scope: 'team',
        teamId: otherTeam.id,
        payload: { targetType: 'task', description: 'other team' },
      },
    ])
    .returning({ id: schema.template.id, name: schema.template.name });

  return {
    orgId,
    humanActorId,
    otherActorId: otherActor.id,
    otherTeamId: otherTeam.id,
    rows,
  };
}

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
    await db
      .insert(schema.teamMember)
      .values({ organizationId: orgId, teamId, actorId: humanActorId });

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

  it('lists organization templates plus only the caller personal and team scopes', async () => {
    const { orgId, humanActorId } = await seedScopedTemplates();
    const viewer = appWithActor(router, orgId, ['view'], humanActorId);

    const listed = await body<{ items: TemplateOut[] }>(await viewer.request('/?targetType=task'));
    const names = listed.items.map((item) => item.name);

    expect(names).toContain('Mine');
    expect(names).toContain('My team');
    expect(names).not.toContain('Theirs');
    expect(names).not.toContain('Other team');
  });

  it('hides direct reads of foreign personal and nonmember team templates', async () => {
    const { orgId, humanActorId, rows } = await seedScopedTemplates();
    const viewer = appWithActor(router, orgId, ['view'], humanActorId);
    const theirs = rows.find((row) => row.name === 'Theirs');
    const otherTeam = rows.find((row) => row.name === 'Other team');
    if (!theirs || !otherTeam) throw new Error('failed to find hidden template fixtures');

    expect((await viewer.request(`/${theirs.id}`)).status).toBe(404);
    expect((await viewer.request(`/${otherTeam.id}`)).status).toBe(404);
  });

  it('rejects mutations of foreign personal and nonmember team templates', async () => {
    const { orgId, humanActorId, rows } = await seedScopedTemplates();
    const contributor = appWithActor(router, orgId, ['contribute'], humanActorId);
    const theirs = rows.find((row) => row.name === 'Theirs');
    const otherTeam = rows.find((row) => row.name === 'Other team');
    if (!theirs || !otherTeam) throw new Error('failed to find hidden template fixtures');

    expect(
      (
        await contributor.request(`/${theirs.id}`, {
          method: 'PATCH',
          headers: J,
          body: JSON.stringify({ name: 'Stolen' }),
        })
      ).status,
    ).toBe(404);
    expect((await contributor.request(`/${otherTeam.id}`, { method: 'DELETE' })).status).toBe(404);

    const stillPresent = await db
      .select({ name: schema.template.name })
      .from(schema.template)
      .where(inArray(schema.template.id, [theirs.id, otherTeam.id]));
    expect(stillPresent.map((row) => row.name).sort()).toEqual(['Other team', 'Theirs']);
  });

  it('rejects creating or retargeting templates into another actor or team scope', async () => {
    const { orgId, humanActorId, otherActorId, otherTeamId, rows } = await seedScopedTemplates();
    const contributor = appWithActor(router, orgId, ['contribute'], humanActorId);

    const personal = await contributor.request('/', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ ...BUG_TEMPLATE, ownerActorId: otherActorId }),
    });
    expect(personal.status).toBe(422);

    const team = await contributor.request('/', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ ...BUG_TEMPLATE, scope: 'team', teamId: otherTeamId }),
    });
    expect(team.status).toBe(404);

    const organizationTemplate = rows.find((row) => row.name === 'Mine');
    if (!organizationTemplate) throw new Error('failed to resolve a visible template fixture');
    expect(
      (
        await contributor.request(`/${organizationTemplate.id}`, {
          method: 'PATCH',
          headers: J,
          body: JSON.stringify({ scope: 'team', teamId: otherTeamId }),
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await contributor.request(`/${organizationTemplate.id}`, {
          method: 'PATCH',
          headers: J,
          body: JSON.stringify({ scope: 'personal', ownerActorId: otherActorId }),
        })
      ).status,
    ).toBe(422);
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
