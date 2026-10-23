/** Project URL-resource route coverage. */
import { eq } from 'drizzle-orm';
import { processSearchIndexJobs } from '../../src/search/process-jobs';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import type projectResourcesRouter from '../../src/routes/project-resources';
import type { StatusIdLookup } from '../support/routes-harness';
import { appWithActor, getDb, seedBaseOrg, seedProject } from '../support/routes-harness';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let projectResources!: typeof projectResourcesRouter;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  projectResources = (await import('../../src/routes/project-resources')).default;
});

async function makeProject(
  orgId: string,
  actorId: string,
  statusId: StatusIdLookup,
): Promise<string> {
  const project = await seedProject(db, schema, statusId, {
    organizationId: orgId,
    name: 'Funding campaign',
    createdBy: actorId,
  });
  return project.id;
}

describe('Project resources', () => {
  it('creates, lists, and removes URL resources', async () => {
    const { orgId, humanActorId, statusId } = await seedBaseOrg(db, schema);
    const projectId = await makeProject(orgId, humanActorId, statusId);
    const app = appWithActor(projectResources, orgId, ['view', 'contribute'], humanActorId);

    const created = await app.request(`/${projectId}/resources`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Campaign brief', url: 'https://example.com/brief' }),
    });
    expect(created.status).toBe(201);
    const resource = (await created.json()) as { id: string; subjectType: string; title: string };
    expect(resource).toMatchObject({ subjectType: 'project', title: 'Campaign brief' });

    await processSearchIndexJobs({ limit: 100 });
    const [indexed] = await db
      .select()
      .from(schema.searchDocument)
      .where(eq(schema.searchDocument.entityId, resource.id));
    expect(indexed).toMatchObject({ kind: 'attachment', archivedAt: null });

    const listed = await app.request(`/${projectId}/resources`);
    expect(listed.status).toBe(200);
    const page = (await listed.json()) as { items: { id: string }[] };
    expect(page.items.map((item) => item.id)).toEqual([resource.id]);

    const removed = await app.request(`/${projectId}/resources/${resource.id}`, {
      method: 'DELETE',
    });
    expect(removed.status).toBe(200);
    expect(await removed.json()).toEqual({ id: resource.id, removed: true });
    await processSearchIndexJobs({ limit: 100 });
    const [archived] = await db
      .select()
      .from(schema.searchDocument)
      .where(eq(schema.searchDocument.entityId, resource.id));
    expect(archived?.archivedAt).toBeInstanceOf(Date);
  });

  it('does not expose a Project from another workspace', async () => {
    const owner = await seedBaseOrg(db, schema);
    const viewer = await seedBaseOrg(db, schema);
    const projectId = await makeProject(owner.orgId, owner.humanActorId, owner.statusId);
    const app = appWithActor(projectResources, viewer.orgId, ['view'], viewer.humanActorId);

    expect((await app.request(`/${projectId}/resources`)).status).toBe(404);
  });
});
