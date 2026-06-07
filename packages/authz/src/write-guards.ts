/**
 * `@docket/authz` — mutation write-guards.
 *
 * @remarks
 * Invariants enforced by member/role/grant mutation endpoints: an org must always
 * retain ≥1 active Owner, and no writer may grant a capability above their own
 * effective rank (no privilege self-escalation).
 */
import { actor as actorTable, type Database, role as roleTable } from '@docket/db';
import { type Capability, CAPABILITY_RANK } from '@docket/types';
import { and, eq, ne } from 'drizzle-orm';

/** Thrown when an operation would leave an org with no active Owner (HTTP 409). */
export class LastOwnerError extends Error {
  constructor(message = 'An organization must retain at least one active owner') {
    super(message);
    this.name = 'LastOwnerError';
  }
}

/** Thrown when a writer attempts to grant beyond their own rank (HTTP 403). */
export class SelfEscalationError extends Error {
  constructor(message = 'Cannot grant a capability above your own') {
    super(message);
    this.name = 'SelfEscalationError';
  }
}

/**
 * Ensure removing/downgrading `targetActorId` still leaves an active Owner.
 *
 * @param db - The database client.
 * @param orgId - The organization id.
 * @param targetActorId - The actor being removed or downgraded.
 * @throws {LastOwnerError} when no other active owner would remain.
 */
export async function lastOwnerGuard(
  db: Database,
  orgId: string,
  targetActorId: string,
): Promise<void> {
  const ownerRoles = await db
    .select({ id: roleTable.id })
    .from(roleTable)
    .where(and(eq(roleTable.organizationId, orgId), eq(roleTable.key, 'owner')))
    .limit(1);
  const ownerRole = ownerRoles[0];
  if (!ownerRole) return;

  const others = await db
    .select({ id: actorTable.id })
    .from(actorTable)
    .where(
      and(
        eq(actorTable.organizationId, orgId),
        eq(actorTable.roleId, ownerRole.id),
        eq(actorTable.status, 'active'),
        ne(actorTable.id, targetActorId),
      ),
    )
    .limit(1);

  if (others.length === 0) throw new LastOwnerError();
}

/**
 * Ensure a writer is not granting above their own effective capability.
 *
 * @param writerCapability - The writer's effective capability.
 * @param grantedCapability - The capability being granted.
 * @throws {SelfEscalationError} when the granted rank exceeds the writer's.
 */
export function noSelfEscalation(
  writerCapability: Capability,
  grantedCapability: Capability,
): void {
  if (CAPABILITY_RANK[grantedCapability] > CAPABILITY_RANK[writerCapability]) {
    throw new SelfEscalationError();
  }
}
