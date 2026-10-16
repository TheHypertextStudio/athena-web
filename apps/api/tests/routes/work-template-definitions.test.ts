import { beforeAll, describe, expect, it } from 'vitest';
import type * as DbModule from '@docket/db';
import { eq } from 'drizzle-orm';
import { appWithActor, getDb, seedBaseOrg, one } from '../support/routes-harness';
import { WorkTemplateOut, WorkTemplateVersionOut } from '@docket/work/work-template-contract';
import { z } from 'zod';
import type templatesRouter from '../../src/routes/templates';

let schema: typeof DbModule;
let router: typeof templatesRouter;
beforeAll(async () => {
  schema = await getDb();
  router = (await import('../../src/routes/templates')).default;
});
const headers = { 'content-type': 'application/json' };
const definition = {
  name: 'Event',
  description: null,
  icon: null,
  defaultStatusKey: null,
  payload: { targetType: 'project', description: 'Venue and guests' },
};
async function fixture() {
  const seeded = await seedBaseOrg(schema.db, schema);
  const app = appWithActor(router, seeded.orgId, ['manage'], seeded.humanActorId);
  return { ...seeded, app };
}
async function create(app: ReturnType<typeof appWithActor>, scope = 'personal') {
  const response = await app.request('/definitions', {
    method: 'POST',
    headers,
    body: JSON.stringify({ targetType: 'project', scope, definition }),
  });
  expect(response.status).toBe(201);
  return (await response.json()) as { id: string; revision: number };
}

