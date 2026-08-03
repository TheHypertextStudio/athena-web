import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import { env } from '../../src/env';
import {
  appWithActor,
  getDb,
  one,
  seedBaseOrg,
  seedUserWithHub,
  addMember,
} from '../support/routes-harness';

/**
 * `env`'s fields are `readonly` at the type level (the fail-fast 12-factor contract), but the
 * underlying object is a plain mutable object at runtime — these tests toggle `APP_MODE`/
 * `GITHUB_APP_SLUG` for the duration of one case (always restored in `afterEach`) to reach
 * branches the default test-mode short-circuit never exercises.
 */
const mutableEnv = env as { APP_MODE: string; GITHUB_APP_SLUG: string | undefined };

/**
 * Edge-branch tests for `integrations.ts` not reached by `group-b.test.ts`/`group-e.test.ts`/
 * `integrations-sync.test.ts`/`integration-sync-graph.test.ts`: the non-connector-provider
 * guards on `/lists`/`/verify`/`/import`/`/sync` (only reachable via a provider outside
 * `IntegrationCreate`'s enum, e.g. a Slack row seeded directly like `integrations-slack.ts`
 * does), `validateTeamMappings`' shape-failure and empty-array no-ops, the account-identity
 * `catch` blocks on create/update, the already-bound-to-another-account PATCH conflict, an
 * already-in-flight sync, and the `/:id/connect-url` route (entirely untested elsewhere).
 */
let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let integrations!: unknown;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  integrations = (await import('../../src/routes/integrations')).default;
});

const J = { 'content-type': 'application/json' };
async function body<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

/** Seed an integration with an arbitrary provider string, bypassing `IntegrationCreate`'s enum. */
async function seedRawIntegration(
  orgId: string,
  actorId: string,
  overrides: Partial<typeof schema.integration.$inferInsert> = {},
): Promise<typeof schema.integration.$inferSelect> {
  return one(
    await db
      .insert(schema.integration)
      .values({
        organizationId: orgId,
        provider: 'slack', // not in CONNECTOR_PROVIDER_IDS -> asConnectorProvider() returns undefined
        pattern: 'connector',
        roles: ['signal'],
        createdBy: actorId,
        ...overrides,
      })
      .returning(),
  );
}

describe('non-connector-provider guards (e.g. a Slack row) across every provider-gated route', () => {
  it('/lists 409s', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const row = await seedRawIntegration(orgId, humanActorId);
    const w = appWithActor(integrations, orgId, ['manage'], humanActorId);
    const res = await w.request(`/${row.id}/lists`);
    expect(res.status).toBe(409);
  });

  it('/verify 409s', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const row = await seedRawIntegration(orgId, humanActorId);
    const w = appWithActor(integrations, orgId, ['manage'], humanActorId);
    const res = await w.request(`/${row.id}/verify`, { method: 'POST' });
    expect(res.status).toBe(409);
  });

  it('/import 409s', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const row = await seedRawIntegration(orgId, humanActorId);
    const w = appWithActor(integrations, orgId, ['contribute'], humanActorId);
    const res = await w.request(`/${row.id}/import`, { method: 'POST', headers: J, body: '{}' });
    expect(res.status).toBe(409);
  });

  it('/sync 409s', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const row = await seedRawIntegration(orgId, humanActorId);
    const w = appWithActor(integrations, orgId, ['manage'], humanActorId);
    const res = await w.request(`/${row.id}/sync`, { method: 'POST' });
    expect(res.status).toBe(409);
  });
});

describe('POST /:id/sync — a sync already in flight', () => {
  it('409s rather than starting a duplicate run', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const row = one(
      await db
        .insert(schema.integration)
        .values({
          organizationId: orgId,
          provider: 'github',
          pattern: 'connector',
          roles: ['work'],
          createdBy: humanActorId,
          syncStartedAt: new Date(), // a lease already held, well within the stale window
        })
        .returning(),
    );
    const w = appWithActor(integrations, orgId, ['manage'], humanActorId);
    const res = await w.request(`/${row.id}/sync`, { method: 'POST' });
    expect(res.status).toBe(409);
  });
});

