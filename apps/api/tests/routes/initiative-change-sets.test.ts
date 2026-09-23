/**
 * `@docket/api` — change sets recorded by the Initiative REST routes.
 *
 * @remarks
 * Every Initiative mutation made in the app records one change set naming the member and the
 * `app` channel. Project and program links record relation entries; hierarchy changes record an
 * update to the child initiative.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import type initiativesRouter from '../../src/routes/initiatives';
import { entriesFor } from '../support/change-set-reads';
import {
  appWithActor,
  appWithAuthenticatedActor,
  getDb,
  one,
  seedBaseOrg,
  seedInitiative,
  seedProgram,
  seedProject,
} from '../support/routes-harness';

let schema!: typeof DbModule;
let initiatives!: typeof initiativesRouter;

beforeAll(async () => {
  schema = await getDb();
  initiatives = (await import('../../src/routes/initiatives')).default;
});

/** Seed an org, one initiative, and a writer app bound to the org's human actor. */
async function setup() {
  const base = await seedBaseOrg(schema.db, schema);
  const app = appWithActor(initiatives, base.orgId, ['contribute', 'manage'], base.humanActorId);
  const row = await seedInitiative(schema.db, schema, base.statusId, {
    organizationId: base.orgId,
    name: 'Expand',
    createdBy: base.humanActorId,
  });
  return { ...base, app, row };
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

describe('initiative entity change sets', () => {
  it('records a create and an update in the app channel', async () => {
    const { app, orgId, humanActorId } = await setup();
    const res = await send(app, '/', 'POST', { name: 'Retain' });
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    expect(await entriesFor(schema, orgId, 'initiative_create')).toEqual([
      expect.objectContaining({
        actorId: humanActorId,
        channel: 'app',
        entityKind: 'initiative',
        entityId: id,
        op: 'create',
      }),
    ]);

    expect((await send(app, `/${id}`, 'PATCH', { priority: 'high' })).status).toBe(200);
    const [entry] = await entriesFor(schema, orgId, 'initiative_update');
    expect(entry).toMatchObject({ channel: 'app', entityKind: 'initiative', entityId: id });
    expect(entry?.op).toBe('update');
    expect(entry?.before?.['priority']).toBe('none');
    expect(entry?.after?.['priority']).toBe('high');
  });

  it('records an added label as an update and a delete as an archive', async () => {
    const { app, orgId, row } = await setup();
    const label = one(
      await schema.db
        .insert(schema.label)
        .values({ organizationId: orgId, name: 'Bet', color: '#7c3aed' })
        .returning(),
    );
    expect((await send(app, `/${row.id}/labels`, 'POST', { labelId: label.id })).status).toBe(200);
    expect(await entriesFor(schema, orgId, 'initiative_label_add')).toEqual([
      expect.objectContaining({ entityKind: 'initiative', entityId: row.id, op: 'update' }),
    ]);

    expect((await send(app, `/${row.id}`, 'DELETE')).status).toBe(200);
    expect(await entriesFor(schema, orgId, 'initiative_delete')).toEqual([
      expect.objectContaining({
        channel: 'app',
        entityKind: 'initiative',
        entityId: row.id,
        op: 'archive',
      }),
    ]);
  });
});

describe('initiative link change sets', () => {
  it('records project and program links and unlinks as relation entries', async () => {
    const { app, orgId, humanActorId, statusId, row } = await setup();
    const owner = { organizationId: orgId, createdBy: humanActorId };
    const project = await seedProject(schema.db, schema, statusId, { ...owner, name: 'Site' });
    const program = await seedProgram(schema.db, schema, statusId, { ...owner, name: 'Care' });
    const projectEdge = `${project.id}:${row.id}`;
    const programEdge = `${program.id}:${row.id}`;

    expect((await send(app, `/${row.id}/projects`, 'POST', { projectId: project.id })).status).toBe(
      201,
    );
    expect((await send(app, `/${row.id}/projects/${project.id}`, 'DELETE')).status).toBe(200);
    expect((await send(app, `/${row.id}/programs`, 'POST', { programId: program.id })).status).toBe(
      201,
    );
    expect((await send(app, `/${row.id}/programs/${program.id}`, 'DELETE')).status).toBe(200);

    const expectations = [
      ['initiative_project_link', 'project_contributes_to', projectEdge],
      ['initiative_project_unlink', 'project_contributes_to', projectEdge],
      ['initiative_program_link', 'program_contributes_to', programEdge],
      ['initiative_program_unlink', 'program_contributes_to', programEdge],
    ] as const;
    for (const [tool, entityKind, entityId] of expectations) {
      expect(await entriesFor(schema, orgId, tool)).toEqual([
        expect.objectContaining({ channel: 'app', entityKind, entityId, op: 'link' }),
      ]);
    }
  });
});

describe('initiative hierarchy change sets', () => {
  it('records a link, move, and unlink as updates to the child initiative', async () => {
    const { orgId, humanActorId, statusId } = await seedBaseOrg(schema.db, schema);
    const app = await appWithAuthenticatedActor(
      schema.db,
      schema,
      initiatives,
      orgId,
      ['view', 'contribute'],
      humanActorId,
    );
    const owner = { organizationId: orgId, createdBy: humanActorId };
    const [first, second, child] = await Promise.all(
      ['First', 'Second', 'Child'].map((name) =>
        seedInitiative(schema.db, schema, statusId, { ...owner, name }),
      ),
    );
    if (!first || !second || !child) throw new Error('initiatives were not seeded');

    const linked = await send(app, '/hierarchy-links', 'POST', {
      parentInitiativeId: first.id,
      childInitiativeId: child.id,
    });
    expect(linked.status).toBe(201);
    const { id: linkId } = (await linked.json()) as { id: string };
    const moved = await send(app, `/hierarchy-links/${linkId}`, 'PATCH', {
      parentInitiativeId: second.id,
    });
    expect(moved.status).toBe(200);
    expect((await send(app, `/hierarchy-links/${linkId}`, 'DELETE')).status).toBe(200);

    for (const tool of ['link', 'move', 'unlink']) {
      expect(await entriesFor(schema, orgId, `initiative_hierarchy_${tool}`)).toEqual([
        expect.objectContaining({
          channel: 'app',
          entityKind: 'initiative',
          entityId: child.id,
          op: 'update',
        }),
      ]);
    }
  });
});
