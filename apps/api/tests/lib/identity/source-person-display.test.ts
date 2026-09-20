import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { assertDefined } from '@docket/test-utils';
import { TaskOut } from '@docket/work/task-model';
import { getDb, seedBaseOrg } from '../../support/routes-harness';
import { sourcePeopleForSubject } from '../../../src/lib/identity/source-people';

describe('source person display', () => {
  it('uses the current canonical name without rewriting source attribution', async () => {
    const schema = await getDb();
    const { orgId, humanActorId, teamId } = await seedBaseOrg(schema.db, schema);
    const [connection] = await schema.db
      .insert(schema.integration)
      .values({ organizationId: orgId, provider: 'linear', pattern: 'connector' })
      .returning();
    const [identity] = await schema.db
      .insert(schema.externalActor)
      .values({
        organizationId: orgId,
        integrationId: assertDefined(connection).id,
        externalId: 'sam',
        actorId: humanActorId,
        displayName: 'Source Sam',
      })
      .returning();
    await schema.db.insert(schema.sourcePersonReference).values({
      organizationId: orgId,
      externalActorId: assertDefined(identity).id,
      subjectType: 'task',
      subjectId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      field: 'assignee',
      actorId: humanActorId,
      sourceDisplayName: 'Source Sam',
    });
    await schema.db
      .update(schema.actor)
      .set({ displayName: 'Sam Canonical', avatar: 'https://example.test/sam.png' })
      .where(eq(schema.actor.id, humanActorId));
    const sourcePeople = await sourcePeopleForSubject(orgId, 'task', '01ARZ3NDEKTSV4RRFFQ69G5FAV');
    const task = TaskOut.parse({
      id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      organizationId: orgId,
      teamId,
      title: 'Imported work',
      state: 'todo',
      priority: 'none',
      autoCompletedBySubtasks: false,
      labels: [],
      provenance: { source: 'native' },
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
      sourcePeople,
    });
    expect(task.sourcePeople).toMatchObject([
      {
        displayName: 'Source Sam',
        canonicalDisplayName: 'Sam Canonical',
        canonicalAvatarUrl: 'https://example.test/sam.png',
      },
    ]);
  });
});
