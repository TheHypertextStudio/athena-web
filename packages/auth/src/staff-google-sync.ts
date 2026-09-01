/**
 * `@docket/auth` — projecting Google Workspace group membership onto `staff_user` rows.
 *
 * @remarks
 * Operator access is decided by the `staff_user` table and nothing else: `staffMiddleware` reads
 * that row on every `/admin` request and never consults a directory. This module is the only
 * writer that acts on Google's behalf, and it runs in exactly two places — once when an operator
 * signs in with Google, and periodically from the staff-sync cron. Keeping the directory off the
 * request path is deliberate: a per-request lookup would let any signed-in non-operator drive
 * traffic to Cloud Identity just by polling `/admin`.
 *
 * Because sessions last 30 days, **the cron is what makes revocation real** — removing someone
 * from a group would otherwise not lock them out until their session expired.
 */
import type { Database, fullSchema } from '@docket/db';
import {
  account,
  genId,
  operatorAuditEvent,
  user,
  parseStaffTargets,
  roleForIdentifier,
  staffRank,
  staffUser,
  type StaffRole,
  type StaffTarget,
} from '@docket/db';
import { and, eq, ne } from 'drizzle-orm';
import type { PgliteDatabase } from 'drizzle-orm/pglite';

import type { GoogleDirectoryPort } from './google-directory';

/** Better Auth's provider id for Google accounts. */
const GOOGLE_PROVIDER_ID = 'google';

/** Drizzle client shape the sync accepts — the real client, or a PGlite client under test. */
type Db = Database | PgliteDatabase<typeof fullSchema>;

/** How a staff grant is provisioned; only `google_group` rows are the sync's to change. */
const GOOGLE_MANAGED = 'google_group' as const;

/** What one account's sync did, for logging and for the cron's summary. */
export type StaffSyncOutcome =
  | { status: 'granted'; role: StaffRole }
  | { status: 'updated'; role: StaffRole; previousRole: StaffRole }
  | { status: 'unchanged'; role: StaffRole }
  | { status: 'revoked'; previousRole: StaffRole }
  | { status: 'not-operator' }
  | { status: 'manual'; role: StaffRole }
  | { status: 'kept-last-superadmin'; role: StaffRole };

/** Inputs shared by every sync entry point. */
export interface StaffSyncConfig {
  /** The raw `ADMIN_GOOGLE_GROUP_ROLES` value: `group-email:role` pairs, comma separated. */
  readonly groupRoles: string | undefined;
  /** The Workspace domain operator accounts must belong to, when one is configured. */
  readonly workspaceDomain?: string | undefined;
  /**
   * Pre-parsed `groupRoles`, so a sweep parses the CSV once rather than once per operator.
   * Only ever a usable mapping: a caller that cannot parse one declines to sync at all.
   */
  readonly targets?: readonly StaffTarget[] | undefined;
}

/**
 * The highest tier any of `groups` maps to, or null when none of them grants operator access.
 *
 * @remarks
 * "Highest wins" so adding someone to a broader group can never quietly demote them out of a
 * narrower one. Ranking is shared with the API's tier cascade via `staffRank`.
 */
export function highestRoleForGroups(
  targets: readonly StaffTarget[],
  groups: readonly string[],
): StaffRole | null {
  let best: StaffRole | null = null;
  for (const group of groups) {
    const role = roleForIdentifier(targets, group);
    if (role && (best === null || staffRank(role) > staffRank(best))) best = role;
  }
  return best;
}

/**
 * Whether `email` belongs to `domain`.
 *
 * @remarks
 * An absent domain answers false, not true. This is an authorization input, so "nothing
 * configured" has to mean "nothing qualifies" — the permissive reading would silently drop the
 * confinement the moment `GOOGLE_WORKSPACE_DOMAIN` went missing, and let every consumer Google
 * account reach the directory lookup.
 */
export function isWorkspaceEmail(email: string, domain: string | undefined): boolean {
  const suffix = domain?.trim().toLowerCase();
  if (!suffix) return false;
  return email.trim().toLowerCase().endsWith(`@${suffix}`);
}

