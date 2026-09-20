import { beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import type * as DbModule from '@docket/db';
import { assertDefined } from '@docket/test-utils';
import { getDb, seedBaseOrg, seedTask } from '../support/routes-harness';
import { seedPeopleUser, seedPeopleWorkspace } from '../support/people-fixtures';
import { preserveSourcePeople } from '../../src/lib/identity/source-people';
import {
  consolidatePeople,
  previewPersonConsolidation,
} from '../../src/routes/person-consolidation';
import { archiveWorkspacePerson } from '../../src/routes/person-removal';

let schema: typeof DbModule;
beforeAll(async () => {
  schema = await getDb();
});

async function peopleFixture() {
  const base = await seedBaseOrg(schema.db, schema);
  const [source] = await schema.db
    .insert(schema.actor)
    .values({ organizationId: base.orgId, kind: 'human', displayName: 'Duplicate' })
    .returning();
  return { ...base, sourceId: assertDefined(source).id };
}

describe('person lifecycle preserves identity history', () => {
  it('resolves ambiguous imported task and project people after consolidation', async () => {
    const { orgId, teamId, humanActorId, statusId, sourceId } = await peopleFixture();
    const [connection] = await schema.db
      .insert(schema.integration)
      .values({ organizationId: orgId, provider: 'notion', pattern: 'connector' })
      .returning();
    const integrationId = assertDefined(connection).id;
    await schema.db.insert(schema.externalActor).values([
      {
        organizationId: orgId,
        integrationId,
        externalId: 'first',
        displayName: 'First',
        actorId: sourceId,
        matchedBy: 'manual',
      },
      {
        organizationId: orgId,
        integrationId,
        externalId: 'second',
        displayName: 'Second',
        actorId: humanActorId,
        matchedBy: 'manual',
      },
    ]);
    const task = await seedTask(schema.db, schema, statusId, {
      organizationId: orgId,
      teamId,
      title: 'Imported work',
      state: 'todo',
    });
    const [project] = await schema.db
      .insert(schema.project)
      .values({
        organizationId: orgId,
        teamId,
        name: 'Imported project',
        createdBy: humanActorId,
        status: 'planned',
        statusId: statusId('project', 'planned'),
      })
      .returning();
    const projectId = assertDefined(project).id;
    await preserveSourcePeople({
      orgId,
      integrationId,
      subjectType: 'task',
      subjectId: task.id,
      field: 'assignee',
      externalIds: ['first', 'second'],
    });
    await preserveSourcePeople({
      orgId,
      integrationId,
      subjectType: 'project',
      subjectId: projectId,
      field: 'lead',
      externalIds: ['first', 'second'],
    });
    const preview = await previewPersonConsolidation(orgId, sourceId, humanActorId);
    await consolidatePeople(orgId, sourceId, humanActorId, {
      mergedBy: humanActorId,
      previewRevision: preview.previewRevision,
    });
    const [updatedTask] = await schema.db
      .select()
      .from(schema.task)
      .where(eq(schema.task.id, task.id));
    const [updatedProject] = await schema.db
      .select()
      .from(schema.project)
      .where(eq(schema.project.id, projectId));
    expect(updatedTask?.assigneeId).toBe(humanActorId);
    expect(updatedProject?.leadId).toBe(humanActorId);
  });

  it('keeps the last account-backed owner when removal bypasses the route precheck', async () => {
    const { orgId, ownerActorId } = await seedPeopleWorkspace(schema);
    await expect(archiveWorkspacePerson(orgId, ownerActorId)).rejects.toThrow('active owner');
    const [owner] = await schema.db
      .select()
      .from(schema.actor)
      .where(eq(schema.actor.id, ownerActorId));
    expect(owner?.userId).not.toBeNull();
    expect(owner?.archivedAt).toBeNull();
  });

  it('removes access without deleting invitation and consolidation history', async () => {
    const { orgId, teamId, humanActorId, sourceId } = await peopleFixture();
    const user = await seedPeopleUser(schema);
    await schema.db
      .update(schema.actor)
      .set({ userId: user.id })
      .where(eq(schema.actor.id, humanActorId));
    const [role] = await schema.db
      .insert(schema.role)
      .values({ organizationId: orgId, key: 'member', name: 'Member', capabilities: ['view'] })
      .returning();
    const roleId = assertDefined(role).id;
    await schema.db
      .insert(schema.teamMember)
      .values({ organizationId: orgId, teamId, actorId: humanActorId })
      .onConflictDoNothing();
    await schema.db.insert(schema.grant).values({
      organizationId: orgId,
      subjectKind: 'actor',
      subjectId: humanActorId,
      resourceKind: 'team',
      resourceId: teamId,
      capabilities: ['view'],
    });
    await schema.db.insert(schema.invitation).values(
      ['pending', 'accepted'].map((status) => ({
        organizationId: orgId,
        roleId,
        email: user.email,
        invitedBy: humanActorId,
        personActorId: humanActorId,
        token: `${humanActorId}-${status}`,
        status: status as 'pending' | 'accepted',
        expiresAt: new Date(Date.now() + 60000),
      })),
    );
    const preview = await previewPersonConsolidation(orgId, sourceId, humanActorId);
    await consolidatePeople(orgId, sourceId, humanActorId, {
      mergedBy: humanActorId,
      previewRevision: preview.previewRevision,
    });
    await archiveWorkspacePerson(orgId, humanActorId);
    const [person] = await schema.db
      .select()
      .from(schema.actor)
      .where(eq(schema.actor.id, humanActorId));
    expect(person).toMatchObject({
      userId: null,
      roleId: null,
      status: 'suspended',
      archivedAt: expect.any(Date),
    });
    expect(
      await schema.db
        .select()
        .from(schema.actorAlias)
        .where(eq(schema.actorAlias.actorId, sourceId)),
    ).toHaveLength(1);
    expect(
      await schema.db
        .select()
        .from(schema.teamMember)
        .where(eq(schema.teamMember.actorId, humanActorId)),
    ).toEqual([]);
    expect(
      await schema.db
        .select()
        .from(schema.grant)
        .where(
          and(eq(schema.grant.subjectKind, 'actor'), eq(schema.grant.subjectId, humanActorId)),
        ),
    ).toEqual([]);
    const invitations = await schema.db
      .select()
      .from(schema.invitation)
      .where(eq(schema.invitation.personActorId, humanActorId));
    expect(invitations.map((row) => row.status).sort()).toEqual(['accepted', 'revoked']);
  });
});