describe('revision-aware work-template definitions', () => {
  it('keeps private drafts private, publishes immutable snapshots, and rejects stale edits', async () => {
    const { app, orgId, humanActorId } = await fixture();
    const [other] = await schema.db
      .insert(schema.actor)
      .values({
        organizationId: orgId,
        kind: 'human',
        displayName: 'Reader',
      })
      .returning();
    if (!other) throw new Error('missing actor');
    const reader = appWithActor(router, orgId, ['view'], other.id);
    const row = await create(app);
    expect((await reader.request(`/definitions/${row.id}`)).status).toBe(404);
    const publish = await app.request(`/definitions/${row.id}/publish`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ expectedRevision: 0 }),
    });
    expect(publish.status).toBe(200);
    const first = (await publish.json()) as { latestVersion: { id: string; number: number } };
    expect(first.latestVersion.number).toBe(1);
    const edit = await app.request(`/definitions/${row.id}/draft`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        expectedRevision: 1,
        definition: { ...definition, name: 'Secret revision' },
      }),
    });
    expect(edit.status).toBe(200);
    const visible = WorkTemplateOut.parse(
      await (await reader.request(`/definitions/${row.id}`)).json(),
    );
    expect(visible.definition.name).toBe('Event');
    expect(visible.draftDefinition).toBeUndefined();
    expect(visible.canEdit).toBe(false);
    const stale = await app.request(`/definitions/${row.id}/publish`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ expectedRevision: 0 }),
    });
    expect(stale.status).toBe(409);
    const published = await app.request(`/definitions/${row.id}/publish`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ expectedRevision: 2 }),
    });
    expect(published.status).toBe(200);
    const versions = z
      .object({ items: z.array(WorkTemplateVersionOut) })
      .parse(await (await reader.request(`/definitions/${row.id}/versions`)).json());
    expect(
      versions.items.map((version: { definition: { name: string } }) => version.definition.name),
    ).toEqual(['Event', 'Secret revision']);
    expect(humanActorId).toBeTruthy();
  });

  it('enforces the workspace authoring policy without exposing a hidden draft', async () => {
    const { app, orgId, humanActorId } = await fixture();
    const row = await create(app);
    await schema.db
      .update(schema.organization)
      .set({ workTemplateAuthoring: 'admins' })
      .where(eq(schema.organization.id, orgId));
    const contributor = appWithActor(router, orgId, ['contribute'], humanActorId);
    const response = await contributor.request(`/definitions/${row.id}/publish`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ expectedRevision: 0 }),
    });
    expect(response.status).toBe(403);
    expect(
      WorkTemplateOut.parse(await (await contributor.request(`/definitions/${row.id}`)).json())
        .canEdit,
    ).toBe(false);
  });

  it('archives publications while keeping their versions and rejects archiving a base', async () => {
    const { app, orgId } = await fixture();
    const row = await create(app);
    await app.request(`/definitions/${row.id}/publish`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ expectedRevision: 0 }),
    });
    expect((await app.request(`/definitions/${row.id}/archive`, { method: 'POST' })).status).toBe(
      200,
    );
    const list = z
      .object({ items: z.array(WorkTemplateOut) })
      .parse(await (await app.request('/definitions')).json());
    expect(list.items.some((item: { id: string }) => item.id === row.id)).toBe(false);
    expect(
      z
        .object({ items: z.array(WorkTemplateVersionOut) })
        .parse(await (await app.request(`/definitions/${row.id}/versions`)).json()).items,
    ).toHaveLength(1);
    const bases = await schema.db
      .select()
      .from(schema.template)
      .where(eq(schema.template.organizationId, orgId));
    const base = bases.find((candidate) => candidate.isBase);
    if (!base) throw new Error('missing base');
    expect(base.isBase).toBe(true);
    expect((await app.request(`/definitions/${base.id}/archive`, { method: 'POST' })).status).toBe(
      409,
    );
  });
  it('consumes a reviewed revision once when publication requests race', async () => {
    const { app } = await fixture();
    const row = await create(app);
    const publish = () =>
      app.request(`/definitions/${row.id}/publish`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ expectedRevision: 0 }),
      });
    const responses = await Promise.all([publish(), publish()]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const versions = z
      .object({ items: z.array(WorkTemplateVersionOut) })
      .parse(await (await app.request(`/definitions/${row.id}/versions`)).json());
    expect(versions.items).toHaveLength(1);
  });

  it('keeps team drafts private and treats publication offerings separately from visibility', async () => {
    const { app, orgId, teamId, humanActorId } = await fixture();
    await schema.db
      .insert(schema.teamMember)
      .values({ organizationId: orgId, teamId, actorId: humanActorId });
    const [other] = await schema.db
      .insert(schema.actor)
      .values({
        organizationId: orgId,
        kind: 'human',
        displayName: 'Outside team',
      })
      .returning();
    if (!other) throw new Error('missing actor');
    const reader = appWithActor(router, orgId, ['view'], other.id);
    const response = await app.request('/definitions', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        targetType: 'project',
        scope: 'team',
        teamId,
        offeredTeamIds: [teamId],
        definition,
      }),
    });
    expect(response.status).toBe(201);
    const row = WorkTemplateOut.parse(await response.json());
    expect((await reader.request(`/definitions/${row.id}`)).status).toBe(404);
    expect((await reader.request(`/definitions/${row.id}/versions`)).status).toBe(404);
    const publication = await app.request(`/definitions/${row.id}/publish`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ expectedRevision: row.revision }),
    });
    expect(publication.status).toBe(200);
    expect((await reader.request(`/definitions/${row.id}`)).status).toBe(200);
    const { app: foreignWorkspace } = await fixture();
    expect((await foreignWorkspace.request(`/definitions/${row.id}/versions`)).status).toBe(404);
  });

  it('never exposes an organization draft before explicit publication and projects base vocabulary', async () => {
    const { app, orgId } = await fixture();
    const row = await create(app, 'organization');
    const [other] = await schema.db
      .insert(schema.actor)
      .values({
        organizationId: orgId,
        kind: 'human',
        displayName: 'Workspace reader',
      })
      .returning();
    if (!other) throw new Error('missing actor');
    const reader = appWithActor(router, orgId, ['view'], other.id);
    expect((await reader.request(`/definitions/${row.id}`)).status).toBe(404);
    expect((await reader.request(`/${row.id}`)).status).toBe(404);
    const reassigned = await app.request('/definitions', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        targetType: 'project',
        scope: 'organization',
        ownerActorId: other.id,
        definition,
      }),
    });
    expect(reassigned.status).toBe(422);

    await schema.db
      .update(schema.organization)
      .set({ vocabulary: { preset: 'nonprofit' } })
      .where(eq(schema.organization.id, orgId));
    const list = z
      .object({ items: z.array(WorkTemplateOut) })
      .parse(await (await app.request('/definitions')).json());
    const base = list.items.find((item) => item.isBase && item.targetType === 'initiative');
    expect(base?.definition.name).toBe('Blank campaign');
    expect(base?.latestVersion?.definition.name).toBe('Blank initiative');
  });
  it('preserves provenance by refusing deletion of a private starting draft used by existing work', async () => {
    const { app, orgId, teamId, statusId } = await fixture();
    const response = await app.request('/', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        targetType: 'task',
        name: 'Private outline',
        payload: { targetType: 'task' },
      }),
    });
    expect(response.status).toBe(201);
    const row = (await response.json()) as { id: string };
    await schema.db.insert(schema.task).values({
      organizationId: orgId,
      teamId,
      title: 'Already created',
      state: 'todo',
      statusId: statusId('task', 'todo'),
      templateId: row.id,
    });
    expect((await app.request(`/${row.id}`, { method: 'DELETE' })).status).toBe(409);
    expect((await app.request(`/${row.id}`)).status).toBe(200);
  });

  it('publishes legacy workspace writes atomically and archives their historical publications on delete', async () => {
    const { app } = await fixture();
    const response = await app.request('/', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        targetType: 'project',
        scope: 'organization',
        name: 'Legacy event',
        payload: { targetType: 'project' },
      }),
    });
    expect(response.status).toBe(201);
    const row = (await response.json()) as { id: string; workTypeVersionId: string };
    expect(row.workTypeVersionId).toBeTruthy();
    const update = await app.request(`/${row.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ name: 'New legacy event' }),
    });
    expect(update.status).toBe(200);
    expect((await app.request(`/${row.id}`, { method: 'DELETE' })).status).toBe(200);
    expect((await app.request(`/${row.id}`)).status).toBe(404);
    const versions = z
      .object({ items: z.array(WorkTemplateVersionOut) })
      .parse(await (await app.request(`/definitions/${row.id}/versions`)).json());
    expect(versions.items.map((version) => version.definition.name)).toEqual([
      'Legacy event',
      'New legacy event',
    ]);
  });
  it('refuses a legacy edit while an unreviewed canonical draft differs from publication', async () => {
    const { app } = await fixture();
    const row = await create(app);
    await app.request(`/definitions/${row.id}/publish`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ expectedRevision: 0 }),
    });
    await app.request(`/definitions/${row.id}/draft`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        expectedRevision: 1,
        definition: {
          ...definition,
          payload: { targetType: 'project', description: 'Unreviewed private draft body' },
        },
      }),
    });
    const rename = await app.request(`/${row.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ name: 'Public event name' }),
    });
    expect(rename.status).toBe(409);
    const publication = WorkTemplateOut.parse(
      await (await app.request(`/definitions/${row.id}`)).json(),
    );
    expect(publication.latestVersion?.definition.payload.description).toBe('Venue and guests');
    expect(publication.draftDefinition?.payload.description).toBe('Unreviewed private draft body');
  });
  it('keeps an archived unpublished organization draft private', async () => {
    const { app, orgId } = await fixture();
    const row = await create(app, 'organization');
    const [other] = await schema.db
      .insert(schema.actor)
      .values({ organizationId: orgId, kind: 'human', displayName: 'Reader of publications' })
      .returning();
    if (!other) throw new Error('missing actor');
    expect((await app.request(`/definitions/${row.id}/archive`, { method: 'POST' })).status).toBe(
      200,
    );
    const reader = appWithActor(router, orgId, ['view'], other.id);
    expect((await reader.request(`/definitions/${row.id}`)).status).toBe(404);
    expect((await reader.request(`/definitions/${row.id}/versions`)).status).toBe(404);
    const list = z
      .object({ items: z.array(WorkTemplateOut) })
      .parse(
        await (await reader.request('/definitions?includeArchived=true&includeDrafts=true')).json(),
      );
    expect(list.items.some((item) => item.id === row.id)).toBe(false);
  });

  it('reserves offering changes for administrators but accepts unchanged offerings in contributor saves', async () => {
    const { app, orgId, teamId, humanActorId } = await fixture();
    const row = await create(app);
    const contributor = appWithActor(router, orgId, ['contribute'], humanActorId);
    const denied = await contributor.request(`/definitions/${row.id}/draft`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ expectedRevision: 0, offeredTeamIds: [teamId] }),
    });
    expect(denied.status).toBe(403);
    const allowed = await app.request(`/definitions/${row.id}/draft`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ expectedRevision: 0, offeredTeamIds: [teamId] }),
    });
    expect(allowed.status).toBe(200);
    const saved = await contributor.request(`/definitions/${row.id}/draft`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        expectedRevision: 1,
        offeredTeamIds: [teamId],
        definition: { ...definition, name: 'Contributor edit' },
      }),
    });
    expect(saved.status).toBe(200);
    const createDenied = await contributor.request('/definitions', {
      method: 'POST',
      headers,
      body: JSON.stringify({ targetType: 'project', offeredTeamIds: [teamId], definition }),
    });
    expect(createDenied.status).toBe(403);
  });
});

