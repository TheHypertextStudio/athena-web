/**
 * `@docket/db` — the staff-bootstrap seed primitive.
 *
 * @remarks
 * The operator console (`/v1/admin/*`) is gated on the caller resolving to a `staff_user`
 * row, and the only API that mints staff (`POST /v1/admin/staff`) itself requires being a
 * superadmin. That chicken-and-egg means the **first** operator must be granted out of band.
 * {@link grantStaffByEmail} is that out-of-band primitive: keyed by email so a human can name
 * an account without knowing its generated id, idempotent so it is safe to re-run, and pure
 * data access so it works against any `DATABASE_URL` (embedded PGlite or a real Neon URL).
 *
 * The `scripts/seed-staff.ts` CLI wraps this with argument/env/interactive resolution; tests
 * exercise this function directly. Keeping the logic here (not in the script) makes it
 * testable and reusable.
 */
import { eq } from 'drizzle-orm';

import type { Database } from './client';
import { staffRole } from './enums';
import { staffUser, user } from './schema';

/** The staff tiers, in ascending privilege rank (support → finance → superadmin). */
export const STAFF_ROLES = staffRole.enumValues;

/** A Docket service-operator tier. */
export type StaffRole = (typeof STAFF_ROLES)[number];

/** The tier granted when a bootstrap target omits an explicit `:role`. */
export const DEFAULT_STAFF_ROLE: StaffRole = 'superadmin';

/** Whether an arbitrary string is one of the {@link STAFF_ROLES}. */
export function isStaffRole(value: string): value is StaffRole {
  return (STAFF_ROLES as readonly string[]).includes(value);
}

/** A bootstrap target: an account email and the tier to grant it. */
export interface StaffTarget {
  /** The account email. */
  readonly email: string;
  /** The tier to grant. */
  readonly role: StaffRole;
}

/**
 * Parse a single `email[:role]` token into a {@link StaffTarget}.
 *
 * @remarks
 * Strict: an unrecognized role throws (so a mistyped CLI argument is reported rather than
 * silently ignored). An omitted role defaults to {@link DEFAULT_STAFF_ROLE}. Emails never
 * contain `:`, so the last `:` separates the role.
 *
 * @throws {Error} when the role segment is not one of {@link STAFF_ROLES}.
 */
export function parseStaffTarget(token: string): StaffTarget {
  const trimmed = token.trim();
  const sep = trimmed.lastIndexOf(':');
  if (sep === -1) return { email: trimmed, role: DEFAULT_STAFF_ROLE };
  const email = trimmed.slice(0, sep);
  const role = trimmed.slice(sep + 1);
  if (!isStaffRole(role)) {
    throw new Error(
      `Invalid staff role "${role}" for ${email} — expected one of ${STAFF_ROLES.join(', ')}.`,
    );
  }
  return { email, role };
}

/**
 * Parse a comma-separated `email[:role]` allowlist into {@link StaffTarget}s.
 *
 * @remarks
 * Blank entries are skipped; a malformed role throws via {@link parseStaffTarget}. Used for
 * the `STAFF_BOOTSTRAP_EMAILS` env value (by both the seed CLI and the staff guard).
 */
export function parseStaffTargets(raw: string): StaffTarget[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(parseStaffTarget);
}

/** The tier configured for `email` in `targets` (case-insensitive), or null if absent. */
export function roleForEmail(targets: readonly StaffTarget[], email: string): StaffRole | null {
  const normalized = email.trim().toLowerCase();
  return targets.find((t) => t.email.trim().toLowerCase() === normalized)?.role ?? null;
}

/**
 * Resolve the tier to auto-grant `email` under the dev bootstrap policy, or null to deny.
 *
 * @remarks
 * The pure decision behind the API's dev auto-grant: deny outright when `appMode` is
 * `production` (the allowlist is a local-dev convenience only) or when nothing is configured,
 * otherwise return the listed tier for `email`. Kept pure (no env/db access) so the policy is
 * unit-testable; the guard supplies `appMode`/`bootstrapEmails` and performs the actual grant.
 *
 * @throws {Error} when `bootstrapEmails` contains a malformed role (surfaced by the caller).
 */
