/**
 * `@docket/api` — T6b sync-engine wiring tests: the `runSync` work-graph branch (full vs
 * incremental, `lastFullSyncedAt` stamping), verify-time workspace persistence, and Linear
 * write-back scope enforcement.
 *
 * @remarks
 * The tests share one pglite instance with the rest of the suite (never reset between files),
 * so every query here is scoped by integration/org id — never a bare table-wide assertion.
 */
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';
import { publicProblemTitle } from '@docket/types';
import { ConnectorError } from '@docket/integrations';
import { ProviderError } from '@docket/connections/provider-error';

import { problemTypeUrl } from '../../src/error';
import { env } from '../../src/env';

import type * as IntegrationSyncModule from '../../src/routes/integration-sync';
import type * as IntegrationProviderModule from '../../src/routes/integration-provider';
import { appWithActor, getDb, one, seedBaseOrg } from '../support/routes-harness';
import { assertDefined } from '@docket/test-utils';

/**
 * `env`'s fields are `readonly` at the type level (the fail-fast 12-factor contract), but the
 * underlying object is a plain mutable object at runtime — the live-token-resolution test below
 * toggles `APP_MODE` for the duration of one case (always restored in `afterEach`) to reach the
 * needs-reauth branch the default test-mode short-circuit (`resolveConnectorToken` always
 * returning a mock token) never exercises. Mirrors `integrations-edges.test.ts`'s established
 * pattern for the same env.
 */
const mutableEnv = env as { APP_MODE: string };

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let integrations!: unknown;
let runSync!: typeof IntegrationSyncModule.runSync;
let runLeasedSync!: typeof IntegrationSyncModule.runLeasedSync;
let toSyncRunOut!: typeof IntegrationSyncModule.toSyncRunOut;
/**
 * The scope-block message, loaded from the route module (never re-hardcoded) so the test can't
 * silently drift from the single source of truth the verify/PATCH enforcement points speak with.
 * Imported dynamically in {@link beforeAll} — a static top-level import would pull `@docket/auth`
 * in at collection time, before the harness configures env, and fail env validation.
 */
let WRITE_SCOPE_MESSAGE!: typeof IntegrationProviderModule.LINEAR_WRITE_SCOPE_MESSAGE;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  integrations = (await import('../../src/routes/integrations')).default;
  ({ runSync, runLeasedSync, toSyncRunOut } = await import('../../src/routes/integration-sync'));
  WRITE_SCOPE_MESSAGE = (await import('../../src/routes/integration-provider'))
    .LINEAR_WRITE_SCOPE_MESSAGE;
});

afterEach(() => {
  mutableEnv.APP_MODE = 'test';
});

const J = { 'content-type': 'application/json' };

async function jsonBody<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

type IntegrationRow = typeof schema.integration.$inferSelect;

/** Seed a bare `linear` connector integration — no `config.teamMappings` (legacy fallback). */
async function seedLinearIntegration(
  orgId: string,
  actorId: string,
  writeBack = false,
): Promise<IntegrationRow> {
  return one(
    await db
      .insert(schema.integration)
      .values({
        organizationId: orgId,
        provider: 'linear',
        pattern: 'connector',
        roles: ['work'],
        writeBack,
        createdBy: actorId,
      })
      .returning(),
  );
}

/** Reload an integration row fresh from the db — `runSync` never mutates its caller's copy. */
async function reload(id: string): Promise<IntegrationRow> {
  return one(await db.select().from(schema.integration).where(eq(schema.integration.id, id)));
}