it('refuses stale, wrong-kind and archived draft edits without changing canonical state', async () => {
  const f = await fixture(),
    row = await create(f.app);
  const before = one(
    await schema.db.select().from(schema.template).where(eq(schema.template.id, row.id)),
  );
  for (const [body, status, code] of [
    [
      { expectedRevision: 9, definition: { ...definition, name: 'Stale overwrite' } },
      409,
      'conflict',
    ],
    [
      { expectedRevision: 0, definition: { ...definition, payload: { targetType: 'task' } } },
      422,
      'validation_error',
    ],
  ] as const) {
    const refused = await f.app.request(`/definitions/${row.id}/draft`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(body),
    });
    expect(refused.status).toBe(status);
    expect(await refused.json()).toMatchObject({ code });
    expect(
      one(await schema.db.select().from(schema.template).where(eq(schema.template.id, row.id))),
    ).toEqual(before);
  }
  expect((await f.app.request(`/definitions/${row.id}/archive`, { method: 'POST' })).status).toBe(
    200,
  );
  const archived = one(
    await schema.db.select().from(schema.template).where(eq(schema.template.id, row.id)),
  );
  const refused = await f.app.request(`/definitions/${row.id}/draft`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({
      expectedRevision: archived.draftRevision,
      definition: { ...definition, name: 'Archived overwrite' },
    }),
  });
  expect(refused.status).toBe(409);
  expect(await refused.json()).toMatchObject({ code: 'conflict' });
  expect(
    one(await schema.db.select().from(schema.template).where(eq(schema.template.id, row.id))),
  ).toEqual(archived);
});