/**
 * Parse the group mapping, or null when it cannot be trusted.
 *
 * @remarks
 * Null covers both an unusable value and an absent one, and callers decline to decide rather
 * than revoking. Treating "no groups configured" as "nobody is in a group" would mean clearing
 * the variable mid-edit silently revokes every group-managed operator on the next sweep — a
 * far likelier accident than a deliberate mass revocation, and one with no other signal.
 */
function parseGroupRoles(raw: string | undefined): StaffTarget[] | null {
  if (!raw?.trim()) return null;
  try {
    const targets = parseStaffTargets(raw);
    return targets.length > 0 ? targets : null;
  } catch (error) {
    console.error('Invalid ADMIN_GOOGLE_GROUP_ROLES — leaving operator access unchanged:', error);
    return null;
  }
}

/**
 * Whether `userId` has a linked Google account.
 *
 * @remarks
 * Better Auth stores Google's opaque `sub` in `account.account_id`, not the address, and no
 * column anywhere holds the Google mailbox. So the sync matches groups against the Docket
 * account's own `user.email`, and this check is what keeps that sound: without a linked Google
 * account, an address alone can never reach a group grant. The address itself is trustworthy
 * because every Docket account proves its mailbox — Google verifies it on OAuth sign-up, and the
 * passkey sign-up challenge emails a code — so `user.email` is a verified identity either way.
 */
async function hasGoogleAccount(db: Db, userId: string): Promise<boolean> {
  const rows = await db
    .select({ id: account.id })
    .from(account)
    .where(and(eq(account.userId, userId), eq(account.providerId, GOOGLE_PROVIDER_ID)))
    .limit(1);
  return rows.length > 0;
}

/** The Docket account email for `userId`, lowercased, or null when the user is gone. */
async function emailFor(db: Db, userId: string): Promise<string | null> {
  const rows = await db
    .select({ email: user.email })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  const email = rows[0]?.email;
  return email ? email.trim().toLowerCase() : null;
}

/** Record what the sync did, attributed to the system rather than to an acting operator. */
async function recordAudit(
  db: Db,
  type: string,
  subjectId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await db.insert(operatorAuditEvent).values({
    staffUserId: null,
    type,
    subjectType: 'staff_user',
    subjectId,
    metadata,
  });
}

/** Whether a `superadmin` other than `excludingId` exists. */
async function anotherSuperadminExists(db: Db, excludingId: string): Promise<boolean> {
  const rows = await db
    .select({ id: staffUser.id })
    .from(staffUser)
    .where(and(eq(staffUser.role, 'superadmin'), ne(staffUser.id, excludingId)))
    .limit(1);
  return rows.length > 0;
}

/** An existing group-manageable operator row. */
interface ExistingStaff {
  readonly id: string;
  readonly role: StaffRole;
  readonly managedBy: string;
}

/** The `staff_user` row for `userId`, or undefined when the account is not an operator. */
async function existingStaffFor(db: Db, userId: string): Promise<ExistingStaff | undefined> {
  const rows = await db
    .select({ id: staffUser.id, role: staffUser.role, managedBy: staffUser.managedBy })
    .from(staffUser)
    .where(eq(staffUser.userId, userId))
    .limit(1);
  return rows[0];
}

/**
 * The tier `userId`'s Workspace groups grant, or null for none.
 *
 * @remarks
 * Every ineligibility — no Docket email, outside the Workspace domain, no linked Google account,
 * no matching group — collapses to the same null. That is deliberate: the caller must not be able
 * to distinguish "not eligible" from "eligible but in no group", because both mean the same thing
 * for access. A *failed lookup* is the one case that is different, and it throws instead.
 */
async function desiredRoleFor(
  db: Db,
  directory: GoogleDirectoryPort,
  userId: string,
  targets: readonly StaffTarget[],
  config: StaffSyncConfig,
): Promise<StaffRole | null> {
  // `parseGroupRoles` already rejected an empty mapping, so `targets` is non-empty here and a
  // lookup can actually change the answer. This runs inline on the OAuth callback path, so the
  // cheap refusals come first.
  if (!config.workspaceDomain?.trim()) {
    console.error(
      'GOOGLE_WORKSPACE_DOMAIN is not set — operator SSO grants nothing until it is configured.',
    );
    return null;
  }
  const email = await emailFor(db, userId);
  if (!email || !isWorkspaceEmail(email, config.workspaceDomain)) return null;
  if (!(await hasGoogleAccount(db, userId))) return null;
  return highestRoleForGroups(targets, await directory.groupsFor(email));
}

