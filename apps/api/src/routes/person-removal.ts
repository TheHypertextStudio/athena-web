import { actor, db, grant, invitation, projectMember, role, teamMember } from '@docket/db';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { lastOwnerGuard, LastOwnerError } from '@docket/authz';
import { ConflictError, NotFoundError } from '../error';

/**
 * Revoke workspace access while preserving person IDs used by work and identity history.
 * @throws {NotFoundError} When the active workspace person does not exist.
 * @throws {ConflictError} When removal would leave no account-backed owner.
 */
export async function archiveWorkspacePerson(
  orgId: string,
  actorId: string,
): Promise<{ id: string }> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`people:${orgId}`}, 0))`);
    const [target] = await tx
      .select({ userId: actor.userId, status: actor.status, roleKey: role.key })
      .from(actor)
      .leftJoin(role, eq(role.id, actor.roleId))
      .where(and(eq(actor.id, actorId), eq(actor.organizationId, orgId)));
    if (target?.userId && target.status === 'active' && target.roleKey === 'owner') {
      try {
        await lastOwnerGuard(tx, orgId, actorId);
      } catch (error) {
        if (error instanceof LastOwnerError) throw new ConflictError(error.message);
        throw error;
      }
    }
    const [removed] = await tx
      .update(actor)
      .set({ userId: null, roleId: null, status: 'suspended', archivedAt: new Date() })
      .where(
        and(
          eq(actor.organizationId, orgId),
          eq(actor.id, actorId),
          eq(actor.kind, 'human'),
          isNull(actor.archivedAt),
        ),
      )
      .returning({ id: actor.id });
    if (!removed) throw new NotFoundError('Member not found');
    await tx
      .delete(grant)
      .where(
        and(
          eq(grant.organizationId, orgId),
          eq(grant.subjectKind, 'actor'),
          eq(grant.subjectId, actorId),
        ),
      );
    await tx
      .delete(teamMember)
      .where(and(eq(teamMember.organizationId, orgId), eq(teamMember.actorId, actorId)));
    await tx
      .delete(projectMember)
      .where(and(eq(projectMember.organizationId, orgId), eq(projectMember.actorId, actorId)));
    await tx
      .update(invitation)
      .set({ status: 'revoked' })
      .where(
        and(
          eq(invitation.organizationId, orgId),
          eq(invitation.personActorId, actorId),
          eq(invitation.status, 'pending'),
        ),
      );
    return removed;
  });
}