/** Seed a user + linked Linear `account` (with the given OAuth scope string) + an org actor. */
async function seedLinearActor(
  orgId: string,
  scope: string,
): Promise<{ actorId: string; accountId: string }> {
  const u = one(
    await db
      .insert(schema.user)
      .values({
        name: 'LinWriter',
        email: `linwriter-${Math.random().toString(36).slice(2)}@x.test`,
      })
      .returning({ id: schema.user.id }),
  );
  const accountId = `lin-acct-${Math.random().toString(36).slice(2)}`;
  await db.insert(schema.account).values({
    userId: u.id,
    providerId: 'linear',
    accountId,
    scope,
  });
  const a = one(
    await db
      .insert(schema.actor)
      .values({ organizationId: orgId, kind: 'human', displayName: 'LinWriter', userId: u.id })
      .returning({ id: schema.actor.id }),
  );
  return { actorId: a.id, accountId };
}

interface IntegrationStateRes {
  id: string;
  status: string;
  writeBack: boolean;
  lastError: string | null;
  connection: {
    account?: string;
    externalWorkspaceId?: string;
    externalWorkspaceSlug?: string;
    externalWorkspaceName?: string;
  };
}

describe('runSync — work-graph branch (Linear)', () => {
  it('full-backfills on the first run and stamps lastFullSyncedAt', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const row = await seedLinearIntegration(orgId, humanActorId);
    expect(row.lastFullSyncedAt).toBeNull();

    const run = await runSync(row, { actorId: humanActorId, trigger: 'scheduled' });
    expect(run).not.toBeNull();
    expect(assertDefined(run).status).toBe('succeeded');
    // The full 7-item LINEAR_WORK_GRAPH fixture: 6 items materialize (the 7th is a tombstone
    // with no prior local row — a no-op, never an insert, per the reconciler's rule that
    // absence/removal never destroys/creates from nothing).
    expect(assertDefined(run).total).toBe(7);
    expect(assertDefined(run).processed).toBe(6);

    const after = await reload(row.id);
    expect(after.lastFullSyncedAt).not.toBeNull();
    expect(after.lastSyncedAt).not.toBeNull();
  });

  it('a scheduled re-sync inside the full-sync window pulls incrementally', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const row = await seedLinearIntegration(orgId, humanActorId);

    const first = await runSync(row, { actorId: humanActorId, trigger: 'scheduled' });
    expect(assertDefined(first).total).toBe(7);
    const afterFirst = await reload(row.id);
    expect(afterFirst.lastFullSyncedAt).not.toBeNull();
    expect(afterFirst.lastSyncedAt).not.toBeNull();

    // Re-sync immediately on the SCHEDULED trigger: `lastFullSyncedAt` is fresh (well under the
    // 24h window), so this pull is INCREMENTAL — `updatedAfter` is real wall-clock
    // `lastSyncedAt` minus the cadence overlap, which is far newer than every
    // LINEAR_WORK_GRAPH fixture item's static (2025-12/2026-01) `updatedAt`. The mock filters
    // items strictly by that cutoff, so the incremental pull returns an EMPTY item set —
    // proving `updatedAfter` was genuinely threaded through (a full pull would return 7 again).
    const second = await runSync(afterFirst, { actorId: humanActorId, trigger: 'scheduled' });
    expect(assertDefined(second).status).toBe('succeeded');
    expect(assertDefined(second).total).toBe(0);
    expect(assertDefined(second).processed).toBe(0);

    const afterSecond = await reload(row.id);
    // lastFullSyncedAt does NOT advance on an incremental run...
    expect(assertDefined(afterSecond.lastFullSyncedAt).getTime()).toBe(
      assertDefined(afterFirst.lastFullSyncedAt).getTime(),
    );
    // ...but lastSyncedAt DOES advance on every successful run, full or incremental.
    expect(assertDefined(afterSecond.lastSyncedAt).getTime()).toBeGreaterThanOrEqual(
      assertDefined(afterFirst.lastSyncedAt).getTime(),
    );
  });

  it('a manual trigger forces a full re-walk even inside the full-sync window', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const row = await seedLinearIntegration(orgId, humanActorId);

    await runSync(row, { actorId: humanActorId, trigger: 'scheduled' });
    const afterFirst = await reload(row.id);
    expect(afterFirst.lastFullSyncedAt).not.toBeNull();

    const manual = await runSync(afterFirst, { actorId: humanActorId, trigger: 'manual' });
    // Full again: all 7 items are re-pulled (nothing changed, so nothing is re-processed).
    expect(assertDefined(manual).total).toBe(7);
    expect(assertDefined(manual).processed).toBe(0);

    const afterManual = await reload(row.id);
    expect(assertDefined(afterManual.lastFullSyncedAt).getTime()).toBeGreaterThanOrEqual(
      assertDefined(afterFirst.lastFullSyncedAt).getTime(),
    );
  });
});

