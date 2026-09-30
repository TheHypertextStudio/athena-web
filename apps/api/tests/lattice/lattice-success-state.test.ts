import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import { latticeChatPort } from '../../src/routes/lattice-backend';
import { recordLatticeSuccess } from '../../src/routes/lattice-connection';
import { getDb, one } from '../support/routes-harness';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let gatewayOrigin!: string;
const gateway = createServer((request, response) => {
  const path = new URL(request.url ?? '/', 'http://localhost').pathname;
  const body =
    path === '/v1/personal-runtimes'
      ? {
          runtimes: [
            {
              latticeId: 'lat_studio',
              accountId: 'acct_test',
              displayName: 'Studio',
              executionBackend: 'local-model',
              status: 'reachable',
              createdAt: '2026-08-01T00:00:00.000Z',
              updatedAt: '2026-08-02T00:00:00.000Z',
              lastSeenAt: '2026-08-02T12:00:00.000Z',
            },
          ],
        }
      : {
          id: 'cmpl_local',
          object: 'chat.completion',
          model: 'local-scripted',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'Studio answered.' },
              finish_reason: 'stop',
            },
          ],
        };
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
});

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  await new Promise<void>((resolve) => gateway.listen(0, '127.0.0.1', resolve));
  gatewayOrigin = `http://127.0.0.1:${String((gateway.address() as AddressInfo).port)}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    gateway.close((error) => {
      if (error) reject(error);
      else resolve();
    }),
  );
});

/** Give each concurrency case its own owner and selected personal runtime. */
async function seedConnection(values: Partial<typeof schema.latticeConnection.$inferInsert>) {
  const owner = one(
    await db
      .insert(schema.user)
      .values({ name: 'Lattice concurrency', email: `${crypto.randomUUID()}@lattice.test` })
      .returning({ id: schema.user.id }),
  );
  await db.insert(schema.latticeConnection).values({
    ownerUserId: owner.id,
    status: 'connected',
    enabled: true,
    deviceId: 'lat_studio',
    ...values,
  });
  return owner.id;
}

describe('a delayed successful Lattice turn', () => {
  it('clears an earlier transient failure when the selected device answers', async () => {
    const ownerUserId = await seedConnection({
      lastFailureReason: 'gateway_error',
      lastFailureAt: new Date(Date.now() - 5_000),
    });

    const reply = await latticeChatPort(
      { accessToken: 'at_test', baseUrl: gatewayOrigin },
      'lat_studio',
      ownerUserId,
    ).runChat({ messages: [{ role: 'user', content: 'Are you back?' }], maxTokens: 100 });

    expect(reply.text).toBe('Studio answered.');
    const [connection] = await db
      .select()
      .from(schema.latticeConnection)
      .where(eq(schema.latticeConnection.ownerUserId, ownerUserId));
    expect(connection?.lastFailureReason).toBeNull();
    expect(connection?.lastFailureAt).toBeNull();
  });

  it('does not clear a failure recorded after its request began', async () => {
    const turnStartedAt = new Date(Date.now() - 5_000);
    const newerFailureAt = new Date(Date.now() - 1_000);
    const ownerUserId = await seedConnection({
      lastFailureReason: 'gateway_error',
      lastFailureAt: newerFailureAt,
    });

    await recordLatticeSuccess(ownerUserId, 'lat_studio', turnStartedAt);

    const [connection] = await db
      .select()
      .from(schema.latticeConnection)
      .where(eq(schema.latticeConnection.ownerUserId, ownerUserId));
    expect(connection?.lastFailureReason).toBe('gateway_error');
    expect(connection?.lastFailureAt).toEqual(newerFailureAt);
  });

  it('does not clear an authorization failure after the grant is revoked', async () => {
    const ownerUserId = await seedConnection({
      status: 'error',
      lastFailureReason: 'authorization_expired',
      lastFailureAt: new Date(Date.now() - 10_000),
    });

    await recordLatticeSuccess(ownerUserId, 'lat_studio', new Date(Date.now() - 5_000));

    const [connection] = await db
      .select()
      .from(schema.latticeConnection)
      .where(eq(schema.latticeConnection.ownerUserId, ownerUserId));
    expect(connection?.status).toBe('error');
    expect(connection?.lastFailureReason).toBe('authorization_expired');
  });
});
