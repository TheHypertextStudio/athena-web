import { createHash, randomInt } from 'node:crypto';

import type { Database } from '@docket/db';
import { contactPoint, user as userTable } from '@docket/db';
import type {
  ContactPointCreate,
  ContactPointOut,
  ContactPointVerify,
} from '@docket/notifications';
import { and, desc, eq } from 'drizzle-orm';
import type { z } from 'zod';

import { ConflictError, NotFoundError } from '../../error';

export type ContactPointRow = typeof contactPoint.$inferSelect;

const TEST_VERIFICATION_CODE = '000000';

/** Database-backed service for caller-owned notification contact points. */
export class NotificationContactPointService {
  constructor(private readonly db: Database) {}

  /** Return caller-owned contact points, creating the account email contact point if needed. */
  async list(userId: string): Promise<{ items: z.input<typeof ContactPointOut>[] }> {
    await ensureAccountEmailContactPoint(this.db, userId);
    const rows = await this.db
      .select()
      .from(contactPoint)
      .where(eq(contactPoint.userId, userId))
      .orderBy(desc(contactPoint.createdAt));
    return { items: rows.map(toContactPointOut) };
  }

  /** Create a pending caller-owned contact point. */
  async create(
    userId: string,
    input: z.input<typeof ContactPointCreate>,
  ): Promise<z.input<typeof ContactPointOut>> {
    const normalized = normalizeContactPointValue(input.type, input.value);
    const existing = await findContactPointByNormalizedValue(
      this.db,
      userId,
      input.type,
      normalized,
    );
    if (existing) throw new ConflictError('Contact point already exists');

    const [created] = await this.db
      .insert(contactPoint)
      .values({
        userId,
        type: input.type,
        value: input.value.trim(),
        valueNormalized: normalized,
        valueMasked: maskContactPointValue(input.type, normalized),
        status: 'pending',
        primary: false,
        verificationCodeHash: verificationCodeHash(issueVerificationCode()),
      })
      .returning();
    if (!created) throw new Error('Failed to create contact point');
    return toContactPointOut(created);
  }

  /** Verify a pending caller-owned contact point. */
  async verify(
    userId: string,
    id: string,
    input: z.input<typeof ContactPointVerify>,
  ): Promise<z.input<typeof ContactPointOut>> {
    const row = await this.requireOwned(id, userId);
    if (row.status !== 'pending') throw new ConflictError('Contact point is not pending');
    if (row.verificationCodeHash !== verificationCodeHash(input.code)) {
      throw new ConflictError('Invalid verification code');
    }

    const hasPrimary = await this.hasPrimary(row.userId, row.type);
    const [updated] = await this.db
      .update(contactPoint)
      .set({
        status: 'active',
        primary: !hasPrimary,
        verifiedAt: new Date(),
        verificationCodeHash: null,
      })
      .where(and(eq(contactPoint.id, id), eq(contactPoint.userId, userId)))
      .returning();
    if (!updated) throw new NotFoundError('Contact point not found');
    return toContactPointOut(updated);
  }

  /** Make one active caller-owned contact point primary within its destination type. */
  async makePrimary(userId: string, id: string): Promise<z.input<typeof ContactPointOut>> {
    const row = await this.requireOwned(id, userId);
    if (row.status !== 'active' || !row.verifiedAt) {
      throw new ConflictError('Only active verified contact points can be primary');
    }

    await this.db
      .update(contactPoint)
      .set({ primary: false })
      .where(and(eq(contactPoint.userId, userId), eq(contactPoint.type, row.type)));
    const [updated] = await this.db
      .update(contactPoint)
      .set({ primary: true })
      .where(and(eq(contactPoint.id, id), eq(contactPoint.userId, userId)))
      .returning();
    if (!updated) throw new NotFoundError('Contact point not found');
    return toContactPointOut(updated);
  }

  /** Disable one caller-owned contact point. */
  async disable(userId: string, id: string): Promise<z.input<typeof ContactPointOut>> {
    await this.requireOwned(id, userId);
    const [updated] = await this.db
      .update(contactPoint)
      .set({ status: 'disabled', primary: false, disabledAt: new Date() })
      .where(and(eq(contactPoint.id, id), eq(contactPoint.userId, userId)))
      .returning();
    if (!updated) throw new NotFoundError('Contact point not found');
    return toContactPointOut(updated);
  }

  private async requireOwned(id: string, userId: string): Promise<ContactPointRow> {
    const [row] = await this.db
      .select()
      .from(contactPoint)
      .where(and(eq(contactPoint.id, id), eq(contactPoint.userId, userId)))
      .limit(1);
    if (!row) throw new NotFoundError('Contact point not found');
    return row;
  }

  private async hasPrimary(userId: string, type: ContactPointRow['type']): Promise<boolean> {
    const [row] = await this.db
      .select({ id: contactPoint.id })
      .from(contactPoint)
      .where(
        and(
          eq(contactPoint.userId, userId),
          eq(contactPoint.type, type),
          eq(contactPoint.primary, true),
        ),
      )
      .limit(1);
    return Boolean(row);
  }
}

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
  if (!account) throw new NotFoundError('User not found');
  return account.email;
}

async function findContactPointByNormalizedValue(
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

function toContactPointOut(row: ContactPointRow): z.input<typeof ContactPointOut> {
  return {
    id: row.id,
    userId: row.userId,
    type: row.type,
    valueMasked: row.valueMasked,
    status: row.status,
    primary: row.primary,
    verifiedAt: row.verifiedAt?.toISOString() ?? null,
    disabledAt: row.disabledAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function normalizeContactPointValue(type: ContactPointRow['type'], value: string): string {
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

function maskContactPointValue(type: ContactPointRow['type'], value: string): string {
  if (type === 'email') {
    const [local = '', domain = ''] = value.split('@');
    return `${local.slice(0, 1) || '*'}***@${domain}`;
  }
  if (type === 'phone') {
    return `${value.startsWith('+') ? '+' : ''}*******${value.slice(-4)}`;
  }
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function issueVerificationCode(): string {
  if (process.env['NODE_ENV'] === 'test') return TEST_VERIFICATION_CODE;
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

function verificationCodeHash(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}
