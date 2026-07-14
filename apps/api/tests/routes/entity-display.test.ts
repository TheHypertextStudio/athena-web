import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import type entityDisplayRouter from '../../src/routes/entity-display';
import { appWithActor, getDb, seedBaseOrg } from '../support/routes-harness';

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
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const [initiative] = await db
      .insert(schema.initiative)
      .values({ organizationId: orgId, name: 'Transit brand', createdBy: humanActorId })
      .returning();
    expect(initiative).toBeDefined();
    const app = appWithActor(entityDisplay, orgId, ['contribute'], humanActorId);

    const updated = await app.request(`/initiative/${initiative!.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ iconKey: 'flag', colorKey: 'primary' }),
    });
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({
      subjectType: 'initiative',
      subjectId: initiative!.id,
      iconKey: 'flag',
      colorKey: 'primary',
      customized: true,
    });

    const reset = await app.request(`/initiative/${initiative!.id}`, { method: 'DELETE' });
    expect(reset.status).toBe(200);
    expect(await reset.json()).toMatchObject({
      iconKey: 'target',
      colorKey: 'neutral',
      customized: false,
    });
  });

  it('supports Projects and hides cross-workspace subjects', async () => {
    const owner = await seedBaseOrg(db, schema);
    const other = await seedBaseOrg(db, schema);
    const [project] = await db
      .insert(schema.project)
      .values({ organizationId: owner.orgId, name: 'Bus Buddies', createdBy: owner.humanActorId })
      .returning();
    expect(project).toBeDefined();

    const ownerApp = appWithActor(entityDisplay, owner.orgId, ['contribute'], owner.humanActorId);
    const updated = await ownerApp.request(`/project/${project!.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ iconKey: 'sparkles', colorKey: 'success' }),
    });
    expect(updated.status).toBe(200);

    const attacker = appWithActor(entityDisplay, other.orgId, ['contribute'], other.humanActorId);
    const hidden = await attacker.request(`/project/${project!.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ iconKey: 'flag', colorKey: 'danger' }),
    });
    expect(hidden.status).toBe(404);
  });

  it('requires contribute capability for display writes', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const [initiative] = await db
      .insert(schema.initiative)
      .values({ organizationId: orgId, name: 'Read only', createdBy: humanActorId })
      .returning();
    const viewer = appWithActor(entityDisplay, orgId, ['view'], humanActorId);
    const response = await viewer.request(`/initiative/${initiative!.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ iconKey: 'flag', colorKey: 'primary' }),
    });
    expect(response.status).toBe(403);
  });
});
