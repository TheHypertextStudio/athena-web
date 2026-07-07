/**
 * `@docket/api` — the Slack OAuth connect callback: signed-state guards, the local/test mock
 * exchange (deterministic T-MOCK fixtures), account-row + integration stamping, and truthful
 * error recording. (The authorize-URL/exchange internals are unit-tested in slack-app.test.ts.)
 */
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import { getDb, one, seedBaseOrg, seedUserWithHub } from '../support/routes-harness';

import type * as SlackApp from '../../src/lib/slack-app';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let app!: { request: (path: string, init?: RequestInit) => Response | Promise<Response> };
let signSlackConnectState!: typeof SlackApp.signSlackConnectState;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  app = (await import('../../src/routes/integrations-slack')).default;
  ({ signSlackConnectState } = await import('../../src/lib/slack-app'));
});

/** Seed a pending Slack integration owned by a fresh org + user; returns all the ids. */
async function seedPendingSlack(): Promise<{
  orgId: string;
  userId: string;
  integrationId: string;
}> {
  const { orgId, humanActorId } = await seedBaseOrg(db, schema);
  const userId = await seedUserWithHub(db, schema, 'Slacker');
  const row = one(
    await db
      .insert(schema.integration)
      .values({
        organizationId: orgId,
        provider: 'slack',
        pattern: 'connector',
        roles: ['signal'],
        status: 'pending',
        createdBy: humanActorId,
      })
      .returning({ id: schema.integration.id }),
  );
  return { orgId, userId, integrationId: row.id };
}

describe('GET /internal/integrations/slack/callback', () => {
  it('redirects to the web root with ?slack=error when no state is present', async () => {
    const res = await app.request('/callback?code=mock');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('/?slack=error');
  });

  it('redirects with an error for a tampered/garbage state', async () => {
    const res = await app.request('/callback?code=mock&state=garbage');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('slack=error');
  });

  it('redirects with an error for an expired state', async () => {
    const { orgId, userId, integrationId } = await seedPendingSlack();
    const past = Date.now() - 60 * 60_000;
    const state = signSlackConnectState({ integrationId, orgId, userId }, past);
    const res = await app.request(`/callback?code=mock&state=${encodeURIComponent(state)}`);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('slack=error');
  });

  it('redirects with an error when the state names a missing integration', async () => {
    const { orgId, userId } = await seedPendingSlack();
    const state = signSlackConnectState({ integrationId: 'intg_missing', orgId, userId });
    const res = await app.request(`/callback?code=mock&state=${encodeURIComponent(state)}`);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('slack=error');
  });

  it('records a user cancel (?error=access_denied, no code) as an integration error', async () => {
    const { orgId, userId, integrationId } = await seedPendingSlack();
    const state = signSlackConnectState({ integrationId, orgId, userId });
    const res = await app.request(
      `/callback?error=access_denied&state=${encodeURIComponent(state)}`,
    );
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('slack=error');
    const row = one(
      await db
        .select({ status: schema.integration.status, lastError: schema.integration.lastError })
        .from(schema.integration)
        .where(eq(schema.integration.id, integrationId)),
    );
    expect(row.status).toBe('error');
    expect(row.lastError).toBe('access_denied');
  });

  it('connects the integration and stores the user grant on the happy (mock) path', async () => {
    const { orgId, userId, integrationId } = await seedPendingSlack();
    const state = signSlackConnectState({ integrationId, orgId, userId });
    const res = await app.request(`/callback?code=mock&state=${encodeURIComponent(state)}`);
    expect(res.status).toBe(302);
    // The return lands on the org's Connections settings page, where the ?slack= flag is read.
    expect(res.headers.get('location')).toContain(
      `/orgs/${orgId}/settings/connections?slack=connected`,
    );

    const slackUserId = `U-MOCK-${userId.slice(0, 12)}`;
    const row = one(
      await db.select().from(schema.integration).where(eq(schema.integration.id, integrationId)),
    );
    expect(row.status).toBe('connected');
    expect(row.externalAccountId).toBe(slackUserId);
    expect(row.connection.externalWorkspaceId).toBe('T-MOCK');
    expect(row.connection.account).toBe('Mock Workspace');
    expect(row.connection.credentialsRef).toBe(`account:slack:${slackUserId}`);

    const acct = one(
      await db
        .select({ accessToken: schema.account.accessToken, scope: schema.account.scope })
        .from(schema.account)
        .where(
          and(
            eq(schema.account.userId, userId),
            eq(schema.account.providerId, 'slack'),
            eq(schema.account.accountId, slackUserId),
          ),
        ),
    );
    expect(acct.accessToken).toBe('mock');
    expect(acct.scope).toContain('im:history');
  });

  it('reconnecting updates the existing account row instead of duplicating it', async () => {
    const { orgId, userId, integrationId } = await seedPendingSlack();
    const state = signSlackConnectState({ integrationId, orgId, userId });
    await app.request(`/callback?code=mock&state=${encodeURIComponent(state)}`);
    await app.request(`/callback?code=mock&state=${encodeURIComponent(state)}`);
    const rows = await db
      .select({ id: schema.account.id })
      .from(schema.account)
      .where(and(eq(schema.account.userId, userId), eq(schema.account.providerId, 'slack')));
    expect(rows).toHaveLength(1);
  });
});
