/** Initiative URL-resource route coverage. */
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import type initiativeResourcesRouter from '../../src/routes/initiative-resources';
import { appWithActor, getDb, seedBaseOrg, seedInitiative } from '../support/routes-harness';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let initiativeResources!: typeof initiativeResourcesRouter;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  initiativeResources = (await import('../../src/routes/initiative-resources')).default;
});

describe('Initiative resources', () => {
  it('creates, lists, and removes URL resources', async () => {
    const { orgId, humanActorId, statusId } = await seedBaseOrg(db, schema);
    const initiative = await seedInitiative(db, schema, statusId, {
      organizationId: orgId,
      name: 'Transit access',
      createdBy: humanActorId,
    });
    const app = appWithActor(initiativeResources, orgId, ['view', 'contribute'], humanActorId);

    const created = await app.request(`/${initiative.id}/resources`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Access plan', url: 'https://example.com/access-plan' }),
    });
    expect(created.status).toBe(201);
    const resource = (await created.json()) as {
      id: string;
      subjectType: string;
      subjectId: string;
      title: string;
    };
    expect(resource).toMatchObject({
      subjectType: 'initiative',
      subjectId: initiative.id,
      title: 'Access plan',
    });

    const listed = await app.request(`/${initiative.id}/resources`);
    expect(listed.status).toBe(200);
    expect(await listed.json()).toMatchObject({ items: [{ id: resource.id }] });

    const removed = await app.request(`/${initiative.id}/resources/${resource.id}`, {
      method: 'DELETE',
    });
    expect(removed.status).toBe(200);
    expect(await removed.json()).toEqual({ id: resource.id, removed: true });
    expect(
      (
        await app.request(`/${initiative.id}/resources/${resource.id}`, {
          method: 'DELETE',
        })
      ).status,
    ).toBe(404);
  });

  it('does not expose resources from another workspace', async () => {
    const owner = await seedBaseOrg(db, schema);
    const viewer = await seedBaseOrg(db, schema);
    const initiative = await seedInitiative(db, schema, owner.statusId, {
      organizationId: owner.orgId,
      name: 'Private strategy',
      createdBy: owner.humanActorId,
    });
    const app = appWithActor(initiativeResources, viewer.orgId, ['view'], viewer.humanActorId);

    expect((await app.request(`/${initiative.id}/resources`)).status).toBe(404);
  });
});
