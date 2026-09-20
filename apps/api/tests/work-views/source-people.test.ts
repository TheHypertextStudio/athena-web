import { beforeAll, describe, expect, it } from 'vitest';
import type * as DatabaseModule from '@docket/db';
import { assertDefined } from '@docket/test-utils';
import { queryWorkView } from '../../src/lib/work-views/query';
import { getDb, seedBaseOrg, seedTask, seedProject } from '../support/routes-harness';
import { taskRequest, projectRequest } from './request-fixtures';

let schema: typeof DatabaseModule;
beforeAll(async () => {
  schema = await getDb();
});

async function fixture() {
  const base = await seedBaseOrg(schema.db, schema);
  const [connection] = await schema.db
    .insert(schema.integration)
    .values({
      organizationId: base.orgId,
      provider: 'linear',
      pattern: 'connector',
      roles: ['work'],
    })
    .returning();
  const [person] = await schema.db
    .insert(schema.externalActor)
    .values({
      organizationId: base.orgId,
      integrationId: assertDefined(connection).id,
      externalId: 'sam',
      displayName: 'Sam Rivera',
    })
    .returning();
  return { ...base, person: assertDefined(person) };
}

async function attach(
  base: Awaited<ReturnType<typeof fixture>>,
  subjectType: string,
  subjectId: string,
  field: string,
) {
  await schema.db.insert(schema.sourcePersonReference).values({
    organizationId: base.orgId,
    externalActorId: base.person.id,
    subjectType,
    subjectId,
    field,
    sourceDisplayName: 'Sam Rivera',
  });
}

describe('source-only person grouping', () => {
  it('separates imported assignees from true unassigned tasks and keeps source groups read-only', async () => {
    const base = await fixture();
    const imported = await seedTask(schema.db, schema, base.statusId, {
      organizationId: base.orgId,
      teamId: base.teamId,
      title: 'Imported',
      state: 'todo',
      visibility: 'public',
    });
    const empty = await seedTask(schema.db, schema, base.statusId, {
      organizationId: base.orgId,
      teamId: base.teamId,
      title: 'Unassigned',
      state: 'todo',
      visibility: 'public',
    });
    await attach(base, 'task', imported.id, 'assignee');
    const request = taskRequest();
    const groupedRequest = taskRequest({
      definition: {
        ...request.definition,
        arrangement: { ...request.definition.arrangement, groupBy: 'assignee' },
      },
    });
    const query = (request: ReturnType<typeof taskRequest>) =>
      queryWorkView({
        database: schema.db,
        organizationId: base.orgId,
        actorId: base.humanActorId,
        request,
      });
    const grouped = await query(groupedRequest);
    expect(grouped.groups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: `source-person:${base.person.id}`,
          label: 'Sam Rivera',
          count: 1,
          mutable: false,
        }),
        expect.objectContaining({ key: '__empty__', count: 1 }),
      ]),
    );
    const emptyResult = await query(
      taskRequest({
        definition: {
          ...request.definition,
          filter: { kind: 'predicate', field: 'assignee', operator: 'isEmpty' },
        },
      }),
    );
    expect(emptyResult.rows.map((row) => row.id)).toEqual([empty.id]);
    const assignedResult = await query(
      taskRequest({
        definition: {
          ...request.definition,
          filter: { kind: 'predicate', field: 'assignee', operator: 'isNotEmpty' },
        },
      }),
    );
    expect(assignedResult.rows.map((row) => row.id)).toEqual([imported.id]);
    const sourcePage = await query(
      taskRequest({ ...groupedRequest, groupPath: [`source-person:${base.person.id}`] }),
    );
    expect(sourcePage.rows.map((row) => row.id)).toEqual([imported.id]);
  });

  it('keeps unresolved project leads out of empty-lead results', async () => {
    const base = await fixture();
    const imported = await seedProject(schema.db, schema, base.statusId, {
      organizationId: base.orgId,
      name: 'Imported project',
      status: 'planned',
      visibility: 'public',
    });
    await attach(base, 'project', imported.id, 'lead');
    const request = projectRequest();
    const result = await queryWorkView({
      database: schema.db,
      organizationId: base.orgId,
      actorId: base.humanActorId,
      request: projectRequest({
        definition: {
          ...request.definition,
          filter: { kind: 'predicate', field: 'lead', operator: 'isEmpty' },
        },
      }),
    });
    expect(result.rows).toEqual([]);
  });
});
