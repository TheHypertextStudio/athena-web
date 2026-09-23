/**
 * `@docket/api` — change sets recorded by the Project REST routes.
 *
 * @remarks
 * Every Project mutation made in the app records one change set naming the member and the `app`
 * channel. Labels, initiative links, and dependencies record relation entries.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import type projectsRouter from '../../src/routes/projects';
import { entriesFor, recordedEntries } from '../support/change-set-reads';
import {
  appWithActor,
  getDb,
  one,
  seedBaseOrg,
  seedInitiative,
  seedProject,
} from '../support/routes-harness';

let schema!: typeof DbModule;
let projects!: typeof projectsRouter;

beforeAll(async () => {
  schema = await getDb();
  projects = (await import('../../src/routes/projects')).default;
});

/** Seed an org, a label, an initiative, and a writer app bound to the org's human actor. */
async function setup() {
  const base = await seedBaseOrg(schema.db, schema);
  const app = appWithActor(projects, base.orgId, ['contribute', 'manage'], base.humanActorId);
  const label = one(
    await schema.db
      .insert(schema.label)
      .values({ organizationId: base.orgId, name: 'Launch', color: '#7c3aed' })
      .returning(),
  );
  const initiative = await seedInitiative(schema.db, schema, base.statusId, {
    organizationId: base.orgId,
    name: 'Grow',
    createdBy: base.humanActorId,
  });
  return { ...base, app, label, initiative };
}

/** Send a JSON request and return the response. */
function send(
  app: ReturnType<typeof appWithActor>,
  path: string,
  method: string,
  body?: unknown,
): Promise<Response> {
  return Promise.resolve(
    app.request(path, {
      method,
      headers: { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );
}

describe('project create and update change sets', () => {
  it('records a create with its initiative and label links', async () => {
    const { app, orgId, humanActorId, label, initiative } = await setup();
    const res = await send(app, '/', 'POST', {
      name: 'Beta',
      labelIds: [label.id],
      initiativeIds: [initiative.id],
    });
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };

    const entries = await entriesFor(schema, orgId, 'project_create');
    expect(entries.every((entry) => entry.channel === 'app')).toBe(true);
    expect(entries.every((entry) => entry.actorId === humanActorId)).toBe(true);
    expect(entries.map(({ entityKind, entityId, op }) => ({ entityKind, entityId, op }))).toEqual(
      expect.arrayContaining([
        { entityKind: 'project', entityId: id, op: 'create' },
        { entityKind: 'project_contributes_to', entityId: `${id}:${initiative.id}`, op: 'link' },
        { entityKind: 'project_has_label', entityId: `${id}:${label.id}`, op: 'link' },
      ]),
    );
  });

  it('records an update with before and after, and link entries for replaced labels', async () => {
    const { app, orgId, humanActorId, statusId, label } = await setup();
    const row = await seedProject(schema.db, schema, statusId, {
      organizationId: orgId,
      name: 'Old name',
      createdBy: humanActorId,
    });
    const res = await send(app, `/${row.id}`, 'PATCH', { name: 'New name', labelIds: [label.id] });
    expect(res.status).toBe(200);

    const entries = await entriesFor(schema, orgId, 'project_update');
    const update = entries.find((entry) => entry.entityKind === 'project');
    expect(update).toMatchObject({ entityId: row.id, op: 'update', channel: 'app' });
    expect(update?.before?.['name']).toBe(row.name);
    expect(update?.after?.['name']).toBe('New name');
    expect(entries).toContainEqual(
      expect.objectContaining({
        entityKind: 'project_has_label',
        entityId: `${row.id}:${label.id}`,
        op: 'link',
      }),
    );
  });

  it('records nothing for an empty update', async () => {
    const { app, orgId, humanActorId, statusId } = await setup();
    const row = await seedProject(schema.db, schema, statusId, {
      organizationId: orgId,
      name: 'Untouched',
      createdBy: humanActorId,
    });
    expect((await send(app, `/${row.id}`, 'PATCH', {})).status).toBe(200);
    expect(await recordedEntries(schema, orgId)).toEqual([]);
  });
});

describe('project label and delete change sets', () => {
  it('records an added label as a link entry', async () => {
    const { app, orgId, humanActorId, statusId, label } = await setup();
    const row = await seedProject(schema.db, schema, statusId, {
      organizationId: orgId,
      name: 'Labeled',
      createdBy: humanActorId,
    });
    expect((await send(app, `/${row.id}/labels`, 'POST', { labelId: label.id })).status).toBe(200);

    const entries = await entriesFor(schema, orgId, 'project_label_add');
    expect(entries).toEqual([
      expect.objectContaining({
        channel: 'app',
        entityKind: 'project_has_label',
        entityId: `${row.id}:${label.id}`,
        op: 'link',
      }),
    ]);
  });

  it('records a delete as an archive entry holding the last state', async () => {
    const { app, orgId, humanActorId, statusId } = await setup();
    const row = await seedProject(schema.db, schema, statusId, {
      organizationId: orgId,
      name: 'Doomed',
      createdBy: humanActorId,
    });
    expect((await send(app, `/${row.id}`, 'DELETE')).status).toBe(200);

    const [entry] = await entriesFor(schema, orgId, 'project_delete');
    expect(entry).toMatchObject({
      channel: 'app',
      entityKind: 'project',
      entityId: row.id,
      op: 'archive',
      after: null,
    });
    expect(entry?.before?.['name']).toBe('Doomed');
  });
});

describe('project dependency change sets', () => {
  it('records an added and a removed dependency as project_blocks links', async () => {
    const { app, orgId, humanActorId, statusId } = await setup();
    const [blocker, blocked] = await Promise.all(
      ['Blocker', 'Blocked'].map((name) =>
        seedProject(schema.db, schema, statusId, {
          organizationId: orgId,
          name,
          createdBy: humanActorId,
        }),
      ),
    );
    if (!blocker || !blocked) throw new Error('projects were not seeded');
    const edge = `${blocker.id}:${blocked.id}`;
    const added = await send(app, `/${blocked.id}/dependencies`, 'POST', {
      blockingProjectId: blocker.id,
    });
    expect(added.status).toBe(201);
    expect(await entriesFor(schema, orgId, 'project_dependency_link')).toEqual([
      expect.objectContaining({ channel: 'app', entityKind: 'project_blocks', entityId: edge }),
    ]);

    const removed = await send(app, `/${blocked.id}/dependencies/${blocker.id}`, 'DELETE');
    expect(removed.status).toBe(200);
    const [unlink] = await entriesFor(schema, orgId, 'project_dependency_unlink');
    expect(unlink).toMatchObject({
      channel: 'app',
      entityKind: 'project_blocks',
      entityId: edge,
      op: 'link',
      before: { from: blocker.id, to: blocked.id },
      after: null,
    });
  });
});