/** Whether removing or demoting `existing` would leave the console with no superadmin. */
async function isLastSuperadmin(db: Db, existing: ExistingStaff): Promise<boolean> {
  if (existing.role !== 'superadmin') return false;
  // Manual rows count here on purpose: a break-glass superadmin is exactly what makes revoking
  // a group-managed one safe.
  return !(await anotherSuperadminExists(db, existing.id));
}

/** Drop an operator whose group membership has gone. */
async function revokeStaff(
  db: Db,
  existing: ExistingStaff,
  userId: string,
): Promise<StaffSyncOutcome> {
  if (await isLastSuperadmin(db, existing)) {
    return { status: 'kept-last-superadmin', role: existing.role };
  }
  await db.delete(staffUser).where(eq(staffUser.id, existing.id));
  await recordAudit(db, 'staff.revoked', existing.id, {
    source: GOOGLE_MANAGED,
    targetUserId: userId,
    role: existing.role,
  });
  return { status: 'revoked', previousRole: existing.role };
}

/** Add a new group-managed operator. */
async function grantStaff(db: Db, userId: string, role: StaffRole): Promise<StaffSyncOutcome> {
  // Mint the id here rather than reading it back off `.returning()`: the audit row needs it, and
  // generating it up front removes an unreachable "insert returned nothing" branch. The column's
  // own default is the same `genId`.
  const id = genId();
  await db
    .insert(staffUser)
    .values({ id, userId, role, managedBy: GOOGLE_MANAGED, groupsSyncedAt: new Date() });
  await recordAudit(db, 'staff.granted', id, {
    source: GOOGLE_MANAGED,
    targetUserId: userId,
    role,
  });
  return { status: 'granted', role };
}

/** Move an existing group-managed operator to the tier their groups now say. */
async function retierStaff(
  db: Db,
  existing: ExistingStaff,
  userId: string,
  desired: StaffRole,
): Promise<StaffSyncOutcome> {
  if (existing.role === desired) {
    await db
      .update(staffUser)
      .set({ groupsSyncedAt: new Date() })
      .where(eq(staffUser.id, existing.id));
    return { status: 'unchanged', role: desired };
  }
  const demoting = staffRank(desired) < staffRank(existing.role);
  if (demoting && (await isLastSuperadmin(db, existing))) {
    return { status: 'kept-last-superadmin', role: existing.role };
  }
  await db
    .update(staffUser)
    .set({ role: desired, groupsSyncedAt: new Date() })
    .where(eq(staffUser.id, existing.id));
  await recordAudit(db, 'staff.role_synced', existing.id, {
    source: GOOGLE_MANAGED,
    targetUserId: userId,
    role: desired,
    previousRole: existing.role,
  });
  return { status: 'updated', role: desired, previousRole: existing.role };
}

/**
 * Reconcile one account's `staff_user` row against its Google Group membership.
 *
 * @remarks
 * Four rules make this safe to run unattended:
 *
 * 1. **A failed lookup never revokes.** `directory.groupsFor` throwing propagates to the caller
 *    with the row untouched, so a Cloud Identity outage cannot lock every operator out. A
 *    malformed group mapping is treated the same way, for the same reason.
 * 2. **Manually granted rows are never touched.** A `managed_by = 'manual'` row is the break-glass
 *    path — it is what gets you back in when the Workspace configuration itself is what broke.
 * 3. **The last superadmin is never revoked or demoted.** A mis-typed group address would
 *    otherwise leave the console with nobody who can fix it.
 * 4. **An account with no Google link, or one outside the Workspace domain, is a no-op** rather
 *    than an error: it simply has no groups to match.
 *
 * @param db - The Drizzle client.
 * @param directory - The group-membership port.
 * @param input - The user to reconcile and the configured mapping.
 * @returns what changed, for the caller to log.
 * @throws whatever `directory.groupsFor` throws — deliberately not swallowed here, so callers
 * choose between "abandon this sign-in's sync" and "abort the cron sweep".
 */
