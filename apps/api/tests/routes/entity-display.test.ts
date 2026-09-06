import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import type * as DbModule from '@docket/db';

import type entityDisplayRouter from '../../src/routes/entity-display';
import { appWithActor, getDb, seedBaseOrg } from '../support/routes-harness';
import { assertDefined } from '@docket/test-utils';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let entityDisplay!: typeof entityDisplayRouter;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  entityDisplay = (await import('../../src/routes/entity-display')).default;
});

describe('entity display routes', () => {
  it('upserts and resets Initiative display metadata outside the Initiative row', async () => {
    const { orgId, humanActorId, statusId } = await seedBaseOrg(db, schema);
    const [initiative] = await db
      .insert(schema.initiative)
      .values({
        organizationId: orgId,
        name: 'Transit brand',
        createdBy: humanActorId,
        status: 'active',
        statusId: statusId('initiative', 'active'),
      })
      .returning();
    expect(initiative).toBeDefined();
    const app = appWithActor(entityDisplay, orgId, ['contribute'], humanActorId);

    const updated = await app.request(`/initiative/${assertDefined(initiative).id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ iconKey: 'bus', colorKey: 'primary', customColor: '#3b82f6' }),
    });
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({
      subjectType: 'initiative',
      subjectId: assertDefined(initiative).id,
      iconKey: 'bus',
      colorKey: 'primary',
      customColor: '#3b82f6',
      customized: true,
    });

    const reset = await app.request(`/initiative/${assertDefined(initiative).id}`, {
      method: 'DELETE',
    });
    expect(reset.status).toBe(200);
    expect(await reset.json()).toMatchObject({
      iconKey: 'target',
      colorKey: 'neutral',
      customColor: null,
      customized: false,
    });
  });

  it('supports Projects and hides cross-workspace subjects', async () => {
    const owner = await seedBaseOrg(db, schema);
    const other = await seedBaseOrg(db, schema);
    const [project] = await db
      .insert(schema.project)
      .values({
        organizationId: owner.orgId,
        name: 'Bus Buddies',
        createdBy: owner.humanActorId,
        status: 'planned',
        statusId: owner.statusId('project', 'planned'),
      })
      .returning();
    expect(project).toBeDefined();

    const ownerApp = appWithActor(entityDisplay, owner.orgId, ['contribute'], owner.humanActorId);
    const updated = await ownerApp.request(`/project/${assertDefined(project).id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ iconKey: 'sparkles', colorKey: 'success', customColor: null }),
    });
    expect(updated.status).toBe(200);

    const attacker = appWithActor(entityDisplay, other.orgId, ['contribute'], other.humanActorId);
    const hidden = await attacker.request(`/project/${assertDefined(project).id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ iconKey: 'flag', colorKey: 'danger', customColor: null }),
    });
    expect(hidden.status).toBe(404);
  });

  it('round-trips catalog symbols and emoji while dual-writing a legacy fallback', async () => {
    const owner = await seedBaseOrg(db, schema);
    const [project] = await db
      .insert(schema.project)
      .values({
        organizationId: owner.orgId,
        name: 'Launch service',
        createdBy: owner.humanActorId,
        status: 'planned',
        statusId: owner.statusId('project', 'planned'),
      })
      .returning();
    const projectId = assertDefined(project).id;
    const app = appWithActor(entityDisplay, owner.orgId, ['contribute'], owner.humanActorId);

    const symbol = await app.request(`/project/${projectId}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        glyph: { kind: 'symbol', name: 'rocket_launch' },
        colorKey: 'purple',
        customColor: null,
      }),
    });
    expect(symbol.status).toBe(200);
    expect(await symbol.json()).toMatchObject({
      glyph: { kind: 'symbol', name: 'rocket_launch' },
      iconKey: 'launch',
    });

    const emoji = await app.request(`/project/${projectId}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        glyph: { kind: 'emoji', hexcode: '1F44D-1F3FD' },
        colorKey: 'purple',
        customColor: null,
      }),
    });
    expect(emoji.status).toBe(200);
    expect(await emoji.json()).toMatchObject({
      glyph: { kind: 'emoji', hexcode: '1F44D-1F3FD' },
      iconKey: 'folder',
    });

    const [stored] = await db
      .select()
      .from(schema.entityDisplay)
      .where(eq(schema.entityDisplay.subjectId, projectId));
    expect(stored).toMatchObject({
      glyphKind: 'emoji',
      glyphValue: '1F44D-1F3FD',
      iconKey: 'folder',
    });
  });

  it('rejects symbols and emoji sequences outside the pinned catalogs', async () => {
    const owner = await seedBaseOrg(db, schema);
    const [project] = await db
      .insert(schema.project)
      .values({
        organizationId: owner.orgId,
        name: 'Validation',
        createdBy: owner.humanActorId,
        status: 'planned',
        statusId: owner.statusId('project', 'planned'),
      })
      .returning();
    const projectId = assertDefined(project).id;
    const app = appWithActor(entityDisplay, owner.orgId, ['contribute'], owner.humanActorId);

    for (const glyph of [
      { kind: 'symbol', name: 'not_a_real_material_symbol' },
      { kind: 'emoji', hexcode: '1F600-1F680' },
    ]) {
      const response = await app.request(`/project/${projectId}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ glyph, colorKey: 'neutral', customColor: null }),
      });
      expect(response.status).toBe(422);
    }
  });

  it('uses the subject default when a stored symbol is no longer in the pinned catalog', async () => {
    const owner = await seedBaseOrg(db, schema);
    const [project] = await db
      .insert(schema.project)
      .values({
        organizationId: owner.orgId,
        name: 'Fallback',
        createdBy: owner.humanActorId,
        status: 'planned',
        statusId: owner.statusId('project', 'planned'),
      })
      .returning();
    const projectId = assertDefined(project).id;
    await db.insert(schema.entityDisplay).values({
      organizationId: owner.orgId,
      subjectType: 'project',
      subjectId: projectId,
      iconKey: 'rocket',
      glyphKind: 'symbol',
      glyphValue: 'retired_symbol_name',
      colorKey: 'purple',
    });

    const app = appWithActor(entityDisplay, owner.orgId, ['view'], owner.humanActorId);
    const response = await app.request(`/project/${projectId}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      glyph: { kind: 'symbol', name: 'folder_open' },
      iconKey: 'rocket',
    });
  });

  it('round-trips defaults, customization, bulk reads, and reset through every native entity table', async () => {
    const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(db, schema);
    const [program] = await db
      .insert(schema.program)
      .values({
        organizationId: orgId,
        name: 'Community outreach',
        createdBy: humanActorId,
        status: 'active',
        statusId: statusId('program', 'active'),
      })
      .returning();
    const [project] = await db
      .insert(schema.project)
      .values({
        organizationId: orgId,
        name: 'Street safety plan',
        createdBy: humanActorId,
        status: 'planned',
        statusId: statusId('project', 'planned'),
      })
      .returning();
    const [initiative] = await db
      .insert(schema.initiative)
      .values({
        organizationId: orgId,
        name: 'Safer streets',
        createdBy: humanActorId,
        status: 'active',
        statusId: statusId('initiative', 'active'),
      })
      .returning();
    const [milestone] = await db
      .insert(schema.milestone)
      .values({
        organizationId: orgId,
        projectId: assertDefined(project).id,
        name: 'Publish the plan',
        createdBy: humanActorId,
      })
      .returning();
    const [cycle] = await db
      .insert(schema.cycle)
      .values({
        organizationId: orgId,
        teamId,
        number: 1,
        startsAt: new Date('2026-08-03T00:00:00.000Z'),
        endsAt: new Date('2026-08-10T00:00:00.000Z'),
        createdBy: humanActorId,
      })
      .returning();
    const [task] = await db
      .insert(schema.task)
      .values({
        organizationId: orgId,
        teamId,
        title: 'Review transit data',
        state: 'todo',
        statusId: statusId('task', 'todo'),
        createdBy: humanActorId,
      })
      .returning();
    const [label] = await db
      .insert(schema.label)
      .values({ organizationId: orgId, name: 'Research', color: 'blue' })
      .returning();

    const app = appWithActor(entityDisplay, orgId, ['contribute'], humanActorId);
    const subjects = [
      ['initiative', assertDefined(initiative).id],
      ['program', assertDefined(program).id],
      ['project', assertDefined(project).id],
      ['task', assertDefined(task).id],
      ['cycle', assertDefined(cycle).id],
      ['milestone', assertDefined(milestone).id],
      ['team', teamId],
      ['label', assertDefined(label).id],
      ['workStatus', statusId('task', 'todo')],
    ] as const;

    for (const [subjectType, subjectId] of subjects) {
      const defaultDisplay = await app.request(`/${subjectType}/${subjectId}`);
      expect(defaultDisplay.status).toBe(200);
      expect(await defaultDisplay.json()).toMatchObject({
        subjectType,
        subjectId,
        customized: false,
      });

      const updated = await app.request(`/${subjectType}/${subjectId}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          glyph: { kind: 'emoji', hexcode: '1F680' },
          colorKey: 'indigo',
          customColor: '#4f46e5',
        }),
      });

      expect(updated.status).toBe(200);
      expect(await updated.json()).toMatchObject({
        subjectType,
        subjectId,
        glyph: { kind: 'emoji', hexcode: '1F680' },
        colorKey: 'indigo',
        customColor: '#4f46e5',
        customized: true,
      });

      const listed = await app.request(`/${subjectType}`);
      expect(listed.status).toBe(200);
      expect(await listed.json()).toMatchObject({
        items: [
          expect.objectContaining({
            subjectType,
            subjectId,
            glyph: { kind: 'emoji', hexcode: '1F680' },
            colorKey: 'indigo',
            customColor: '#4f46e5',
            customized: true,
          }),
        ],
      });

      const reset = await app.request(`/${subjectType}/${subjectId}`, { method: 'DELETE' });
      expect(reset.status).toBe(200);
      expect(await reset.json()).toMatchObject({
        subjectType,
        subjectId,
        customized: false,
        customColor: null,
      });
    }
  });

  it('requires contribute capability for display writes', async () => {
    const { orgId, humanActorId, statusId } = await seedBaseOrg(db, schema);
    const [initiative] = await db
      .insert(schema.initiative)
      .values({
        organizationId: orgId,
        name: 'Read only',
        createdBy: humanActorId,
        status: 'active',
        statusId: statusId('initiative', 'active'),
      })
      .returning();
    const viewer = appWithActor(entityDisplay, orgId, ['view'], humanActorId);
    const response = await viewer.request(`/initiative/${assertDefined(initiative).id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ iconKey: 'flag', colorKey: 'primary' }),
    });
    expect(response.status).toBe(403);
  });

  it('preserves an existing cover when an icon-only update omits it and clears it explicitly', async () => {
    const { orgId, humanActorId, statusId } = await seedBaseOrg(db, schema);
    const [initiative] = await db
      .insert(schema.initiative)
      .values({
        organizationId: orgId,
        name: 'Cover behavior',
        createdBy: humanActorId,
        status: 'active',
        statusId: statusId('initiative', 'active'),
      })
      .returning();
    const initiativeId = assertDefined(initiative).id;
    const app = appWithActor(entityDisplay, orgId, ['contribute'], humanActorId);
    const coverImage = 'data:image/png;base64,Y292ZXI=';

    const created = await app.request(`/initiative/${initiativeId}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        iconKey: 'image',
        colorKey: 'sky',
        customColor: null,
        coverImage,
      }),
    });
    expect(created.status).toBe(200);
    expect(await created.json()).toMatchObject({ coverImage, customized: true });

    const iconOnlyUpdate = await app.request(`/initiative/${initiativeId}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ iconKey: 'flag', colorKey: 'primary', customColor: null }),
    });
    expect(iconOnlyUpdate.status).toBe(200);
    expect(await iconOnlyUpdate.json()).toMatchObject({
      iconKey: 'flag',
      coverImage,
      customized: true,
    });

    const stored = await app.request(`/initiative/${initiativeId}`);
    expect(stored.status).toBe(200);
    expect(await stored.json()).toMatchObject({ coverImage, customized: true });

    const cleared = await app.request(`/initiative/${initiativeId}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        iconKey: 'flag',
        colorKey: 'primary',
        customColor: null,
        coverImage: null,
      }),
    });
    expect(cleared.status).toBe(200);
    expect(await cleared.json()).toMatchObject({ coverImage: null, customized: true });
  });
});