describe('verify persists the provider workspace id (Linear webhook routing key)', () => {
  it('POST /:id/verify writes connection.externalWorkspaceId + slug from the connect result', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const row = await seedLinearIntegration(orgId, humanActorId);
    const w = appWithActor(integrations, orgId, ['manage'], humanActorId);

    const res = await w.request(`/${row.id}/verify`, { method: 'POST', headers: J });
    expect(res.status).toBe(200);
    const verified = await jsonBody<IntegrationStateRes>(res);
    expect(verified.status).toBe('connected');
    expect(verified.connection.externalWorkspaceId).toBe('mock-linear-org');
    expect(verified.connection.externalWorkspaceSlug).toBe('mock-linear');
    expect(verified.connection.externalWorkspaceName).toBe('Mock Linear Workspace');

    // Durable — not just echoed in the response.
    const persisted = await reload(row.id);
    expect(persisted.connection.externalWorkspaceId).toBe('mock-linear-org');
    expect(persisted.connection.externalWorkspaceSlug).toBe('mock-linear');
    expect(persisted.config['teamMappings']).toEqual([
      { externalTeamId: 'lin-team-eng', teamId: expect.any(String) },
      { externalTeamId: 'lin-team-ops', teamId: expect.any(String) },
    ]);
    expect(persisted.lastSyncedAt).not.toBeNull();
  });

  it('re-verifying an already-connected integration threads the persisted externalWorkspaceId back into connect()', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const row = await seedLinearIntegration(orgId, humanActorId);
    const w = appWithActor(integrations, orgId, ['manage'], humanActorId);

    const first = await jsonBody<IntegrationStateRes>(
      await w.request(`/${row.id}/verify`, { method: 'POST', headers: J }),
    );
    expect(first.status).toBe('connected');
    const afterFirst = await reload(row.id);
    expect(afterFirst.config['teamMappings']).toHaveLength(2);

    // A second verify call now carries a non-empty `connection.externalWorkspaceId` INTO
    // `connect()`'s input (the `row.connection.externalWorkspaceId ? {...} : {}` branch the
    // first call, starting from a blank connection, never took) — it must remain idempotent.
    const second = await jsonBody<IntegrationStateRes>(
      await w.request(`/${row.id}/verify`, { method: 'POST', headers: J }),
    );
    expect(second.status).toBe('connected');
    expect(second.connection.externalWorkspaceId).toBe('mock-linear-org');

    // The teamMappings backfill only runs once (non-empty already) — no duplicate entries.
    const afterSecond = await reload(row.id);
    expect(afterSecond.config['teamMappings']).toHaveLength(2);
  });

  it('rejects a second account that resolves to the same Linear workspace in one org', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const first = one(
      await db
        .insert(schema.integration)
        .values({
          organizationId: orgId,
          provider: 'linear',
          pattern: 'connector',
          externalAccountId: 'lin-one',
          createdBy: humanActorId,
        })
        .returning(),
    );
    const second = one(
      await db
        .insert(schema.integration)
        .values({
          organizationId: orgId,
          provider: 'linear',
          pattern: 'connector',
          externalAccountId: 'lin-two',
          createdBy: humanActorId,
        })
        .returning(),
    );
    const w = appWithActor(integrations, orgId, ['manage'], humanActorId);

    expect((await w.request(`/${first.id}/verify`, { method: 'POST', headers: J })).status).toBe(
      200,
    );
    const duplicate = await w.request(`/${second.id}/verify`, { method: 'POST', headers: J });
    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toMatchObject({ code: 'linear_workspace_already_connected' });
  });

  it('a UI-shaped connect (no writeBack in the body) verifies clean read-only', async () => {
    // The web connect flow sends no `writeBack`; Better Auth's Linear scope is read-only this
    // slice. A Linear integration must therefore default writeBack FALSE at create and verify
    // straight to `connected` — never dead-on-arrival in `error` with an unsatisfiable
    // "reconnect for write" message (the IMPORTANT-1 merge blocker).
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const w = appWithActor(integrations, orgId, ['manage'], humanActorId);

    const created = await w.request('/', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ provider: 'linear', pattern: 'connector', roles: ['work'] }),
    });
    expect(created.status).toBe(201);
    const createdRow = await jsonBody<IntegrationStateRes>(created);
    // Default-seeded read-only (write-back is opted into later via PATCH, scope-gated).
    expect(createdRow.writeBack).toBe(false);
    expect(createdRow.status).toBe('pending');

    const res = await w.request(`/${createdRow.id}/verify`, { method: 'POST', headers: J });
    expect(res.status).toBe(200);
    const verified = await jsonBody<IntegrationStateRes>(res);
    expect(verified.status).toBe('connected');
    expect(verified.lastError).toBeNull();
  });
});