describe('validateTeamMappings — shape failure and empty-array no-op', () => {
  it('422s when config.teamMappings is present but not the described array shape', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const w = appWithActor(integrations, orgId, ['manage'], humanActorId);
    const res = await w.request('/', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({
        provider: 'linear',
        pattern: 'connector',
        config: { teamMappings: 'not-an-array' },
      }),
    });
    expect(res.status).toBe(422);
  });

  it('is a no-op when config.teamMappings is present but an explicit empty array', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const w = appWithActor(integrations, orgId, ['manage'], humanActorId);
    const res = await w.request('/', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({
        provider: 'linear',
        pattern: 'connector',
        config: { teamMappings: [] },
      }),
    });
    expect(res.status).toBe(200);
  });
});

describe('POST / and PATCH /:id — resolveActorConnectorIdentity failure is surfaced as a 409', () => {
  it('POST / with provider linear and no externalAccountId: "account_selection_required" when unlinked', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const userId = await seedUserWithHub(db, schema, 'NoLinearLink');
    const actorId = await addMember(db, schema, orgId, userId, 'member');
    const w = appWithActor(integrations, orgId, ['manage'], actorId);
    const res = await w.request('/', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ provider: 'linear', pattern: 'connector' }),
    });
    expect(res.status).toBe(409);
    const problem = await body<{ code?: string }>(res);
    expect(problem.code).toBe('account_selection_required');
  });

  it('POST / with a non-linear provider + explicit externalAccountId: plain "conflict" (not account_selection_required)', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const userId = await seedUserWithHub(db, schema, 'NoGtasksLink2');
    const actorId = await addMember(db, schema, orgId, userId, 'member');
    const w = appWithActor(integrations, orgId, ['manage'], actorId);
    const res = await w.request('/', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({
        provider: 'gtasks',
        pattern: 'connector',
        externalAccountId: 'not-linked-account',
      }),
    });
    expect(res.status).toBe(409);
    const problem = await body<{ code?: string }>(res);
    expect(problem.code).toBe('conflict');
  });

  it('PATCH /:id with a new externalAccountId: 409 when that account is not linked to the actor', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const userId = await seedUserWithHub(db, schema, 'NoGtasksLink');
    const actorId = await addMember(db, schema, orgId, userId, 'member');
    const row = one(
      await db
        .insert(schema.integration)
        .values({
          organizationId: orgId,
          provider: 'gtasks',
          pattern: 'connector',
          roles: ['work'],
          createdBy: humanActorId,
        })
        .returning(),
    );
    const w = appWithActor(integrations, orgId, ['manage'], actorId);
    const res = await w.request(`/${row.id}`, {
      method: 'PATCH',
      headers: J,
      body: JSON.stringify({ externalAccountId: 'not-linked-account' }),
    });
    expect(res.status).toBe(409);
  });

  it('PATCH /:id rejects rebinding an already-bound integration to a different account', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const row = one(
      await db
        .insert(schema.integration)
        .values({
          organizationId: orgId,
          provider: 'gtasks',
          pattern: 'connector',
          roles: ['work'],
          createdBy: humanActorId,
          externalAccountId: 'already-bound-account',
        })
        .returning(),
    );
    const w = appWithActor(integrations, orgId, ['manage'], humanActorId);
    const res = await w.request(`/${row.id}`, {
      method: 'PATCH',
      headers: J,
      body: JSON.stringify({ externalAccountId: 'a-different-account' }),
    });
    expect(res.status).toBe(409);
  });

  it('PATCH /:id binds a fresh externalAccountId on a non-connector provider without an identity check', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const row = await seedRawIntegration(orgId, humanActorId); // provider: 'slack', not a connector
    const w = appWithActor(integrations, orgId, ['manage'], humanActorId);
    const res = await w.request(`/${row.id}`, {
      method: 'PATCH',
      headers: J,
      body: JSON.stringify({ externalAccountId: 'some-slack-account' }),
    });
    expect(res.status).toBe(200);
    const updated = await body<{ id: string }>(res);
    expect(updated.id).toBe(row.id);
  });
});

