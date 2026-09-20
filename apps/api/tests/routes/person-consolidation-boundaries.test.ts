import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type * as DbModule from '@docket/db';
import { assertDefined } from '@docket/test-utils';
import { getDb, seedBaseOrg } from '../support/routes-harness';
import { seedPeopleUser } from '../support/people-fixtures';
import {
  consolidatePeople,
  previewPersonConsolidation,
} from '../../src/routes/person-consolidation';
import { archiveWorkspacePerson } from '../../src/routes/person-removal';

let schema: typeof DbModule;
beforeAll(async () => {
  schema = await getDb();
});

async function fixture() {
  const base = await seedBaseOrg(schema.db, schema);
  const [source] = await schema.db
    .insert(schema.actor)
    .values({
      organizationId: base.orgId,
      kind: 'human',
      displayName: 'Imported duplicate',
    })
    .returning();
  return { ...base, sourceId: assertDefined(source).id };
}

describe('person consolidation boundaries', () => {
  it('rejects same-person and account-backed previews without changing either person', async () => {
    const { orgId, sourceId, humanActorId } = await fixture();
    await expect(previewPersonConsolidation(orgId, sourceId, sourceId)).rejects.toThrow(
      'two different',
    );
    await expect(
      consolidatePeople(orgId, sourceId, sourceId, {
        mergedBy: humanActorId,
        previewRevision: 'invalid',
      }),
    ).rejects.toThrow('cannot be replaced');
    const user = await seedPeopleUser(schema);
    await schema.db
      .update(schema.actor)
      .set({ userId: user.id })
      .where(eq(schema.actor.id, sourceId));
    await expect(previewPersonConsolidation(orgId, sourceId, humanActorId)).rejects.toThrow(
      'must survive',
    );
    const [source] = await schema.db
      .select()
      .from(schema.actor)
      .where(eq(schema.actor.id, sourceId));
    expect(source).toMatchObject({ userId: user.id, archivedAt: null });
  });

  it('rejects stale confirmation after the survivor is archived and preserves the source', async () => {
    const { orgId, sourceId, humanActorId } = await fixture();
    const preview = await previewPersonConsolidation(orgId, sourceId, humanActorId);
    await archiveWorkspacePerson(orgId, humanActorId);
    await expect(previewPersonConsolidation(orgId, sourceId, humanActorId)).rejects.toThrow(
      'Person not found',
    );
    await expect(
      consolidatePeople(orgId, sourceId, humanActorId, {
        mergedBy: sourceId,
        previewRevision: preview.previewRevision,
      }),
    ).rejects.toThrow('Person not found');
    await expect(archiveWorkspacePerson(orgId, humanActorId)).rejects.toThrow('Member not found');
    const [source] = await schema.db
      .select()
      .from(schema.actor)
      .where(eq(schema.actor.id, sourceId));
    expect(source?.archivedAt).toBeNull();
    expect(
      await schema.db
        .select()
        .from(schema.actorAlias)
        .where(eq(schema.actorAlias.actorId, sourceId)),
    ).toEqual([]);
  });

  it('moves project membership, planning defaults, and pending invitations while preserving accepted history', async () => {
    const { orgId, sourceId, humanActorId, teamId, statusId } = await fixture();
    const [project] = await schema.db
      .insert(schema.project)
      .values({
        organizationId: orgId,
        teamId,
        name: 'Shared project',
        createdBy: humanActorId,
        status: 'planned',
        statusId: statusId('project', 'planned'),
      })
      .returning();
    const projectId = assertDefined(project).id;
    await schema.db.insert(schema.projectMember).values([
      { organizationId: orgId, projectId, actorId: sourceId },
      { organizationId: orgId, projectId, actorId: humanActorId },
    ]);
    const templates = await schema.db
      .insert(schema.template)
      .values([
        {
          organizationId: orgId,
          targetType: 'task',
          name: 'Imported default',
          ownerActorId: sourceId,
          payload: { targetType: 'task', description: 'Imported default' },
        },
        {
          organizationId: orgId,
          targetType: 'task',
          name: 'Existing default',
          ownerActorId: humanActorId,
          payload: { targetType: 'task', description: 'Existing default' },
        },
      ])
      .returning();
    const [role] = await schema.db
      .insert(schema.role)
      .values({ organizationId: orgId, key: 'member', name: 'Member', capabilities: ['view'] })
      .returning();
    await schema.db.insert(schema.invitation).values(
      ['pending', 'accepted'].map((status) => ({
        organizationId: orgId,
        roleId: assertDefined(role).id,
        email: 'invite@example.com',
        invitedBy: humanActorId,
        personActorId: sourceId,
        token: `${sourceId}-${status}`,
        status: status as 'pending' | 'accepted',
        expiresAt: new Date(Date.now() + 60000),
      })),
    );
    const preview = await previewPersonConsolidation(orgId, sourceId, humanActorId);
    await consolidatePeople(orgId, sourceId, humanActorId, {
      mergedBy: humanActorId,
      previewRevision: preview.previewRevision,
    });
    const memberships = await schema.db
      .select()
      .from(schema.projectMember)
      .where(eq(schema.projectMember.projectId, projectId));
    expect(memberships.map((row) => row.actorId)).toEqual([humanActorId]);
    for (const template of templates) {
      const [updated] = await schema.db
        .select()
        .from(schema.template)
        .where(eq(schema.template.id, template.id));
      expect(updated).toMatchObject({
        ownerActorId: humanActorId,
        payload: template.payload,
      });
    }
    const invitations = await schema.db
      .select()
      .from(schema.invitation)
      .where(eq(schema.invitation.organizationId, orgId));
    expect(invitations.find((row) => row.status === 'pending')?.personActorId).toBe(humanActorId);
    expect(invitations.find((row) => row.status === 'accepted')?.personActorId).toBe(sourceId);
  });
});
