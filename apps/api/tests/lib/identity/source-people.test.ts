import { beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import type * as DatabaseModule from '@docket/db';
import { assertDefined } from '@docket/test-utils';
import { appWithActor, getDb, seedBaseOrg, seedTask } from '../../support/routes-harness';
import {
  externalPersonCandidates,
  preserveSourceAssignee,
  resolveSourcePerson,
  sourcePeopleForSubject,
} from '../../../src/lib/identity/source-people';

let schema: typeof DatabaseModule;
beforeAll(async () => {
  schema = await getDb();
});

async function fixture() {
  const { orgId, humanActorId, teamId, statusId } = await seedBaseOrg(schema.db, schema);
  const [connection] = await schema.db
    .insert(schema.integration)
    .values({
      organizationId: orgId,
      provider: 'linear',
      pattern: 'connector',
      roles: ['work'],
      createdBy: humanActorId,
    })
    .returning();
  const integrationId = assertDefined(connection).id;
  const [identity] = await schema.db
    .insert(schema.externalActor)
    .values({ organizationId: orgId, integrationId, externalId: 'sam', displayName: 'Sam Rivera' })
    .returning();
  return {
    orgId,
    integrationId,
    identity: assertDefined(identity),
    humanActorId,
    teamId,
    statusId,
  };
}

describe('source people', () => {
  it('preserves unresolved source attribution and resolves creation atomically without duplicates', async () => {
    const { orgId, integrationId, identity } = await fixture();
    await preserveSourceAssignee(orgId, integrationId, 'source-task', 'sam');
    const before = await sourcePeopleForSubject(orgId, 'task', 'source-task');
    expect(before).toMatchObject([{ displayName: 'Sam Rivera', actorId: null }]);
    const first = await resolveSourcePerson(orgId, integrationId, identity.id, {
      action: 'create_actor',
    });
    const second = await resolveSourcePerson(orgId, integrationId, identity.id, {
      action: 'create_actor',
    });
    expect(first.actorId).toBeTruthy();
    expect(second.actorId).toBe(first.actorId);
    const [person] = await schema.db
      .select()
      .from(schema.actor)
      .where(eq(schema.actor.id, first.actorId ?? ''));
    expect(person).toMatchObject({ displayName: 'Sam Rivera', userId: null, kind: 'human' });
  });

  it('allows an explicit versioned correction to create a distinct person', async () => {
    const { orgId, integrationId, identity } = await fixture();
    const first = await resolveSourcePerson(orgId, integrationId, identity.id, {
      action: 'create_actor',
    });
    const corrected = await resolveSourcePerson(orgId, integrationId, identity.id, {
      action: 'create_actor',
      name: 'Another Sam',
      expectedUpdatedAt: first.updatedAt.toISOString(),
    });
    expect(corrected.actorId).not.toBe(first.actorId);
    const [person] = await schema.db
      .select()
      .from(schema.actor)
      .where(eq(schema.actor.id, corrected.actorId ?? ''));
    expect(person?.displayName).toBe('Another Sam');
  });

  it('serializes concurrent person creation for the same source without orphan records', async () => {
    const { orgId, integrationId, identity } = await fixture();
    const results = await Promise.all([
      resolveSourcePerson(orgId, integrationId, identity.id, { action: 'create_actor' }),
      resolveSourcePerson(orgId, integrationId, identity.id, { action: 'create_actor' }),
    ]);
    expect(results[0].actorId).toBe(results[1].actorId);
    const people = await schema.db
      .select()
      .from(schema.actor)
      .where(
        and(eq(schema.actor.organizationId, orgId), eq(schema.actor.displayName, 'Sam Rivera')),
      );
    expect(people).toHaveLength(1);
  });

  it('rolls back the person when linking fails after insertion', async () => {
    const { orgId, integrationId, identity } = await fixture();
    const service = await import('../../../src/lib/identity/create-person');
    const original = service.createWorkspacePerson;
    const failure = vi
      .spyOn(service, 'createWorkspacePerson')
      .mockImplementation(async (...args) => {
        await original(...args);
        throw new Error('injected identity write failure');
      });
    try {
      await expect(
        resolveSourcePerson(orgId, integrationId, identity.id, { action: 'create_actor' }),
      ).rejects.toThrow('injected identity write failure');
    } finally {
      failure.mockRestore();
    }
    const people = await schema.db
      .select()
      .from(schema.actor)
      .where(
        and(eq(schema.actor.organizationId, orgId), eq(schema.actor.displayName, 'Sam Rivera')),
      );
    const [unchanged] = await schema.db
      .select()
      .from(schema.externalActor)
      .where(eq(schema.externalActor.id, identity.id));
    expect(people).toHaveLength(0);
    expect(unchanged?.actorId).toBeNull();
  });

  it('reconciles native assignment when multiple source identities agree or diverge', async () => {
    const { orgId, integrationId, identity, humanActorId, teamId, statusId } = await fixture();
    const imported = await seedTask(schema.db, schema, statusId, {
      organizationId: orgId,
      teamId,
      title: 'Shared identity',
      state: 'todo',
    });
    const [other] = await schema.db
      .insert(schema.externalActor)
      .values({ organizationId: orgId, integrationId, externalId: 'lee', displayName: 'Lee' })
      .returning();
    const lee = assertDefined(other);
    const { preserveSourcePeople } = await import('../../../src/lib/identity/source-people');
    await preserveSourcePeople({
      orgId,
      integrationId,
      subjectType: 'task',
      subjectId: imported.id,
      field: 'assignee',
      externalIds: ['sam', 'lee'],
    });
    const assignment = async () =>
      (await schema.db.select().from(schema.task).where(eq(schema.task.id, imported.id)))[0]
        ?.assigneeId;
    await resolveSourcePerson(orgId, integrationId, identity.id, {
      action: 'match_existing',
      actorId: humanActorId,
    });
    expect(await assignment()).toBeNull();
    await resolveSourcePerson(orgId, integrationId, lee.id, {
      action: 'match_existing',
      actorId: humanActorId,
    });
    expect(await assignment()).toBe(humanActorId);
    const created = await resolveSourcePerson(orgId, integrationId, identity.id, {
      action: 'unlink',
    });
    expect(created.actorId).toBeNull();
    expect(await assignment()).toBeNull();
    await resolveSourcePerson(orgId, integrationId, identity.id, { action: 'create_actor' });
    expect(await assignment()).toBeNull();
  });

  it('suggests same-name people without linking them and rejects another workspace', async () => {
    const { orgId, integrationId, identity } = await fixture();
    const [person] = await schema.db
      .insert(schema.actor)
      .values({ organizationId: orgId, kind: 'human', displayName: 'Sam Rivera' })
      .returning();
    expect(await externalPersonCandidates(orgId, integrationId, identity.id)).toMatchObject([
      { actorId: assertDefined(person).id, reason: 'name' },
    ]);
    const other = await seedBaseOrg(schema.db, schema);
    await expect(
      resolveSourcePerson(orgId, integrationId, identity.id, {
        action: 'match_existing',
        actorId: other.humanActorId,
      }),
    ).rejects.toThrow('Actor not found');
  });

  it('keeps an explicit unlink distinct from an undecided identity', async () => {
    const { orgId, integrationId, identity } = await fixture();
    const next = await resolveSourcePerson(orgId, integrationId, identity.id, { action: 'unlink' });
    expect(next.actorId).toBeNull();
    expect(next.matchedBy).toBe('manual');
  });

  it('preserves missing provider users using a stable qualified fallback', async () => {
    const { orgId, integrationId } = await fixture();
    await preserveSourceAssignee(orgId, integrationId, 'unknown-source-task', 'missing-123');
    expect(await sourcePeopleForSubject(orgId, 'task', 'unknown-source-task')).toMatchObject([
      { externalId: 'missing-123', displayName: 'linear user missing-123', actorId: null },
    ]);
  });
  it('rejects stale resolution instead of replacing another confirmed choice', async () => {
    const { orgId, integrationId, identity } = await fixture();
    await resolveSourcePerson(orgId, integrationId, identity.id, { action: 'create_actor' });
    await expect(
      resolveSourcePerson(orgId, integrationId, identity.id, {
        action: 'unlink',
        expectedUpdatedAt: identity.updatedAt.toISOString(),
      }),
    ).rejects.toThrow('This identity changed');
  });

  it('retains attribution from independent connections on the same task', async () => {
    const first = await fixture();
    const [connection] = await schema.db
      .insert(schema.integration)
      .values({
        organizationId: first.orgId,
        provider: 'github',
        pattern: 'connector',
        roles: ['work'],
      })
      .returning();
    await preserveSourceAssignee(first.orgId, first.integrationId, 'shared-source-task', 'sam');
    await preserveSourceAssignee(
      first.orgId,
      assertDefined(connection).id,
      'shared-source-task',
      'another-person',
    );
    expect(await sourcePeopleForSubject(first.orgId, 'task', 'shared-source-task')).toHaveLength(2);
  });

  it.each(['task', 'project'] as const)(
    'rolls back newly adopted %s when source attribution fails',
    async (entity) => {
      const { orgId, integrationId, humanActorId } = await fixture();
      const [integration] = await schema.db
        .select()
        .from(schema.integration)
        .where(eq(schema.integration.id, integrationId));
      const source = await import('../../../src/lib/identity/source-people');
      const original = source.preserveSourcePeople;
      const failure = vi
        .spyOn(source, 'preserveSourcePeople')
        .mockImplementation(async (...args) => {
          await original(...args);
          throw new Error('injected source attribution failure');
        });
      const { adoptEntity } = await import('../../../src/routes/notion-mirror-entities');
      try {
        await expect(
          adoptEntity(orgId, humanActorId, assertDefined(integration), entity, {
            title: { kind: 'text', value: 'Atomic adoption' },
            name: { kind: 'text', value: 'Atomic adoption' },
            assignee: { kind: 'people', externalIds: ['sam'] },
            lead: { kind: 'people', externalIds: ['sam'] },
          }),
        ).rejects.toThrow('injected source attribution failure');
      } finally {
        failure.mockRestore();
      }
      expect(
        await schema.db
          .select()
          .from(schema.task)
          .where(
            and(eq(schema.task.organizationId, orgId), eq(schema.task.title, 'Atomic adoption')),
          ),
      ).toEqual([]);
      expect(
        await schema.db
          .select()
          .from(schema.project)
          .where(
            and(
              eq(schema.project.organizationId, orgId),
              eq(schema.project.name, 'Atomic adoption'),
            ),
          ),
      ).toEqual([]);
      expect(
        await schema.db
          .select()
          .from(schema.sourcePersonReference)
          .where(eq(schema.sourcePersonReference.organizationId, orgId)),
      ).toEqual([]);
    },
  );

  it('rejects a stale Notion pull after a manual assignment edit', async () => {
    const { orgId, integrationId, humanActorId, teamId, statusId } = await fixture();
    const imported = await seedTask(schema.db, schema, statusId, {
      organizationId: orgId,
      teamId,
      title: 'Local task',
      state: 'todo',
    });
    await schema.db
      .update(schema.task)
      .set({ assigneeId: humanActorId, updatedAt: new Date(imported.updatedAt.getTime() + 1000) })
      .where(eq(schema.task.id, imported.id));
    const { applyPulledValues } = await import('../../../src/routes/notion-mirror-entities');
    const applied = await applyPulledValues(
      orgId,
      { actorId: humanActorId, integrationId, expectedUpdatedAt: imported.updatedAt },
      'task',
      imported.id,
      {
        title: { kind: 'text', value: 'Stale provider title' },
        assignee: { kind: 'people', externalIds: ['sam'] },
      },
    );
    expect(applied).toBe(false);
    const [unchanged] = await schema.db
      .select()
      .from(schema.task)
      .where(eq(schema.task.id, imported.id));
    expect(unchanged).toMatchObject({ title: 'Local task', assigneeId: humanActorId });
    expect(await sourcePeopleForSubject(orgId, 'task', imported.id)).toEqual([]);
  });

  it('includes unresolved source names in task list read responses', async () => {
    const { orgId, integrationId, humanActorId, teamId, statusId } = await fixture();
    const task = await seedTask(schema.db, schema, statusId, {
      organizationId: orgId,
      teamId,
      title: 'Imported assignment',
      state: 'todo',
    });
    await preserveSourceAssignee(orgId, integrationId, task.id, 'sam');
    const router = (await import('../../../src/routes/tasks')).default;
    const response = await appWithActor(router, orgId, ['manage'], humanActorId).request('/');
    expect(response.status).toBe(200);
    const result = (await response.json()) as {
      items: { id: string; assigneeId: string | null; sourcePeople: { displayName: string }[] }[];
    };
    expect(result.items.find((item) => item.id === task.id)).toMatchObject({
      assigneeId: null,
      sourcePeople: [{ displayName: 'Sam Rivera' }],
    });
  });
});
