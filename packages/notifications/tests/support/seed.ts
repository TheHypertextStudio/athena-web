/**
 * Minimal seeding helpers shared by `@docket/notifications`'s DB-backed `dispatch/*` tests.
 *
 * @remarks
 * Deliberately thin — only the columns each `dispatch/*` function actually reads. Mirrors the
 * seeding shapes `apps/api/tests/support/routes-harness.ts` uses so behavior stays consistent
 * with how the API container actually calls into this package.
 */
import { and, eq } from 'drizzle-orm';

import type * as DbModule from '@docket/db';

type Db = typeof DbModule.db;

/** Return the single row a query/insert was expected to produce, throwing if there is none. */
export function one<T>(rows: readonly T[]): T {
  const row = rows[0];
  if (!row) throw new Error('expected at least one row, got none');
  return row;
}

/** A short, collision-resistant token for unique test values (emails, slugs, idempotency keys). */
export function token(): string {
  return Math.random().toString(36).slice(2);
}

/** Seed a user (no hub — `dispatch/*` never reads it); returns the user id. */
export async function seedUser(db: Db, schema: typeof DbModule, name = 'User'): Promise<string> {
  const u = one(
    await db
      .insert(schema.user)
      .values({ name, email: `${name}-${token()}@x.test` })
      .returning({ id: schema.user.id }),
  );
  return u.id;
}

/** Seed an organization; returns its id. */
export async function seedOrg(db: Db, schema: typeof DbModule): Promise<string> {
  const slug = `org-${token()}`;
  const o = one(
    await db
      .insert(schema.organization)
      .values({ name: slug, slug })
      .returning({ id: schema.organization.id }),
  );
  return o.id;
}

/**
 * Add a human member to an org with the given role key, reusing the org's role of that key (or
 * creating it). Returns the new actor id.
 */
export async function addMember(
  db: Db,
  schema: typeof DbModule,
  orgId: string,
  userId: string,
  roleKey: 'owner' | 'member' = 'member',
  status: 'active' | 'suspended' = 'active',
): Promise<string> {
  const existing = await db
    .select({ id: schema.role.id })
    .from(schema.role)
    .where(and(eq(schema.role.organizationId, orgId), eq(schema.role.key, roleKey)))
    .limit(1);
  const roleId =
    existing[0]?.id ??
    one(
      await db
        .insert(schema.role)
        .values({
          organizationId: orgId,
          key: roleKey,
          name: roleKey === 'owner' ? 'Owner' : 'Member',
          isSystem: roleKey === 'owner',
        })
        .returning({ id: schema.role.id }),
    ).id;
  const a = one(
    await db
      .insert(schema.actor)
      .values({ organizationId: orgId, kind: 'human', displayName: 'M', userId, roleId, status })
      .returning({ id: schema.actor.id }),
  );
  return a.id;
}

/** Seed a verified, active notification contact point. */
export async function seedContactPoint(
  db: Db,
  schema: typeof DbModule,
  userId: string,
  overrides: Partial<typeof DbModule.contactPoint.$inferInsert>,
): Promise<{ readonly id: string } & Record<string, unknown>> {
  const value = overrides.value ?? 'user@example.test';
  return one(
    await db
      .insert(schema.contactPoint)
      .values({
        userId,
        type: 'email',
        value,
        valueNormalized: value,
        valueMasked: 'u***@example.test',
        status: 'active',
        primary: true,
        verifiedAt: new Date('2026-07-07T17:00:00.000Z'),
        ...overrides,
      })
      .returning(),
  );
}
