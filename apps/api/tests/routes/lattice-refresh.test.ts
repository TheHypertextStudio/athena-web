/** Rotating Lovelace refresh tokens must remain usable across concurrent Docket requests. */
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env['CREDENTIALS_ENCRYPTION_KEY'] = Buffer.alloc(32, 7).toString('base64');
});

import type * as DbModule from '@docket/db';
import type { LatticeCredentialRecord } from '@docket/integrations';
import { env } from '../../src/env';
import type * as ConnectionModule from '../../src/routes/lattice-connection';
import type * as CredentialsModule from '../../src/lib/credentials';
import { getDb, one } from '../support/routes-harness';

const mutableEnv = env as {
  LATTICE_CLIENT_ID: string | undefined;
  LATTICE_CLIENT_SECRET: string | undefined;
  LATTICE_ACCOUNTS_ISSUER: string | undefined;
  LATTICE_GATEWAY_URL: string | undefined;
};

let schema!: typeof DbModule;
let connectionModule!: typeof ConnectionModule;
let credentials!: typeof CredentialsModule;
let issuer!: Server;
let issuerOrigin!: string;
let acceptedRefreshToken = 'rt_1';
let refreshCount = 0;
let failNextRefresh = false;

async function requestForm(req: IncomingMessage): Promise<URLSearchParams> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
}

beforeAll(async () => {
  schema = await getDb();
  connectionModule = await import('../../src/routes/lattice-connection');
  credentials = await import('../../src/lib/credentials');
  issuer = createServer((req, res) => {
    void (async () => {
      const form = await requestForm(req);
      refreshCount += 1;
      res.setHeader('content-type', 'application/json');
      if (failNextRefresh) {
        failNextRefresh = false;
        res.writeHead(503);
        res.end(JSON.stringify({ error: 'temporarily_unavailable' }));
        return;
      }
      if (form.get('refresh_token') !== acceptedRefreshToken) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'invalid_grant' }));
        return;
      }
      acceptedRefreshToken = 'rt_2';
      res.writeHead(200);
      res.end(
        JSON.stringify({
          access_token: 'at_refreshed',
          refresh_token: acceptedRefreshToken,
          expires_in: 3600,
          scope: 'openid offline_access lattice:compute:inference lattice:compute:catalog:read',
        }),
      );
    })();
  });
  await new Promise<void>((done) => issuer.listen(0, '127.0.0.1', done));
  issuerOrigin = `http://127.0.0.1:${String((issuer.address() as AddressInfo).port)}`;
});

afterAll(async () => {
  await new Promise<void>((done) =>
    issuer.close(() => {
      done();
    }),
  );
});

beforeEach(() => {
  acceptedRefreshToken = 'rt_1';
  refreshCount = 0;
  failNextRefresh = false;
  mutableEnv.LATTICE_CLIENT_ID = 'client_docket_test';
  mutableEnv.LATTICE_CLIENT_SECRET = undefined;
  mutableEnv.LATTICE_ACCOUNTS_ISSUER = issuerOrigin;
  mutableEnv.LATTICE_GATEWAY_URL = 'https://lattice.test';
});

afterEach(() => {
  mutableEnv.LATTICE_CLIENT_ID = undefined;
  mutableEnv.LATTICE_CLIENT_SECRET = undefined;
  mutableEnv.LATTICE_ACCOUNTS_ISSUER = undefined;
  mutableEnv.LATTICE_GATEWAY_URL = undefined;
});

async function expiringConnection(): Promise<ConnectionModule.LatticeConnectionRow> {
  const user = one(
    await schema.db
      .insert(schema.user)
      .values({
        name: 'Lattice refresh owner',
        email: `refresh-${Math.random().toString(36).slice(2)}@lattice.test`,
      })
      .returning({ id: schema.user.id }),
  );
  const connection = one(
    await schema.db
      .insert(schema.latticeConnection)
      .values({ ownerUserId: user.id, status: 'connected' })
      .returning(),
  );
  const grant: LatticeCredentialRecord = {
    kind: 'lattice_oauth',
    clientId: 'client_docket_test',
    accessToken: 'at_expiring',
    refreshToken: 'rt_1',
    expiresInSeconds: 60,
    scope: 'openid offline_access lattice:compute:inference lattice:compute:catalog:read',
    obtainedAt: new Date(Date.now() - 120_000).toISOString(),
  };
  await schema.db.insert(schema.latticeCredential).values({
    connectionId: connection.id,
    ownerUserId: user.id,
    ciphertext: credentials.sealCredential(JSON.stringify(grant)),
  });
  return connection;
}

it('redeems a rotating refresh token once for two concurrent requests', async () => {
  const connection = await expiringConnection();

  const [first, second] = await Promise.all([
    connectionModule.loadUsableLatticeCredential(connection),
    connectionModule.loadUsableLatticeCredential(connection),
  ]);

  expect(first.accessToken).toBe('at_refreshed');
  expect(second.accessToken).toBe('at_refreshed');
  expect(refreshCount).toBe(1);
  const stored = one(
    await schema.db
      .select({ ciphertext: schema.latticeCredential.ciphertext })
      .from(schema.latticeCredential)
      .where(eq(schema.latticeCredential.connectionId, connection.id)),
  );
  expect(JSON.parse(credentials.unsealCredential(stored.ciphertext))).toMatchObject({
    refreshToken: 'rt_2',
  });
});

it('preserves the grant and allows retry after a temporary issuer failure', async () => {
  const connection = await expiringConnection();
  failNextRefresh = true;

  await expect(connectionModule.loadUsableLatticeCredential(connection)).rejects.toMatchObject({
    reason: 'gateway_error',
  });
  expect(refreshCount).toBe(1);

  const recovered = await connectionModule.loadUsableLatticeCredential(connection);
  expect(recovered.accessToken).toBe('at_refreshed');
  expect(refreshCount).toBe(2);
  expect(recovered.refreshToken).toBe('rt_2');
});
