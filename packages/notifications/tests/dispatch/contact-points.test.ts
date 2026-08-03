import type * as DbModule from '@docket/db';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  ensureAccountEmailContactPoint,
  findContactPointByNormalizedValue,
  maskContactPointValue,
  normalizeContactPointValue,
} from '../../src/dispatch/contact-points';
import { getMigratedDb } from '../support/db';
import { seedUser } from '../support/seed';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;

beforeAll(async () => {
  schema = await getMigratedDb();
  db = schema.db;
});

describe('ensureAccountEmailContactPoint', () => {
  it('creates a verified, active, primary email contact point from the account email', async () => {
    const userId = await seedUser(db, schema, 'ContactPointNew');
    const [account] = await db
      .select({ email: schema.user.email })
      .from(schema.user)
      .where(eq(schema.user.id, userId));

    const point = await ensureAccountEmailContactPoint(db, userId);

    expect(point).toMatchObject({
      userId,
      type: 'email',
      value: account?.email,
      valueNormalized: account?.email.toLowerCase(),
      status: 'active',
      primary: true,
    });
    expect(point.verifiedAt).toBeInstanceOf(Date);
  });

  it('is idempotent — a second call returns the existing row rather than inserting again', async () => {
    const userId = await seedUser(db, schema, 'ContactPointIdempotent');

    const first = await ensureAccountEmailContactPoint(db, userId);
    const second = await ensureAccountEmailContactPoint(db, userId);

    expect(second.id).toBe(first.id);
    const rows = await db
      .select()
      .from(schema.contactPoint)
      .where(eq(schema.contactPoint.userId, userId));
    expect(rows).toHaveLength(1);
  });

  it('uses an explicitly supplied email over the account email, trimmed', async () => {
    const userId = await seedUser(db, schema, 'ContactPointExplicit');

    const point = await ensureAccountEmailContactPoint(db, userId, '  explicit@example.test  ');

    expect(point.value).toBe('explicit@example.test');
    expect(point.valueNormalized).toBe('explicit@example.test');
  });

  it('demotes any existing primary email contact point when creating a new one', async () => {
    const userId = await seedUser(db, schema, 'ContactPointDemote');
    const existing = await db
      .insert(schema.contactPoint)
      .values({
        userId,
        type: 'email',
        value: 'old@example.test',
        valueNormalized: 'old@example.test',
        valueMasked: 'o***@example.test',
        status: 'active',
        primary: true,
        verifiedAt: new Date(),
      })
      .returning({ id: schema.contactPoint.id });

    await ensureAccountEmailContactPoint(db, userId, 'new@example.test');

    const [oldRow] = await db
      .select({ primary: schema.contactPoint.primary })
      .from(schema.contactPoint)
      .where(eq(schema.contactPoint.id, existing[0]!.id));
    expect(oldRow?.primary).toBe(false);
  });

  it('throws when the user does not exist and no email is supplied', async () => {
    await expect(ensureAccountEmailContactPoint(db, 'user_does_not_exist')).rejects.toThrow(
      /User not found/,
    );
  });
});

describe('findContactPointByNormalizedValue', () => {
  it('finds an existing contact point scoped to user + type + normalized value', async () => {
    const userId = await seedUser(db, schema, 'ContactPointFind');
    const created = await ensureAccountEmailContactPoint(db, userId, 'find-me@example.test');

    const found = await findContactPointByNormalizedValue(
      db,
      userId,
      'email',
      'find-me@example.test',
    );

    expect(found?.id).toBe(created.id);
  });

  it('returns undefined when no contact point matches', async () => {
    const userId = await seedUser(db, schema, 'ContactPointFindMiss');
    const found = await findContactPointByNormalizedValue(db, userId, 'phone', '+15555550100');
    expect(found).toBeUndefined();
  });
});

describe('normalizeContactPointValue', () => {
  it('lowercases and trims an email', () => {
    expect(normalizeContactPointValue('email', '  Ada@Example.COM ')).toBe('ada@example.com');
  });

  it('strips non-digits from a phone number, preserving a leading +', () => {
    expect(normalizeContactPointValue('phone', '+1 (702) 555-0123')).toBe('+17025550123');
  });

  it('strips non-digits from a phone number with no leading +', () => {
    expect(normalizeContactPointValue('phone', '(702) 555-0123')).toBe('7025550123');
  });

  it('trims a push token value as-is', () => {
    expect(normalizeContactPointValue('push_token', '  token-abc  ')).toBe('token-abc');
  });
});

describe('maskContactPointValue', () => {
  it('masks an email, keeping the first local-part character and the domain', () => {
    expect(maskContactPointValue('email', 'ada@example.com')).toBe('a***@example.com');
  });

  it('masks an email with an empty local part', () => {
    expect(maskContactPointValue('email', '@example.com')).toBe('****@example.com');
  });

  it('masks a phone number, preserving a leading + and the last 4 digits', () => {
    expect(maskContactPointValue('phone', '+17025550123')).toBe('+*******0123');
  });

  it('masks a phone number with no leading +', () => {
    expect(maskContactPointValue('phone', '7025550123')).toBe('*******0123');
  });

  it('masks a push token to its first 4 and last 4 characters', () => {
    expect(maskContactPointValue('push_token', 'abcdef123456')).toBe('abcd...3456');
  });
});