export async function syncStaffFromGoogle(
  db: Db,
  directory: GoogleDirectoryPort,
  input: { userId: string; config: StaffSyncConfig; existing?: ExistingStaff | undefined },
): Promise<StaffSyncOutcome> {
  const { userId, config } = input;
  const existing = input.existing ?? (await existingStaffFor(db, userId));
  if (existing && existing.managedBy !== GOOGLE_MANAGED) {
    return { status: 'manual', role: existing.role };
  }

  const targets = config.targets ?? parseGroupRoles(config.groupRoles);
  if (targets === null) {
    return existing ? { status: 'unchanged', role: existing.role } : { status: 'not-operator' };
  }

  const desired = await desiredRoleFor(db, directory, userId, targets, config);
  if (!desired) {
    return existing ? await revokeStaff(db, existing, userId) : { status: 'not-operator' };
  }
  return existing
    ? await retierStaff(db, existing, userId, desired)
    : await grantStaff(db, userId, desired);
}

/** What one cron sweep did. */
export interface StaffSyncSweep {
  /** Rows examined (every `managed_by = 'google_group'` operator). */
  readonly examined: number;
  /** Rows whose tier changed or which were revoked. */
  readonly changed: number;
  /** Rows skipped because their directory lookup failed — deliberately left as they were. */
  readonly failed: number;
}

/**
 * Re-reconcile every group-managed operator, revoking those whose membership has gone.
 *
 * @remarks
 * Bounded work: it walks `staff_user`, which holds one row per operator, not per user. A row
 * whose lookup fails is counted in `failed` and left exactly as it was — one unreachable
 * directory must not cascade into revoking everyone.
 *
 * @param db - The Drizzle client.
 * @param directory - The group-membership port.
 * @param config - The configured group mapping.
 * @returns a {@link StaffSyncSweep} summary.
 */
export async function syncAllStaff(
  db: Db,
  directory: GoogleDirectoryPort,
  config: StaffSyncConfig,
): Promise<StaffSyncSweep> {
  const rows = await db
    .select({
      id: staffUser.id,
      userId: staffUser.userId,
      role: staffUser.role,
      managedBy: staffUser.managedBy,
    })
    .from(staffUser)
    .where(eq(staffUser.managedBy, GOOGLE_MANAGED));

  // Parse the mapping once for the whole sweep rather than once per operator, and treat an
  // untrustworthy one as "change nothing" — the same rule a failed lookup gets.
  const targets = parseGroupRoles(config.groupRoles);
  if (targets === null) return { examined: rows.length, changed: 0, failed: 0 };

  let changed = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      const outcome = await syncStaffFromGoogle(db, directory, {
        userId: row.userId,
        config: { ...config, targets },
        existing: row,
      });
      if (outcome.status === 'updated' || outcome.status === 'revoked') changed += 1;
    } catch (error) {
      failed += 1;
      console.error(`Google group sync failed for staff user ${row.userId}:`, error);
    }
  }
  return { examined: rows.length, changed, failed };
}

/**
 * Reconcile the account that just signed in with Google, never failing the sign-in.
 *
 * @remarks
 * Called from the auth `after` hook, which has no error boundary of its own — a throw here
 * would surface as a broken OAuth callback rather than as a missing grant. So every failure is
 * logged and swallowed: the worst case is that the operator sees the console's "not an operator"
 * state and signs in again once the directory recovers.
 */
export async function syncStaffOnSignIn(
  db: Db,
  directory: GoogleDirectoryPort,
  input: { userId: string; config: StaffSyncConfig },
): Promise<StaffSyncOutcome | null> {
  try {
    return await syncStaffFromGoogle(db, directory, input);
  } catch (error) {
    console.error('Google group sync failed during sign-in — operator access unchanged:', error);
    return null;
  }
}
