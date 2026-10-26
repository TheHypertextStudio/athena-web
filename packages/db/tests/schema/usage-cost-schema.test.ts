/** Storage invariants for the usage ledger and the rate card. */
import { resolve } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { fullSchema, organization, usageDaily, usageRate, user } from '../../src';

let client!: PGlite;
const db = drizzle(new PGlite('memory://'), { schema: fullSchema });

describe('usage cost schema', () => {
  beforeAll(async () => {
    client = db.$client;
    await migrate(db, { migrationsFolder: resolve(import.meta.dirname, '../../drizzle') });
  });

  afterAll(async () => {
    await client.close();
  });

  it('keeps one ledger row per day, person, workspace, resource and dimension, even when owners are missing', async () => {
    const key = {
      day: '2026-03-10',
      userId: null,
      organizationId: null,
      resource: 'postgres_bytes',
      dimension: 'unattributed',
    } as const;
    await db.insert(usageDaily).values({ ...key, quantity: 1 });

    await expect(db.insert(usageDaily).values({ ...key, quantity: 2 })).rejects.toThrow();
  });

  it('refuses a resource the ledger does not meter and a negative quantity', async () => {
    await expect(
      db.insert(usageDaily).values({
        day: '2026-03-10',
        resource: 'ai_input_tokens',
        dimension: 'neg',
        quantity: -1,
      }),
    ).rejects.toThrow();
    await expect(
      db.insert(usageRate).values({
        resource: 'coffee' as never,
        microsPerMillionUnits: 1,
        effectiveFrom: new Date(),
      }),
    ).rejects.toThrow();
  });

  it('keeps usage when the person or workspace it names is deleted, and unlinks it', async () => {
    const [person] = await db
      .insert(user)
      .values({ name: 'Leaver', email: `leaver-${Date.now()}@example.com` })
      .returning({ id: user.id });
    const [org] = await db
      .insert(organization)
      .values({ name: 'Gone', slug: `gone-${Date.now()}` })
      .returning({ id: organization.id });
    await db.insert(usageDaily).values({
      day: '2026-03-11',
      userId: person?.id ?? '',
      organizationId: org?.id ?? '',
      resource: 'ai_input_tokens',
      dimension: 'm',
      quantity: 10,
    });

    await db.delete(user).where(eq(user.id, person?.id ?? ''));
    await db.delete(organization).where(eq(organization.id, org?.id ?? ''));

    const rows = await db.select().from(usageDaily).where(eq(usageDaily.day, '2026-03-11'));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.userId).toBeNull();
    expect(rows[0]?.organizationId).toBeNull();
    expect(rows[0]?.quantity).toBe(10);
  });

  it('keeps one price per resource, dimension and start instant', async () => {
    const price = {
      resource: 'object_bytes',
      dimension: '',
      microsPerMillionUnits: 100,
      effectiveFrom: new Date('2026-01-01T00:00:00Z'),
    } as const;
    await db.insert(usageRate).values(price);

    await expect(db.insert(usageRate).values(price)).rejects.toThrow();
    await expect(
      db
        .insert(usageRate)
        .values({ ...price, microsPerMillionUnits: -1, effectiveFrom: new Date() }),
    ).rejects.toThrow();
  });
});
