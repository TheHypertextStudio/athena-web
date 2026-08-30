import { beforeAll, describe, expect, it } from 'vitest';

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

  it('upserts display metadata through every native entity table', async () => {
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
      const updated = await app.request(`/${subjectType}/${subjectId}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ iconKey: 'layers', colorKey: 'indigo', customColor: '#4f46e5' }),
      });

      expect(updated.status).toBe(200);
      expect(await updated.json()).toMatchObject({
        subjectType,
        subjectId,
        iconKey: 'layers',
        colorKey: 'indigo',
        customColor: '#4f46e5',
        customized: true,
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
});