it('retains offerings on a foreign-team refusal and clears only explicitly selected offerings', async () => {
  const f = await fixture(),
    foreign = await fixture(),
    row = await create(f.app);
  const offered = await f.app.request(`/definitions/${row.id}/draft`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ expectedRevision: 0, offeredTeamIds: [f.teamId] }),
  });
  expect(offered.status).toBe(200);
  const before = one(
    await schema.db.select().from(schema.template).where(eq(schema.template.id, row.id)),
  );
  const bindings = await schema.db
    .select()
    .from(schema.workTypeTeam)
    .where(eq(schema.workTypeTeam.workTypeId, row.id));
  expect(bindings.map((binding) => binding.teamId)).toEqual([f.teamId]);
  const refused = await f.app.request(`/definitions/${row.id}/draft`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ expectedRevision: 1, offeredTeamIds: [foreign.teamId] }),
  });
  expect(refused.status).toBe(404);
  expect(await refused.json()).toMatchObject({ code: 'not_found' });
  expect(
    one(await schema.db.select().from(schema.template).where(eq(schema.template.id, row.id))),
  ).toEqual(before);
  expect(
    await schema.db
      .select()
      .from(schema.workTypeTeam)
      .where(eq(schema.workTypeTeam.workTypeId, row.id)),
  ).toEqual(bindings);
  const included = z
    .object({ items: z.array(WorkTemplateOut) })
    .parse(
      await (await f.app.request(`/definitions?includeDrafts=true&teamId=${f.teamId}`)).json(),
    );
  const excluded = z
    .object({ items: z.array(WorkTemplateOut) })
    .parse(
      await (
        await f.app.request(`/definitions?includeDrafts=true&teamId=${foreign.teamId}`)
      ).json(),
    );
  expect(included.items.some((item) => item.id === row.id)).toBe(true);
  expect(excluded.items.some((item) => item.id === row.id)).toBe(false);
  const cleared = await f.app.request(`/definitions/${row.id}/draft`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ expectedRevision: 1, offeredTeamIds: [] }),
  });
  expect(cleared.status).toBe(200);
  expect(WorkTemplateOut.parse(await cleared.json())).toMatchObject({
    revision: 2,
    offeredTeamIds: [],
  });
  expect(
    await schema.db
      .select()
      .from(schema.workTypeTeam)
      .where(eq(schema.workTypeTeam.workTypeId, row.id)),
  ).toEqual([]);
  expect(
    one(await schema.db.select().from(schema.template).where(eq(schema.template.id, row.id)))
      .draftDefinition,
  ).toEqual(before.draftDefinition);
});