describe('GET /:id/connect-url', () => {
  afterEach(() => {
    mutableEnv.GITHUB_APP_SLUG = undefined;
  });

  it('409s for a non-GitHub integration', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const row = one(
      await db
        .insert(schema.integration)
        .values({
          organizationId: orgId,
          provider: 'linear',
          pattern: 'connector',
          roles: ['work'],
          createdBy: humanActorId,
        })
        .returning(),
    );
    const w = appWithActor(integrations, orgId, ['manage'], humanActorId);
    const res = await w.request(`/${row.id}/connect-url`);
    expect(res.status).toBe(409);
  });

  it('409s for GitHub when GITHUB_APP_SLUG is unconfigured', async () => {
    mutableEnv.GITHUB_APP_SLUG = undefined;
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const row = one(
      await db
        .insert(schema.integration)
        .values({
          organizationId: orgId,
          provider: 'github',
          pattern: 'connector',
          roles: ['code'],
          createdBy: humanActorId,
        })
        .returning(),
    );
    const w = appWithActor(integrations, orgId, ['manage'], humanActorId);
    const res = await w.request(`/${row.id}/connect-url`);
    expect(res.status).toBe(409);
  });

  it('returns the install URL for GitHub once GITHUB_APP_SLUG is configured', async () => {
    mutableEnv.GITHUB_APP_SLUG = 'docket-test-app';
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const row = one(
      await db
        .insert(schema.integration)
        .values({
          organizationId: orgId,
          provider: 'github',
          pattern: 'connector',
          roles: ['code'],
          createdBy: humanActorId,
        })
        .returning(),
    );
    const w = appWithActor(integrations, orgId, ['manage'], humanActorId);
    const res = await w.request(`/${row.id}/connect-url`);
    expect(res.status).toBe(200);
    const { url } = await body<{ url: string }>(res);
    expect(url).toContain('docket-test-app');
  });
});

describe('token-resolution failure (env.APP_MODE=production) across /lists, /verify, /import', () => {
  // `resolveConnectorToken` short-circuits to a mock token whenever APP_MODE is 'local'/'test'
  // (every other suite's mode), so the real "no linked account" failure path these three routes
  // each handle distinctly is otherwise entirely unreachable. `seedBaseOrg`'s actor has no
  // linked Better Auth user, so the live resolver hits its DB-only `needsReauth` short-circuit —
  // no real network/credential access, safe to run under 'production' mode here.
  afterEach(() => {
    mutableEnv.APP_MODE = 'test';
  });

  async function seedGtasksIntegration(orgId: string, actorId: string) {
    return one(
      await db
        .insert(schema.integration)
        .values({
          organizationId: orgId,
          provider: 'gtasks',
          pattern: 'connector',
          roles: ['work'],
          createdBy: actorId,
        })
        .returning(),
    );
  }

  it('/lists 409s and never fabricates an empty-but-successful list', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const row = await seedGtasksIntegration(orgId, humanActorId);
    mutableEnv.APP_MODE = 'production';
    const w = appWithActor(integrations, orgId, ['manage'], humanActorId);
    const res = await w.request(`/${row.id}/lists`);
    expect(res.status).toBe(409);
  });

  it('/verify records status=error with the real reason, returned as 200 (not thrown away)', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const row = await seedGtasksIntegration(orgId, humanActorId);
    mutableEnv.APP_MODE = 'production';
    const w = appWithActor(integrations, orgId, ['manage'], humanActorId);
    const res = await w.request(`/${row.id}/verify`, { method: 'POST' });
    expect(res.status).toBe(200);
    const after = one(
      await db.select().from(schema.integration).where(eq(schema.integration.id, row.id)),
    );
    expect(after.status).toBe('error');
    expect(after.lastError).toContain('Sign in with google');
  });

  it('/import 409s and demotes the integration to error with the real reason', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const row = await seedGtasksIntegration(orgId, humanActorId);
    mutableEnv.APP_MODE = 'production';
    const w = appWithActor(integrations, orgId, ['contribute'], humanActorId);
    const res = await w.request(`/${row.id}/import`, { method: 'POST', headers: J, body: '{}' });
    expect(res.status).toBe(409);
    const after = one(
      await db.select().from(schema.integration).where(eq(schema.integration.id, row.id)),
    );
    expect(after.status).toBe('error');
  });
});
