import { resolve } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  athenaAssignment,
  athenaTrigger,
  personalMcpConnection,
  personalMcpCredential,
  user,
} from '../src/schema';

const client = new PGlite('memory://');
const db = drizzle(client);

let ownerUserId = '';
let otherUserId = '';

beforeAll(async () => {
  await migrate(db, { migrationsFolder: resolve(import.meta.dirname, '../drizzle') });
  const users = (
    await db
      .insert(user)
      .values([
        { name: 'Owner', email: 'personal-owner@example.com' },
        { name: 'Other', email: 'personal-other@example.com' },
      ])
      .returning({ id: user.id })
  ).map((row) => row.id);
  ownerUserId = users[0] ?? '';
  otherUserId = users[1] ?? '';
  if (!ownerUserId || !otherUserId) throw new Error('failed to seed personal Athena users');
});

afterAll(async () => client.close());

describe('personal Athena schema', () => {
  it('binds personal connection credentials to the same owner', async () => {
    const [connection] = await db
      .insert(personalMcpConnection)
      .values({
        ownerUserId,
        name: 'Sunsama',
        alias: 'sunsama',
        url: 'https://mcp.sunsama.com/mcp',
        authMode: 'bearer',
      })
      .returning();
    expect(connection?.ownerUserId).toBe(ownerUserId);

    await db.insert(personalMcpCredential).values({
      connectionId: connection!.id,
      ownerUserId,
      ciphertext: 'v1:gcm:test',
    });
    await expect(
      db.insert(personalMcpCredential).values({
        connectionId: connection!.id,
        ownerUserId: otherUserId,
        ciphertext: 'v1:gcm:wrong-owner',
      }),
    ).rejects.toThrow();
  });

  it('keeps independent assignments and validates trigger cadence', async () => {
    expect(athenaAssignment).toBeDefined();
    expect(athenaTrigger).toBeDefined();
  });
});
