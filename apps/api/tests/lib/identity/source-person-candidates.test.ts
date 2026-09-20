import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type * as DatabaseModule from '@docket/db';
import { assertDefined } from '@docket/test-utils';
import { getDb, seedBaseOrg } from '../../support/routes-harness';
import {
  externalPersonCandidates,
  preserveSourceAssignee,
  preserveSourcePeople,
  resolveSourcePerson,
  sourcePeopleForSubject,
} from '../../../src/lib/identity/source-people';
import {
  notionPersonFields,
  applyNotionSourcePeople,
} from '../../../src/lib/identity/notion-source-people';

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
      provider: 'notion',
      pattern: 'connector',
      roles: ['work'],
      createdBy: base.humanActorId,
    })
    .returning();
  const integrationId = assertDefined(connection).id;
  const [identity] = await schema.db
    .insert(schema.externalActor)
    .values({
      organizationId: base.orgId,
      integrationId,
      externalId: 'sam',
      displayName: 'Sam Rivera',
    })
    .returning();
  return { ...base, integrationId, identity: assertDefined(identity) };
}

describe('source person candidate evidence', () => {
  it('explains linked, email, and name candidates without linking a suggestion automatically', async () => {
    const { orgId, integrationId, identity, humanActorId } = await fixture();
    const email = `${orgId.toLowerCase()}@example.test`;
    const [account] = await schema.db
      .insert(schema.user)
      .values({ name: 'Different name', email })
      .returning();
    const people = await schema.db
      .insert(schema.actor)
      .values([
        {
          organizationId: orgId,
          kind: 'human',
          displayName: 'Different name',
          userId: assertDefined(account).id,
        },
        { organizationId: orgId, kind: 'human', displayName: 'Sam Rivera' },
      ])
      .returning();
    await schema.db
      .update(schema.externalActor)
      .set({ email: email.toUpperCase(), actorId: humanActorId, matchedBy: 'manual' })
      .where(eq(schema.externalActor.id, identity.id));
    const candidates = await externalPersonCandidates(orgId, integrationId, identity.id);
    expect(candidates).toHaveLength(3);
    expect(candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ actorId: humanActorId, reason: 'linked' }),
        expect.objectContaining({ actorId: assertDefined(people[0]).id, reason: 'email' }),
        expect.objectContaining({ actorId: assertDefined(people[1]).id, reason: 'name' }),
      ]),
    );
    const [unchanged] = await schema.db
      .select()
      .from(schema.externalActor)
      .where(eq(schema.externalActor.id, identity.id));
    expect(unchanged?.actorId).toBe(humanActorId);
  });

  it('excludes archived, suspended, and foreign people and rejects an archived link target', async () => {
    const { orgId, integrationId, identity } = await fixture();
    const foreign = await fixture();
    const [archived] = await schema.db
      .insert(schema.actor)
      .values([
        { organizationId: orgId, kind: 'human', displayName: 'Sam Rivera', archivedAt: new Date() },
        { organizationId: orgId, kind: 'human', displayName: 'Sam Rivera', status: 'suspended' },
        { organizationId: foreign.orgId, kind: 'human', displayName: 'Sam Rivera' },
      ])
      .returning();
    expect(await externalPersonCandidates(orgId, integrationId, identity.id)).toEqual([]);
    await expect(
      resolveSourcePerson(orgId, integrationId, identity.id, {
        action: 'match_existing',
        actorId: assertDefined(archived).id,
      }),
    ).rejects.toThrow('Actor not found');
    await expect(
      externalPersonCandidates(foreign.orgId, integrationId, identity.id),
    ).rejects.toThrow('External actor not found');
  });

  it('rejects a foreign source connection without replacing preserved assignment evidence', async () => {
    const { orgId, integrationId, identity } = await fixture();
    const foreign = await fixture();
    await preserveSourceAssignee(orgId, integrationId, identity.id, 'sam');
    await expect(
      preserveSourceAssignee(orgId, foreign.integrationId, identity.id, 'missing'),
    ).rejects.toThrow('Integration not found');
    expect(await sourcePeopleForSubject(orgId, 'task', identity.id)).toMatchObject([
      { externalActorId: identity.id, externalId: 'sam' },
    ]);
  });

  it('keeps every native Notion identity and unknown names when projecting a single-person field', async () => {
    const { orgId, integrationId, identity } = await fixture();
    await preserveSourcePeople({
      orgId,
      integrationId,
      subjectType: 'task',
      subjectId: identity.id,
      field: 'assignee',
      externalIds: ['sam', 'lee'],
    });
    const fields = await notionPersonFields(orgId, integrationId, 'task', new Map());
    expect(fields('assignee', null, identity.id)['assignee']).toMatchObject({
      actorId: null,
      sourceExternalIds: expect.arrayContaining(['sam', 'lee']),
      displayName: null,
    });
    expect(fields('assignee', 'unknown-person', 'native-task')['assignee']).toMatchObject({
      actorId: 'unknown-person',
      sourceExternalIds: [],
      displayName: null,
    });
    await applyNotionSourcePeople({
      orgId,
      integrationId,
      subjectType: 'initiative',
      subjectId: identity.id,
      values: { owner: { kind: 'people', externalIds: ['sam'] } },
    });
    expect(await sourcePeopleForSubject(orgId, 'initiative', identity.id)).toEqual([]);
  });
});
