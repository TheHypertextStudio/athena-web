/**
 * `@docket/db` — tests for the staff-bootstrap seed helper {@link grantStaffByEmail}.
 *
 * @remarks
 * Exercises the operator-bootstrap primitive that breaks the staff chicken-and-egg (the
 * admin API can only mint staff for an existing superadmin, so the first row must be
 * seeded out of band). Runs against a fresh in-process PGlite so the idempotent upsert,
 * role-change, and missing-user branches are covered without any external service.
 */
import { resolve } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeAll, describe, expect, it } from 'vitest';

import { fullSchema, type Database } from '../src/client';
import { user } from '../src/schema';
import {
  STAFF_ROLES,
  bootstrapRoleFor,
  grantStaffByEmail,
  isStaffRole,
  parseStaffTarget,
  parseStaffTargets,
  roleForEmail,
} from '../src/seed';

let db!: Database;

beforeAll(async () => {
  const client = new PGlite('memory://');
  const d = drizzle(client, { schema: fullSchema });
  await migrate(d, { migrationsFolder: resolve(import.meta.dirname, '../drizzle') });
  db = d as unknown as Database;
  await db.insert(user).values({ name: 'Ada', email: 'ada@example.com' });
});

describe('isStaffRole', () => {
  it('accepts the three staff tiers and rejects anything else', () => {
    expect(STAFF_ROLES).toEqual(['support', 'finance', 'superadmin']);
    for (const r of STAFF_ROLES) expect(isStaffRole(r)).toBe(true);
    expect(isStaffRole('owner')).toBe(false);
    expect(isStaffRole('')).toBe(false);
    expect(isStaffRole('SUPERADMIN')).toBe(false);
  });
});

describe('parseStaffTarget / parseStaffTargets', () => {
  it('defaults the role to superadmin when omitted', () => {
    expect(parseStaffTarget('a@x.dev')).toEqual({ email: 'a@x.dev', role: 'superadmin' });
  });

  it('parses an explicit role and trims whitespace', () => {
    expect(parseStaffTarget('  a@x.dev:finance ')).toEqual({ email: 'a@x.dev', role: 'finance' });
  });

  it('throws on an unrecognized role rather than guessing', () => {
    expect(() => parseStaffTarget('a@x.dev:root')).toThrow(/Invalid staff role "root"/);
  });

  it('splits a comma list and skips blanks', () => {
    expect(parseStaffTargets('a@x.dev, b@x.dev:support ,')).toEqual([
      { email: 'a@x.dev', role: 'superadmin' },
      { email: 'b@x.dev', role: 'support' },
    ]);
  });
});

describe('roleForEmail / bootstrapRoleFor', () => {
  const targets = [
    { email: 'a@x.dev', role: 'superadmin' as const },
    { email: 'b@x.dev', role: 'finance' as const },
  ];

  it('matches case-insensitively, returns null when absent', () => {
    expect(roleForEmail(targets, 'A@X.dev')).toBe('superadmin');
    expect(roleForEmail(targets, 'c@x.dev')).toBeNull();
  });

  it('denies in production regardless of the allowlist', () => {
    expect(
      bootstrapRoleFor('a@x.dev', { appMode: 'production', bootstrapEmails: 'a@x.dev' }),
    ).toBeNull();
  });

  it('grants the configured tier in non-production', () => {
    expect(
      bootstrapRoleFor('b@x.dev', { appMode: 'local', bootstrapEmails: 'a@x.dev,b@x.dev:finance' }),
    ).toBe('finance');
  });

  it('denies when nothing is configured or the email is not listed', () => {
    expect(
      bootstrapRoleFor('a@x.dev', { appMode: 'local', bootstrapEmails: undefined }),
    ).toBeNull();
    expect(
      bootstrapRoleFor('zzz@x.dev', { appMode: 'local', bootstrapEmails: 'a@x.dev' }),
    ).toBeNull();
  });
});

describe('grantStaffByEmail', () => {
  it('reports no-user when the email is not a known account', async () => {
    const result = await grantStaffByEmail(db, { email: 'nobody@example.com', role: 'superadmin' });
    expect(result).toEqual({ status: 'no-user', email: 'nobody@example.com' });
  });

  it('grants a fresh staff_user row for an existing account', async () => {
    const result = await grantStaffByEmail(db, { email: 'ada@example.com', role: 'superadmin' });
    expect(result.status).toBe('granted');
    if (result.status !== 'granted') throw new Error('expected granted');
    expect(result.role).toBe('superadmin');
    expect(result.staffUserId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(result.userId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it('is idempotent — granting the same role again is a no-op', async () => {
    const result = await grantStaffByEmail(db, { email: 'ada@example.com', role: 'superadmin' });
    expect(result.status).toBe('unchanged');
    if (result.status !== 'unchanged') throw new Error('expected unchanged');
    expect(result.role).toBe('superadmin');
  });

  it('updates the tier in place when the role differs, reporting the previous role', async () => {
    const result = await grantStaffByEmail(db, { email: 'ada@example.com', role: 'finance' });
    expect(result.status).toBe('updated');
    if (result.status !== 'updated') throw new Error('expected updated');
    expect(result.previousRole).toBe('superadmin');
    expect(result.role).toBe('finance');
  });

  it('matches the account case-insensitively (emails are stored verbatim)', async () => {
    const result = await grantStaffByEmail(db, { email: 'ADA@example.com', role: 'finance' });
    expect(result.status).toBe('unchanged');
  });
});
