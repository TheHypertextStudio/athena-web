/**
 * `@docket/api` — T6b sync-engine wiring tests: the `runSync` work-graph branch (full vs
 * incremental, `lastFullSyncedAt` stamping), verify-time workspace persistence, and Linear
 * write-back scope enforcement.
 *
 * @remarks
 * The tests share one pglite instance with the rest of the suite (never reset between files),
 * so every query here is scoped by integration/org id — never a bare table-wide assertion.
 */
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import type * as IntegrationSyncModule from '../../src/routes/integration-sync';
import type * as IntegrationProviderModule from '../../src/routes/integration-provider';
import { appWithActor, getDb, one, seedBaseOrg } from './harness.test';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let integrations!: unknown;
let runSync!: typeof IntegrationSyncModule.runSync;
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
  runSync = (await import('../../src/routes/integration-sync')).runSync;
  WRITE_SCOPE_MESSAGE = (await import('../../src/routes/integration-provider'))
    .LINEAR_WRITE_SCOPE_MESSAGE;
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
async function seedLinearActor(orgId: string, scope: string): Promise<string> {
  const u = one(
    await db
      .insert(schema.user)
      .values({
        name: 'LinWriter',
        email: `linwriter-${Math.random().toString(36).slice(2)}@x.test`,
      })
      .returning({ id: schema.user.id }),
  );
  await db.insert(schema.account).values({
    userId: u.id,
    providerId: 'linear',
    accountId: `lin-acct-${Math.random().toString(36).slice(2)}`,
    scope,
  });
  const a = one(
    await db
      .insert(schema.actor)
      .values({ organizationId: orgId, kind: 'human', displayName: 'LinWriter', userId: u.id })
      .returning({ id: schema.actor.id }),
  );
  return a.id;
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
  };
}

describe('runSync — work-graph branch (Linear)', () => {
  it('full-backfills on the first run and stamps lastFullSyncedAt', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const row = await seedLinearIntegration(orgId, humanActorId);
    expect(row.lastFullSyncedAt).toBeNull();

    const run = await runSync(row, { actorId: humanActorId, trigger: 'scheduled' });
    expect(run).not.toBeNull();
    expect(run!.status).toBe('succeeded');
    // The full 7-item LINEAR_WORK_GRAPH fixture: 6 items materialize (the 7th is a tombstone
    // with no prior local row — a no-op, never an insert, per the reconciler's rule that
    // absence/removal never destroys/creates from nothing).
    expect(run!.total).toBe(7);
    expect(run!.processed).toBe(6);

    const after = await reload(row.id);
    expect(after.lastFullSyncedAt).not.toBeNull();
    expect(after.lastSyncedAt).not.toBeNull();
  });

  it('a scheduled re-sync inside the full-sync window pulls incrementally', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const row = await seedLinearIntegration(orgId, humanActorId);

    const first = await runSync(row, { actorId: humanActorId, trigger: 'scheduled' });
    expect(first!.total).toBe(7);
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
    expect(second!.status).toBe('succeeded');
    expect(second!.total).toBe(0);
    expect(second!.processed).toBe(0);

    const afterSecond = await reload(row.id);
    // lastFullSyncedAt does NOT advance on an incremental run...
    expect(afterSecond.lastFullSyncedAt!.getTime()).toBe(afterFirst.lastFullSyncedAt!.getTime());
    // ...but lastSyncedAt DOES advance on every successful run, full or incremental.
    expect(afterSecond.lastSyncedAt!.getTime()).toBeGreaterThanOrEqual(
      afterFirst.lastSyncedAt!.getTime(),
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
    expect(manual!.total).toBe(7);
    expect(manual!.processed).toBe(0);

    const afterManual = await reload(row.id);
    expect(afterManual.lastFullSyncedAt!.getTime()).toBeGreaterThanOrEqual(
      afterFirst.lastFullSyncedAt!.getTime(),
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

    // Durable — not just echoed in the response.
    const persisted = await reload(row.id);
    expect(persisted.connection.externalWorkspaceId).toBe('mock-linear-org');
    expect(persisted.connection.externalWorkspaceSlug).toBe('mock-linear');
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
    expect(created.status).toBe(200);
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
    const problem = await jsonBody<{ title: string }>(denied);
    expect(problem.title).toBe(WRITE_SCOPE_MESSAGE);
    // Rejected atomically: writeBack was never actually flipped.
    expect((await reload(row.id)).writeBack).toBe(false);

    // A DIFFERENT actor whose linked Linear identity carries `write` exercises the other
    // outcome — no APP_MODE bypass, just real fixture data.
    const writerActorId = await seedLinearActor(orgId, 'read write');
    const ww = appWithActor(integrations, orgId, ['manage'], writerActorId);
    const granted = await ww.request(`/${row.id}`, {
      method: 'PATCH',
      headers: J,
      body: JSON.stringify({ writeBack: true }),
    });
    expect(granted.status).toBe(200);
    const patched = await jsonBody<IntegrationStateRes>(granted);
    expect(patched.writeBack).toBe(true);
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
