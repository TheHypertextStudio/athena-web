/**
 * `@docket/api` — account-deletion ownership analysis.
 *
 * @remarks
 * Before an account can be deleted, every organization the user belongs to must be safe to
 * leave behind. Two outcomes are derived from the same membership scan:
 *
 * - **Blockers** — shared (non-personal) orgs where the user is the *only* active owner and
 *   other members remain. Deleting the user would orphan such an org (the `actor.userId`
 *   cascade silently removes their membership, bypassing the org's last-owner guard), so the
 *   user must transfer ownership or delete the org first. Surfaced in the Danger zone and
 *   re-checked at purge time so a late-arriving conflict never orphans an org.
 * - **Sole-occupied orgs** — orgs whose only human member is this user (their personal
 *   workspace, plus any shared org nobody else joined). These are purged with the account,
 *   since no other user depends on them.
 */
import type { Database } from '@docket/db';
import { actor, organization, role } from '@docket/db';
import type { OwnershipBlocker } from '@docket/types';
import { and, eq, inArray } from 'drizzle-orm';

/** One human membership row, enriched with its org + role context. */
interface MembershipRow {
  readonly organizationId: string;
  readonly orgName: string;
  readonly isPersonal: boolean;
  readonly userId: string | null;
  readonly status: (typeof actor.$inferSelect)['status'];
  readonly roleKey: string | null;
}

/** A per-org summary of its human membership, for blocker / sole-occupied analysis. */
interface OrgMembership {
  readonly organizationId: string;
  readonly orgName: string;
  readonly isPersonal: boolean;
  readonly members: readonly MembershipRow[];
}

/** The deletion-relevant ownership facts for a user, from one membership scan. */
export interface OwnershipAnalysis {
  /** Shared orgs the user solely owns that block deletion until resolved. */
  readonly blockers: OwnershipBlocker[];
  /** Orgs whose only human member is this user — purged with the account. */
  readonly soleOccupiedOrgIds: string[];
}

/** Whether a membership row is an active owner of its org. */
function isActiveOwner(m: MembershipRow): boolean {
  return m.status === 'active' && m.roleKey === 'owner';
}

/**
 * Scan every org the user is a human member of, grouped with its full human membership.
 *
 * @param db - The database client.
 * @param userId - The Better Auth user whose memberships to analyze.
 * @returns one entry per org the user belongs to, each carrying all its human members.
 */
async function loadMemberships(db: Database, userId: string): Promise<OrgMembership[]> {
  const owned = await db
    .selectDistinct({ organizationId: actor.organizationId })
    .from(actor)
    .where(and(eq(actor.userId, userId), eq(actor.kind, 'human')));
  const orgIds = owned.map((r) => r.organizationId);
  if (orgIds.length === 0) return [];

  const rows = await db
    .select({
      organizationId: actor.organizationId,
      orgName: organization.name,
      isPersonal: organization.isPersonal,
      userId: actor.userId,
      status: actor.status,
      roleKey: role.key,
    })
    .from(actor)
    .innerJoin(organization, eq(organization.id, actor.organizationId))
    .leftJoin(role, eq(role.id, actor.roleId))
    .where(and(inArray(actor.organizationId, orgIds), eq(actor.kind, 'human')));

  const byOrg = new Map<string, MembershipRow[]>();
  for (const r of rows) {
    const list = byOrg.get(r.organizationId);
    if (list) list.push(r);
    else byOrg.set(r.organizationId, [r]);
  }
  const out: OrgMembership[] = [];
  for (const members of byOrg.values()) {
    const first = members[0];
    if (!first) continue; // every group has ≥1 member by construction; satisfies the type
    out.push({
      organizationId: first.organizationId,
      orgName: first.orgName,
      isPersonal: first.isPersonal,
      members,
    });
  }
  return out;
}

/**
 * Classify every org the user belongs to into deletion blockers + sole-occupied orgs.
 *
 * @remarks
 * One membership scan answers both questions the deletion flow needs:
 * - A **sole-occupied** org (its only human member is the user — their personal workspace, or
 *   a shared org nobody else joined) is purged with the account.
 * - A **blocker** is a non-personal org with other members where the user is the only active
 *   owner; deletion is refused until it is transferred or deleted.
 *
 * @param db - The database client.
 * @param userId - The user attempting deletion.
 * @returns the blockers + sole-occupied org ids.
 */
export async function analyzeAccountOwnership(
  db: Database,
  userId: string,
): Promise<OwnershipAnalysis> {
  const memberships = await loadMemberships(db, userId);
  const blockers: OwnershipBlocker[] = [];
  const soleOccupiedOrgIds: string[] = [];
  for (const org of memberships) {
    // Sole-occupied: the user is the only human in the org (covers their personal workspace).
    if (org.members.length === 1) {
      soleOccupiedOrgIds.push(org.organizationId);
      continue;
    }
    if (org.isPersonal) continue;
    const userRow = org.members.find((m) => m.userId === userId);
    if (!userRow || !isActiveOwner(userRow)) continue;
    const otherActiveOwners = org.members.filter((m) => m.userId !== userId && isActiveOwner(m));
    if (otherActiveOwners.length === 0) {
      blockers.push({
        organizationId: org.organizationId,
        name: org.orgName,
        memberCount: org.members.length,
      });
    }
  }
  return { blockers, soleOccupiedOrgIds };
}

/**
 * Find the shared orgs that block this user's account deletion.
 *
 * @param db - The database client.
 * @param userId - The user attempting deletion.
 * @returns the blocking orgs (empty when deletion is safe).
 */
export async function findOwnershipBlockers(
  db: Database,
  userId: string,
): Promise<OwnershipBlocker[]> {
  return (await analyzeAccountOwnership(db, userId)).blockers;
}

/**
 * Find the orgs whose only human member is this user (purged with the account).
 *
 * @param db - The database client.
 * @param userId - The user being purged.
 * @returns the ids of orgs to delete alongside the account.
 */
export async function findSoleOccupiedOrgIds(db: Database, userId: string): Promise<string[]> {
  return (await analyzeAccountOwnership(db, userId)).soleOccupiedOrgIds;
}
