import type { Database } from '@docket/db';
import { contactPoint, user as userTable } from '@docket/db';
import { and, eq } from 'drizzle-orm';

/** Persisted notification contact destination row. */
export type ContactPointRow = typeof contactPoint.$inferSelect;

/**
 * Ensure the user's account email exists as a contact point.
 *
 * @remarks
 * Routes that already have an authenticated account email can pass it directly; ordinary contact
 * point reads fall back to the persisted user email. New rows are active and verified; existing
 * rows are preserved so bounced/unsubscribed states still suppress delivery through the preference
 * resolver.
 */
export async function ensureAccountEmailContactPoint(
  db: Database,
  userId: string,
  email?: string,
): Promise<ContactPointRow> {
  const accountEmail = await resolveAccountEmail(db, userId, email);
  const normalized = normalizeContactPointValue('email', accountEmail);
  const existing = await findContactPointByNormalizedValue(db, userId, 'email', normalized);
  if (existing) return existing;

  await db
    .update(contactPoint)
    .set({ primary: false })
    .where(and(eq(contactPoint.userId, userId), eq(contactPoint.type, 'email')));
  const [created] = await db
    .insert(contactPoint)
    .values({
      userId,
      type: 'email',
      value: accountEmail,
      valueNormalized: normalized,
      valueMasked: maskContactPointValue('email', normalized),
      status: 'active',
      primary: true,
      verifiedAt: new Date(),
    })
    .returning();
  /* v8 ignore next -- @preserve defensive: insert always returns the inserted row */
  if (!created) throw new Error('Failed to create account email contact point');
  return created;
}

async function resolveAccountEmail(
  db: Database,
  userId: string,
  email: string | undefined,
): Promise<string> {
  const trimmed = email?.trim();
  if (trimmed) return trimmed;

  const [account] = await db
    .select({ id: userTable.id, email: userTable.email })
    .from(userTable)
    .where(eq(userTable.id, userId))
    .limit(1);
  // Defensive only: every caller passes a userId already resolved from a live session/account row.
  if (!account) throw new Error('User not found');
  return account.email;
}

/** Find an existing caller-owned contact point by its normalized value, if any. */
export async function findContactPointByNormalizedValue(
  db: Database,
  userId: string,
  type: ContactPointRow['type'],
  valueNormalized: string,
): Promise<ContactPointRow | undefined> {
  const [row] = await db
    .select()
    .from(contactPoint)
    .where(
      and(
        eq(contactPoint.userId, userId),
        eq(contactPoint.type, type),
        eq(contactPoint.valueNormalized, valueNormalized),
      ),
    )
    .limit(1);
  return row;
}

/** Normalize a contact point value for dedup/lookup (lowercased email, digits-only phone). */
export function normalizeContactPointValue(type: ContactPointRow['type'], value: string): string {
  const trimmed = value.trim();
  if (type === 'email') return trimmed.toLowerCase();
  if (type === 'phone') return normalizePhoneNumber(trimmed);
  return trimmed;
}

function normalizePhoneNumber(value: string): string {
  const hasPlus = value.trim().startsWith('+');
  const digits = value.replace(/\D/g, '');
  return `${hasPlus ? '+' : ''}${digits}`;
}

/** Mask a contact point value for display (never show the full email/phone/token). */
export function maskContactPointValue(type: ContactPointRow['type'], value: string): string {
  if (type === 'email') {
    const [local = '', domain = ''] = value.split('@');
    return `${local.slice(0, 1) || '*'}***@${domain}`;
  }
  if (type === 'phone') {
    return `${value.startsWith('+') ? '+' : ''}*******${value.slice(-4)}`;
  }
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}