describe('Linear write-back scope enforcement', () => {
  it('ignores client attempts to forge provider-owned webhook routing metadata', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const row = await seedLinearIntegration(orgId, humanActorId, false);
    await db
      .update(schema.integration)
      .set({ connection: { externalWorkspaceId: 'verified-workspace' } })
      .where(eq(schema.integration.id, row.id));
    const w = appWithActor(integrations, orgId, ['manage'], humanActorId);

    const response = await w.request(`/${row.id}`, {
      method: 'PATCH',
      headers: J,
      body: JSON.stringify({ connection: { externalWorkspaceId: 'victim-workspace' } }),
    });

    expect(response.status).toBe(200);
    expect((await reload(row.id)).connection.externalWorkspaceId).toBe('verified-workspace');
  });

  it('verify records an honest error when writeBack is on but the identity lacks write scope', async () => {
    // seedBaseOrg's actor has no linked identity at all (no `userId`) — the strictest case.
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const row = await seedLinearIntegration(orgId, humanActorId, true);
    const w = appWithActor(integrations, orgId, ['manage'], humanActorId);

    const res = await w.request(`/${row.id}/verify`, { method: 'POST', headers: J });
    expect(res.status).toBe(200);
    const verified = await jsonBody<IntegrationStateRes>(res);
    expect(verified.status).toBe('error');
    expect(verified.lastError).toBe(WRITE_SCOPE_MESSAGE);
    // The scope check short-circuits BEFORE the live connect() call, so no workspace id is
    // persisted from a connection attempt that never happened.
    expect(verified.connection.externalWorkspaceId).toBeUndefined();
  });

  it('PATCH rejects flipping writeBack on without write scope (409), and succeeds once granted', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const row = await seedLinearIntegration(orgId, humanActorId, false);
    const w = appWithActor(integrations, orgId, ['manage'], humanActorId);

    const denied = await w.request(`/${row.id}`, {
      method: 'PATCH',
      headers: J,
      body: JSON.stringify({ writeBack: true }),
    });
    expect(denied.status).toBe(409);
    const problem = await jsonBody<{ code: string; title: string }>(denied);
    expect(problem).toEqual({
      type: problemTypeUrl('linear_write_scope_required'),
      title: publicProblemTitle('linear_write_scope_required'),
      status: 409,
      code: 'linear_write_scope_required',
    });
    expect(JSON.stringify(problem)).not.toContain(WRITE_SCOPE_MESSAGE);
    // Rejected atomically: writeBack was never actually flipped.
    expect((await reload(row.id)).writeBack).toBe(false);

    // A different manager cannot fund somebody else's integration with their own grant merely by
    // toggling write-back: the bound integration owner remains the credential authority.
    const writer = await seedLinearActor(orgId, 'read write');
    const writerActorId = writer.actorId;
    const ww = appWithActor(integrations, orgId, ['manage'], writerActorId);
    const stillDenied = await ww.request(`/${row.id}`, {
      method: 'PATCH',
      headers: J,
      body: JSON.stringify({ writeBack: true }),
    });
    expect(stillDenied.status).toBe(409);

    // Explicitly binding the legacy row to the writer's linked account transfers credential
    // ownership and checks that exact account's scope in the same atomic update.
    const granted = await ww.request(`/${row.id}`, {
      method: 'PATCH',
      headers: J,
      body: JSON.stringify({ externalAccountId: writer.accountId, writeBack: true }),
    });
    expect(granted.status).toBe(200);
    const patched = await jsonBody<IntegrationStateRes>(granted);
    expect(patched.writeBack).toBe(true);
    expect((await reload(row.id)).createdBy).toBe(writerActorId);
  });

  it('never nags a read-only (writeBack: false) Linear integration regardless of scope', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema); // no linked identity/scope
    const row = await seedLinearIntegration(orgId, humanActorId, false);
    const w = appWithActor(integrations, orgId, ['manage'], humanActorId);

    // Verify succeeds normally — the scope check never triggers for a read-only connection.
    const verifyRes = await w.request(`/${row.id}/verify`, { method: 'POST', headers: J });
    expect(verifyRes.status).toBe(200);
    expect((await jsonBody<IntegrationStateRes>(verifyRes)).status).toBe('connected');

    // PATCH with writeBack explicitly false (or any other field) never 409s on scope.
    const patchRes = await w.request(`/${row.id}`, {
      method: 'PATCH',
      headers: J,
      body: JSON.stringify({ writeBack: false }),
    });
    expect(patchRes.status).toBe(200);
  });
});

