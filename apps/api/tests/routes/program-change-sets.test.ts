/**
 * `@docket/api` — change sets recorded by the Program REST routes.
 *
 * @remarks
 * Every Program mutation made in the app records one change set naming the member and the `app`
 * channel. Programs have no label relation kind, so an added label records an entity update.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import type programsRouter from '../../src/routes/programs';
import { entriesFor, recordedEntries } from '../support/change-set-reads';
import { appWithActor, getDb, one, seedBaseOrg, seedProgram } from '../support/routes-harness';

let schema!: typeof DbModule;
let programs!: typeof programsRouter;

beforeAll(async () => {
  schema = await getDb();
  programs = (await import('../../src/routes/programs')).default;
});

/** Seed an org, one program, and a writer app bound to the org's human actor. */
async function setup() {
  const base = await seedBaseOrg(schema.db, schema);
  const app = appWithActor(programs, base.orgId, ['contribute', 'manage'], base.humanActorId);
  const row = await seedProgram(schema.db, schema, base.statusId, {
    organizationId: base.orgId,
    name: 'Operations',
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

describe('program change sets', () => {
  it('records a create in the app channel', async () => {
    const { app, orgId, humanActorId } = await setup();
    const res = await send(app, '/', 'POST', { name: 'Support' });
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };

    expect(await entriesFor(schema, orgId, 'program_create')).toEqual([
      expect.objectContaining({
        actorId: humanActorId,
        channel: 'app',
        entityKind: 'program',
        entityId: id,
        op: 'create',
      }),
    ]);
  });

  it('records an update with before and after, and nothing for an empty body', async () => {
    const { app, orgId, row } = await setup();
    expect((await send(app, `/${row.id}`, 'PATCH', {})).status).toBe(200);
    expect(await recordedEntries(schema, orgId)).toEqual([]);

    expect((await send(app, `/${row.id}`, 'PATCH', { name: 'Ops' })).status).toBe(200);
    const [entry] = await entriesFor(schema, orgId, 'program_update');
    expect(entry).toMatchObject({ channel: 'app', entityKind: 'program', entityId: row.id });
    expect(entry?.op).toBe('update');
    expect(entry?.before?.['name']).toBe(row.name);
    expect(entry?.after?.['name']).toBe('Ops');
  });

  it('records an added label as an update to the program', async () => {
    const { app, orgId, row } = await setup();
    const label = one(
      await schema.db
        .insert(schema.label)
        .values({ organizationId: orgId, name: 'Core', color: '#16a34a' })
        .returning(),
    );
    expect((await send(app, `/${row.id}/labels`, 'POST', { labelId: label.id })).status).toBe(200);
    expect(await entriesFor(schema, orgId, 'program_label_add')).toEqual([
      expect.objectContaining({
        channel: 'app',
        entityKind: 'program',
        entityId: row.id,
        op: 'update',
      }),
    ]);
  });

  it('records a delete as an archive entry', async () => {
    const { app, orgId, row } = await setup();
    expect((await send(app, `/${row.id}`, 'DELETE')).status).toBe(200);
    const [entry] = await entriesFor(schema, orgId, 'program_delete');
    expect(entry).toMatchObject({
      channel: 'app',
      entityKind: 'program',
      entityId: row.id,
      op: 'archive',
    });
    expect(entry?.before?.['name']).toBe(row.name);
  });
});