export function bootstrapRoleFor(
  email: string,
  opts: { appMode: string; bootstrapEmails: string | undefined },
): StaffRole | null {
  if (opts.appMode === 'production' || !opts.bootstrapEmails) return null;
  return roleForEmail(parseStaffTargets(opts.bootstrapEmails), email);
}

/** Options for {@link grantStaffByEmail}. */
export interface GrantStaffOptions {
  /** The account email to grant operator access to (matched case-insensitively). */
  readonly email: string;
  /** The staff tier to grant. */
  readonly role: StaffRole;
}

/**
 * The outcome of a {@link grantStaffByEmail} call.
 *
 * @remarks
 * A discriminated union so callers can report precisely what happened without re-querying:
 * a brand-new grant, an idempotent no-op, an in-place tier change, or a missing account
 * (the caller has not signed in yet, so there is no `user` row to key the staff record to).
 */
export type GrantStaffResult =
  | { status: 'granted'; staffUserId: string; userId: string; role: StaffRole }
  | { status: 'unchanged'; staffUserId: string; userId: string; role: StaffRole }
  | {
      status: 'updated';
      staffUserId: string;
      userId: string;
      role: StaffRole;
      previousRole: StaffRole;
    }
  | { status: 'no-user'; email: string };

/**
 * Grant (or update) operator access for the account with the given email.
 *
 * @remarks
 * Idempotent: a first call inserts a `staff_user` row (`granted`); a repeat with the same
 * role is a no-op (`unchanged`); a repeat with a different role updates the tier in place
 * (`updated`, reporting the prior tier). When no account matches the email it returns
 * `no-user` rather than throwing, so a bootstrap run before first sign-in can report a clear
 * next step instead of crashing.
 *
 * @param db - The Drizzle client (any `DATABASE_URL` backend).
 * @param options - See {@link GrantStaffOptions}.
 * @returns the {@link GrantStaffResult} describing what changed.
 *
 * @example
 * ```ts
 * const r = await grantStaffByEmail(db, { email: 'op@docket.dev', role: 'superadmin' });
 * if (r.status === 'no-user') console.log('Sign in once, then re-run.');
 * ```
 */
export async function grantStaffByEmail(
  db: Database,
  { email, role }: GrantStaffOptions,
): Promise<GrantStaffResult> {
  // Better Auth stores emails normalized to lowercase, so lowercasing the input and a plain
  // equality match is case-insensitive without a `lower(email)` SQL expression (which the
  // on-disk PGlite WASM build aborts on).
  const normalized = email.trim().toLowerCase();
  const account = (
    await db.select({ id: user.id }).from(user).where(eq(user.email, normalized)).limit(1)
  )[0];
  if (!account) return { status: 'no-user', email };

  const existing = (
    await db
      .select({ id: staffUser.id, role: staffUser.role })
      .from(staffUser)
      .where(eq(staffUser.userId, account.id))
      .limit(1)
  )[0];

  if (!existing) {
    const inserted = (
      await db.insert(staffUser).values({ userId: account.id, role }).returning()
    )[0];
    /* v8 ignore next -- @preserve defensive: insert always returns the inserted row */
    if (!inserted) throw new Error('staff_user insert returned no row');
    return { status: 'granted', staffUserId: inserted.id, userId: account.id, role };
  }

  if (existing.role === role) {
    return { status: 'unchanged', staffUserId: existing.id, userId: account.id, role };
  }

  await db.update(staffUser).set({ role }).where(eq(staffUser.id, existing.id));
  return {
    status: 'updated',
    staffUserId: existing.id,
    userId: account.id,
    role,
    previousRole: existing.role,
  };
}