describe('runSync — team-mapping scoping, config edges, and the shared spine failure paths', () => {
  it('scopes the work-graph pull by config.teamMappings when present (not the legacy listIds fallback)', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const row = await seedLinearIntegration(orgId, humanActorId);
    // Scope to `lin-team-eng` only — the fixture's 7-item graph splits 5 eng / 2 ops, so a
    // teamMappings-scoped pull must total 5, not the unscoped 7 every other graph test sees.
    await db
      .update(schema.integration)
      .set({ config: { teamMappings: [{ externalTeamId: 'lin-team-eng', teamId }] } })
      .where(eq(schema.integration.id, row.id));
    const scoped = await reload(row.id);

    const run = await runSync(scoped, { actorId: humanActorId, trigger: 'scheduled' });

    expect(assertDefined(run).status).toBe('succeeded');
    expect(assertDefined(run).total).toBe(5);
  });

  it('records a fallback "Connector error" message when the executor throws a non-Error value', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const row = await seedLinearIntegration(orgId, humanActorId);
    const run = await runLeasedSync(
      row,
      { actorId: humanActorId, trigger: 'scheduled', purpose: 'task_sync' },
      async () => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- deliberately non-Error
        throw 'raw string failure';
      },
    );

    expect(assertDefined(run).status).toBe('failed');
    expect(assertDefined(run).error).toBe('Connector error');
  });

  it('records an ambiguous write without calling a healthy connection broken', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const row = await seedLinearIntegration(orgId, humanActorId);
    await db
      .update(schema.integration)
      .set({ status: 'connected' })
      .where(eq(schema.integration.id, row.id));
    const connected = await reload(row.id);

    const run = await runLeasedSync(
      connected,
      { actorId: humanActorId, trigger: 'scheduled', purpose: 'notion_mirror' },
      async () => {
        throw new ProviderError('Waiting for Notion to confirm a page create', {
          provider: 'notion',
          kind: 'ambiguous',
        });
      },
    );

    expect(run).toMatchObject({ status: 'failed', errorKind: 'ambiguous' });
    const [stored] = await db
      .select({
        status: schema.integration.status,
        lastSyncStatus: schema.integration.lastSyncStatus,
      })
      .from(schema.integration)
      .where(eq(schema.integration.id, row.id));
    expect(stored).toMatchObject({ status: 'connected', lastSyncStatus: 'failed' });
  });

  it('records a needs-reauth failure and notifies the owner when the executor throws an auth ConnectorError', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const [u] = await db
      .insert(schema.user)
      .values({
        name: 'Owner',
        email: `connector-auth-${Math.random().toString(36).slice(2)}@x.test`,
      })
      .returning({ id: schema.user.id });
    const [owner] = await db
      .insert(schema.actor)
      .values({
        organizationId: orgId,
        kind: 'human',
        displayName: 'Owner',
        userId: assertDefined(u).id,
      })
      .returning({ id: schema.actor.id });
    const row = await seedLinearIntegration(orgId, assertDefined(owner).id);

    const run = await runLeasedSync(
      row,
      { actorId: assertDefined(owner).id, trigger: 'scheduled', purpose: 'task_sync' },
      async () => {
        throw new ConnectorError('token rejected by provider', {
          provider: 'linear',
          kind: 'auth',
        });
      },
    );

    expect(assertDefined(run).status).toBe('failed');
    expect(assertDefined(run).error).toBe('token rejected by provider');

    const notif = await db
      .select()
      .from(schema.notification)
      .where(
        and(
          eq(schema.notification.userId, assertDefined(u).id),
          eq(schema.notification.organizationId, orgId),
        ),
      );
    expect(notif).toHaveLength(1);
    expect(assertDefined(notif[0]).type).toBe('connector_needs_reauth');
    expect(assertDefined(notif[0]).body.title).toBe('Reconnect Linear');
  });

  it('records a needs-reauth failure with a reconnect message when the live token resolver cannot resolve a credential', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const [u] = await db
      .insert(schema.user)
      .values({ name: 'Owner', email: `live-reauth-${Math.random().toString(36).slice(2)}@x.test` })
      .returning({ id: schema.user.id });
    const [owner] = await db
      .insert(schema.actor)
      .values({
        organizationId: orgId,
        kind: 'human',
        displayName: 'Owner',
        userId: assertDefined(u).id,
      })
      .returning({ id: schema.actor.id });
    // `owner` has a linked Better Auth user but no linked `linear` account at all.
    const row = await seedLinearIntegration(orgId, assertDefined(owner).id);

    mutableEnv.APP_MODE = 'production';
    const run = await runSync(row, { actorId: assertDefined(owner).id, trigger: 'scheduled' });

    expect(assertDefined(run).status).toBe('failed');
    expect(assertDefined(run).error).toContain('Sign in with');

    const notif = await db
      .select()
      .from(schema.notification)
      .where(
        and(
          eq(schema.notification.userId, assertDefined(u).id),
          eq(schema.notification.organizationId, orgId),
        ),
      );
    expect(notif).toHaveLength(1);
    expect(assertDefined(notif[0]).type).toBe('connector_needs_reauth');
  });

  it('never notifies an owner that cannot be resolved (integration.createdBy is null)', async () => {
    // An org with no team makes a github flat-import fail regardless of who's attributed.
    const slug = `noteam-nocreator-${Math.random().toString(36).slice(2, 10)}`;
    const [org] = await db
      .insert(schema.organization)
      .values({ name: slug, slug, lifecycleState: 'active' })
      .returning({ id: schema.organization.id });
    const [row] = await db
      .insert(schema.integration)
      .values({
        organizationId: assertDefined(org).id,
        provider: 'github',
        pattern: 'connector',
        roles: ['work'],
        createdBy: null,
      })
      .returning();

    const run = await runSync(assertDefined(row), {
      actorId: 'actor_bootstrap',
      trigger: 'scheduled',
    });

    expect(assertDefined(run).status).toBe('failed');
    expect(assertDefined(run).error).toMatch(/team/i);
    // No owner to notify — notifyOwner's `!row.createdBy` guard returns before any DB write.
    const notif = await db
      .select()
      .from(schema.notification)
      .where(eq(schema.notification.organizationId, assertDefined(org).id));
    expect(notif).toHaveLength(0);
  });

  it('records a plain (non-reauth) failure and notifies with the raw message for a non-connector provider', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const [u] = await db
      .insert(schema.user)
      .values({ name: 'Owner', email: `slack-owner-${Math.random().toString(36).slice(2)}@x.test` })
      .returning({ id: schema.user.id });
    const [owner] = await db
      .insert(schema.actor)
      .values({
        organizationId: orgId,
        kind: 'human',
        displayName: 'Owner',
        userId: assertDefined(u).id,
      })
      .returning({ id: schema.actor.id });
    // `slack` is not a connector provider (`asConnectorProvider` returns null) — this bypasses
    // the HTTP route's own guard (`POST /:id/sync` 409s before ever calling `runSync`) to
    // exercise `runLeasedSync`'s OWN internal provider check directly.
    const [row] = await db
      .insert(schema.integration)
      .values({
        organizationId: orgId,
        provider: 'slack',
        pattern: 'connector',
        roles: ['signal'],
        status: 'connected',
        createdBy: assertDefined(owner).id,
      })
      .returning();

    const run = await runSync(assertDefined(row), {
      actorId: assertDefined(owner).id,
      trigger: 'scheduled',
    });

    expect(assertDefined(run).status).toBe('failed');
    expect(assertDefined(run).error).toBe('Integration provider does not support sync');

    const notif = await db
      .select()
      .from(schema.notification)
      .where(
        and(
          eq(schema.notification.userId, assertDefined(u).id),
          eq(schema.notification.organizationId, orgId),
        ),
      );
    expect(notif).toHaveLength(1);
    expect(assertDefined(notif[0]).type).toBe('connector_sync_failed');
    // The provider-fallback branch: `asConnectorProvider('slack')` is null, so the notification
    // names the raw provider string rather than the directory's display name.
    expect(assertDefined(notif[0]).body.title).toBe('slack sync failed');
  });

  it('threads connection.externalWorkspaceId and config.listIds through the flat import path', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const [row] = await db
      .insert(schema.integration)
      .values({
        organizationId: orgId,
        provider: 'github',
        pattern: 'connector',
        roles: ['work'],
        connection: { externalWorkspaceId: 'gh-ws-1' },
        config: { listIds: ['gh-list-1'] },
        createdBy: humanActorId,
      })
      .returning();

    const run = await runSync(assertDefined(row), { actorId: humanActorId, trigger: 'scheduled' });

    expect(assertDefined(run).status).toBe('succeeded');
    expect(assertDefined(run).total).toBe(1); // the mock github fixture, unaffected by listIds/workspace scoping
  });

  it('treats a config that fails ConnectorConfig validation as empty rather than crashing', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const [row] = await db
      .insert(schema.integration)
      .values({
        organizationId: orgId,
        provider: 'github',
        pattern: 'connector',
        roles: ['work'],
        // `listIds` must be an array of strings — this shape fails `ConnectorConfig.safeParse`,
        // so `.data ?? {}` must fall back to an empty config rather than throwing.
        config: { listIds: 'not-an-array' },
        createdBy: humanActorId,
      })
      .returning();

    const run = await runSync(assertDefined(row), { actorId: humanActorId, trigger: 'scheduled' });

    expect(assertDefined(run).status).toBe('succeeded');
    expect(assertDefined(run).total).toBe(1);
  });

  it('the flat import path stamps lastFullSyncedAt too, not only the work-graph branch', async () => {
    // Mirrors the work-graph branch's own "full-backfills on the first run" coverage above: this
    // is the flat path's half of the same full-vs-incremental mechanism (the Notion connector's
    // incremental last_edited_time reads depend on lastFullSyncedAt actually advancing here).
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const [row] = await db
      .insert(schema.integration)
      .values({
        organizationId: orgId,
        provider: 'github',
        pattern: 'connector',
        roles: ['work'],
        createdBy: humanActorId,
      })
      .returning();

    expect(assertDefined(row).lastFullSyncedAt).toBeNull();
    const run = await runSync(assertDefined(row), { actorId: humanActorId, trigger: 'scheduled' });
    expect(assertDefined(run).status).toBe('succeeded');

    const after = await reload(assertDefined(row).id);
    expect(after.lastFullSyncedAt).not.toBeNull();
  });

  it('a second scheduled flat sync inside the full-sync window does not re-stamp lastFullSyncedAt', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const [row] = await db
      .insert(schema.integration)
      .values({
        organizationId: orgId,
        provider: 'github',
        pattern: 'connector',
        roles: ['work'],
        createdBy: humanActorId,
      })
      .returning();

    await runSync(assertDefined(row), { actorId: humanActorId, trigger: 'scheduled' });
    const afterFirst = await reload(assertDefined(row).id);
    expect(afterFirst.lastFullSyncedAt).not.toBeNull();

    await runSync(afterFirst, { actorId: humanActorId, trigger: 'scheduled' });
    const afterSecond = await reload(assertDefined(row).id);
    // Went incremental, so the full-sync stamp does not move — same assertion shape as the
    // work-graph branch's equivalent test above.
    expect(assertDefined(afterSecond.lastFullSyncedAt).getTime()).toBe(
      assertDefined(afterFirst.lastFullSyncedAt).getTime(),
    );
  });

  it('lookbackISO widens the incremental cutoff by the cadence overlap, treating a null cadence as zero overlap', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const row = await seedLinearIntegration(orgId, humanActorId);
    await db
      .update(schema.integration)
      .set({ syncCadenceMinutes: null })
      .where(eq(schema.integration.id, row.id));

    const first = await runSync(await reload(row.id), {
      actorId: humanActorId,
      trigger: 'scheduled',
    });
    expect(assertDefined(first).total).toBe(7); // first run is always a full backfill

    // Second run is incremental (still inside the full-sync window); with a null cadence the
    // `updatedAfter` cutoff is exactly `lastSyncedAt` (no overlap widening), which is still far
    // newer than every fixture item's static updatedAt — so it pulls nothing, same as a normal
    // cadence would, proving the null-cadence branch didn't throw or misbehave.
    const second = await runSync(await reload(row.id), {
      actorId: humanActorId,
      trigger: 'scheduled',
    });
    expect(assertDefined(second).status).toBe('succeeded');
    expect(assertDefined(second).total).toBe(0);
  });

  it('toSyncRunOut serializes a still-running run (finishedAt null) without throwing', () => {
    const runningRow: IntegrationSyncModule.SyncRunRow = {
      id: 'run_test_1',
      organizationId: 'org_test',
      integrationId: 'intg_test',
      status: 'running',
      trigger: 'manual',
      purpose: 'task_sync',
      processed: 0,
      total: 0,
      error: null,
      errorKind: null,
      startedAt: new Date('2026-07-01T00:00:00.000Z'),
      finishedAt: null,
    };

    const out = toSyncRunOut(runningRow);

    expect(out.status).toBe('running');
    expect(out.finishedAt).toBeNull();
  });
});
