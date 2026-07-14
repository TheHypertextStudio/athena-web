/** Project URL-resource route coverage. */
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import type projectResourcesRouter from '../../src/routes/project-resources';
import { appWithActor, getDb, seedBaseOrg } from '../support/routes-harness';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let projectResources!: typeof projectResourcesRouter;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  projectResources = (await import('../../src/routes/project-resources')).default;
});

async function makeProject(orgId: string, actorId: string): Promise<string> {
  const rows = await db
    .insert(schema.project)
    .values({ organizationId: orgId, name: 'Funding campaign', createdBy: actorId })
    .returning({ id: schema.project.id });
  return rows[0]!.id;
}

describe('Project resources', () => {
  it('creates, lists, and removes URL resources', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const projectId = await makeProject(orgId, humanActorId);
    const app = appWithActor(projectResources, orgId, ['view', 'contribute'], humanActorId);

    const created = await app.request(`/${projectId}/resources`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Campaign brief', url: 'https://example.com/brief' }),
    });
    expect(created.status).toBe(200);
    const resource = (await created.json()) as { id: string; subjectType: string; title: string };
    expect(resource).toMatchObject({ subjectType: 'project', title: 'Campaign brief' });

    const listed = await app.request(`/${projectId}/resources`);
    expect(listed.status).toBe(200);
    const page = (await listed.json()) as { items: { id: string }[] };
    expect(page.items.map((item) => item.id)).toEqual([resource.id]);

    const removed = await app.request(`/${projectId}/resources/${resource.id}`, {
      method: 'DELETE',
    });
    expect(removed.status).toBe(200);
    expect(await removed.json()).toEqual({ id: resource.id, removed: true });
  });

  it('does not expose a Project from another workspace', async () => {
    const owner = await seedBaseOrg(db, schema);
    const viewer = await seedBaseOrg(db, schema);
    const projectId = await makeProject(owner.orgId, owner.humanActorId);
    const app = appWithActor(projectResources, viewer.orgId, ['view'], viewer.humanActorId);

    expect((await app.request(`/${projectId}/resources`)).status).toBe(404);
  });
});
