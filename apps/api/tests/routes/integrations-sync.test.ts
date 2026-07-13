import { and, eq, sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import type * as IntegrationSyncModule from '../../src/routes/integration-sync';
import { appWithActor, getDb, seedBaseOrg } from '../support/routes-harness';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let integrations!: unknown;
let sweepConnectorSync!: typeof IntegrationSyncModule.sweepConnectorSync;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  integrations = (await import('../../src/routes/integrations')).default;
  sweepConnectorSync = (await import('../../src/routes/integration-sync')).sweepConnectorSync;
});

const MISSING = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const J = { 'content-type': 'application/json' };

async function body<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

/** Insert a connector integration for `provider` in `orgId`; returns its id. */
async function seedIntegration(orgId: string, actorId: string, provider: string): Promise<string> {
  const [row] = await db
    .insert(schema.integration)
    .values({
      organizationId: orgId,
      provider,
      pattern: 'connector',
      roles: ['work'],
      createdBy: actorId,
    })
    .returning({ id: schema.integration.id });
  return row!.id;
}

interface DirectoryRes {
  providers: {
    provider: string;
    name: string;
    pattern: string;
    roles: string[];
    category: string;
    syncable: boolean;
  }[];
}
interface SyncRunRes {
  id: string;
  integrationId: string;
  status: string;
  trigger: string;
  processed: number;
  total: number;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}
interface IntegrationStateRes {
  id: string;
  status: string;
  lastSyncStatus: string | null;
  lastSyncedAt: string | null;
  lastError: string | null;
  connection: { account?: string };
}
interface IntegrationRes {
  id: string;
  organizationId: string;
  provider: string;
  pattern: string;
  roles: string[];
}
interface ImportedTaskRes {
  id: string;
  organizationId: string;
  title: string;
  teamId: string;
  assigneeId: string | null;
  provenance: {
    source: string;
    sourceIntegrationId: string | null;
    externalId: string | null;
    externalUrl: string | null;
    syncMode: string;
  };
}

describe('integrations directory', () => {
  it('lists every connector provider with pattern/roles/category (view capability)', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const v = appWithActor(integrations, orgId, ['view']);

    const res = await v.request('/directory');
    expect(res.status).toBe(200);
    const dir = await body<DirectoryRes>(res);

    const providers = dir.providers.map((p) => p.provider).sort();
    expect(providers).toEqual(['calendar', 'github', 'gmail', 'gtasks', 'linear']);

    const github = dir.providers.find((p) => p.provider === 'github')!;
    expect(github.name).toBe('GitHub');
    expect(github.pattern).toBe('connector');
    expect(github.roles).toContain('code');
    expect(github.category).toBe('engineering');

    expect(github.syncable).toBe(true);

    // The three onboarding connect sources are all present with sensible directory entries.
    const gtasks = dir.providers.find((p) => p.provider === 'gtasks')!;
    expect(gtasks.name).toBe('Google Tasks');
    expect(gtasks.pattern).toBe('connector');
    expect(gtasks.roles).toContain('work');
    expect(gtasks.category).toBe('project-management');

    const calendar = dir.providers.find((p) => p.provider === 'calendar')!;
    expect(calendar.name).toBe('Google Calendar');
    expect(calendar.roles).toContain('time');

    const linear = dir.providers.find((p) => p.provider === 'linear')!;
    expect(linear.name).toBe('Linear');
    expect(linear.roles).toContain('work');
    // Slice 2: Linear graduated from the one-time `migration` (Import) pattern to a live
    // `connector` on the Connections surface — see PROVIDER_DIRECTORY.linear. Every directory
    // provider is `connector` now (Linear was the only `migration` entry); `migration` remains a
    // valid `IntegrationPattern` enum value a client can still request explicitly on `POST /`
    // (see the CRUD test), it's just no longer any provider's *directory-recommended* pattern.
    expect(linear.pattern).toBe('connector');
    const patterns = new Set(dir.providers.map((p) => p.pattern));
    expect(patterns).toEqual(new Set(['connector']));
  });
});

describe('integrations sync', () => {
  it('runs the connector, records a succeeded run, and marks the integration connected', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const id = await seedIntegration(orgId, humanActorId, 'github');
    const w = appWithActor(integrations, orgId, ['manage'], humanActorId);

    const res = await w.request(`/${id}/sync`, { method: 'POST', headers: J });
    expect(res.status).toBe(200);
    const run = await body<SyncRunRes>(res);
    expect(run.status).toBe('succeeded');
    expect(run.trigger).toBe('manual');
    expect(run.integrationId).toBe(id);
    expect(run.total).toBe(1); // one fixture item per provider
    expect(run.processed).toBe(1); // first run materializes it
    expect(run.error).toBeNull();
    expect(run.finishedAt).not.toBeNull();

    // A successful sync is durably reflected on the integration itself (not ephemeral).
    const v = appWithActor(integrations, orgId, ['view']);
    const got = await body<IntegrationStateRes>(await v.request(`/${id}`));
    expect(got.status).toBe('connected');
    expect(got.lastSyncStatus).toBe('succeeded');
    expect(got.lastSyncedAt).not.toBeNull();
    expect(got.lastError).toBeNull();

    // The run is persisted and listable (view capability suffices).
    const runs = await body<{ items: SyncRunRes[] }>(await v.request(`/${id}/runs`));
    expect(runs.items).toHaveLength(1);
    expect(runs.items[0]!.id).toBe(run.id);
    expect(runs.items[0]!.status).toBe('succeeded');
  });

  it('is idempotent: a second sync processes nothing already materialized', async () => {
    // Linear is work-graph-capable (T6b wires `runSync` onto the T6a reconciler), so it now
    // syncs against the full 7-item LINEAR_WORK_GRAPH fixture (not the flat 2-item
    // CONNECTOR_ITEMS.linear the plain importWork path used) — 6 of its 7 work items
    // materialize on the first pass (the 7th is a tombstone with no prior local row, a no-op
    // per the reconciler's "absence/removal never destroys what was never seen" rule).
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const id = await seedIntegration(orgId, humanActorId, 'linear');
    const w = appWithActor(integrations, orgId, ['manage'], humanActorId);

    const first = await body<SyncRunRes>(
      await w.request(`/${id}/sync`, { method: 'POST', headers: J }),
    );
    expect(first.total).toBe(7);
    expect(first.processed).toBe(6);

    const second = await body<SyncRunRes>(
      await w.request(`/${id}/sync`, { method: 'POST', headers: J }),
    );
    // A manual sync always forces a full re-walk (see `integration-sync-graph.test.ts`), so the
    // second run's `total` is still the full 7 — but nothing CHANGED, so `processed` is 0.
    expect(second.total).toBe(7);
    expect(second.processed).toBe(0); // already imported, nothing new
    expect(second.status).toBe('succeeded');
    expect(second.id).not.toBe(first.id);
  });

  it('honors a valid config.teamId, and falls back when it is invalid', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);

    // A second team the integration explicitly targets via config.teamId.
    const [target] = await db
      .insert(schema.team)
      .values({
        organizationId: orgId,
        name: 'Target',
        key: `T${Math.random().toString(36).slice(2, 6)}`,
      })
      .returning({ id: schema.team.id });

    const [valid] = await db
      .insert(schema.integration)
      .values({
        organizationId: orgId,
        provider: 'github',
        pattern: 'connector',
        roles: ['work'],
        config: { teamId: target!.id },
        createdBy: humanActorId,
      })
      .returning({ id: schema.integration.id });

    const [invalid] = await db
      .insert(schema.integration)
      .values({
        organizationId: orgId,
        provider: 'github',
        pattern: 'connector',
        roles: ['context'],
        config: { teamId: 'not-a-real-team' },
        createdBy: humanActorId,
      })
      .returning({ id: schema.integration.id });

    const w = appWithActor(integrations, orgId, ['manage'], humanActorId);

    const v = await body<SyncRunRes>(
      await w.request(`/${valid!.id}/sync`, { method: 'POST', headers: J }),
    );
    expect(v.status).toBe('succeeded');
    expect(v.processed).toBe(1);

    const iv = await body<SyncRunRes>(
      await w.request(`/${invalid!.id}/sync`, { method: 'POST', headers: J }),
    );
    expect(iv.status).toBe('succeeded');
    expect(iv.processed).toBe(1);
  });

  it('409 when the provider is not connector-importable', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const id = await seedIntegration(orgId, humanActorId, 'slack');
    const w = appWithActor(integrations, orgId, ['manage'], humanActorId);

    const res = await w.request(`/${id}/sync`, { method: 'POST', headers: J });
    expect(res.status).toBe(409);
  });

  it('records a FAILED run (and flips the integration to error) when the sync cannot complete', async () => {
    // An org with no team to import into makes the run fail. The failure must be DURABLE — a
    // failed run + the integration marked `error` with the reason — never a vanished 409.
    const slug = `noteam-${Math.random().toString(36).slice(2, 10)}`;
    const [org] = await db
      .insert(schema.organization)
      .values({ name: slug, slug, lifecycleState: 'active' })
      .returning({ id: schema.organization.id });
    const orgId = org!.id;
    const [human] = await db
      .insert(schema.actor)
      .values({ organizationId: orgId, kind: 'human', displayName: 'A' })
      .returning({ id: schema.actor.id });
    const id = await seedIntegration(orgId, human!.id, 'github');
    const w = appWithActor(integrations, orgId, ['manage'], human!.id);

    const res = await w.request(`/${id}/sync`, { method: 'POST', headers: J });
    expect(res.status).toBe(200);
    const run = await body<SyncRunRes>(res);
    expect(run.status).toBe('failed');
    expect(run.error).toMatch(/team/i);

    // Durable: the integration now reads as needing attention, with the reason persisted.
    const got = await body<IntegrationStateRes>(await w.request(`/${id}`));
    expect(got.status).toBe('error');
    expect(got.lastSyncStatus).toBe('failed');
    expect(got.lastError).toMatch(/team/i);
  });

  it('notifies the owner once per healthy->broken transition, not on every subsequent failure', async () => {
    // Regression test for finishFailure's `row.status !== 'error'` guard: a persistently-broken
    // integration hit by repeated cron/manual syncs must not spam a fresh notification each time.
    const slug = `noteam-notify-${Math.random().toString(36).slice(2, 10)}`;
    const [org] = await db
      .insert(schema.organization)
      .values({ name: slug, slug, lifecycleState: 'active' })
      .returning({ id: schema.organization.id });
    const orgId = org!.id;
    const [u] = await db
      .insert(schema.user)
      .values({ name: 'A', email: `notify-owner-${Date.now().toString()}@example.com` })
      .returning({ id: schema.user.id });
    const [human] = await db
      .insert(schema.actor)
      .values({ organizationId: orgId, kind: 'human', displayName: 'A', userId: u!.id })
      .returning({ id: schema.actor.id });
    const id = await seedIntegration(orgId, human!.id, 'github');
    const w = appWithActor(integrations, orgId, ['manage'], human!.id);

    const first = await w.request(`/${id}/sync`, { method: 'POST', headers: J });
    expect((await body<{ status: string }>(first)).status).toBe('failed');
    const second = await w.request(`/${id}/sync`, { method: 'POST', headers: J });
    expect((await body<{ status: string }>(second)).status).toBe('failed');

    const rows = await db
      .select()
      .from(schema.notification)
      .where(
        and(eq(schema.notification.userId, u!.id), eq(schema.notification.organizationId, orgId)),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.type).toBe('connector_sync_failed');
  });

  it('404 when the integration does not exist', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const w = appWithActor(integrations, orgId, ['manage'], humanActorId);

    const res = await w.request(`/${MISSING}/sync`, { method: 'POST', headers: J });
    expect(res.status).toBe(404);
  });

  it('403 when the actor lacks the manage capability', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const id = await seedIntegration(orgId, humanActorId, 'github');
    const v = appWithActor(integrations, orgId, ['contribute'], humanActorId);

    const res = await v.request(`/${id}/sync`, { method: 'POST', headers: J });
    expect(res.status).toBe(403);
  });
});

describe('integrations run history', () => {
  it('404 listing runs for an unknown integration', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const v = appWithActor(integrations, orgId, ['view']);
    expect((await v.request(`/${MISSING}/runs`)).status).toBe(404);
  });

  it('is tenant-isolated: another org cannot read this org integration runs', async () => {
    const a = await seedBaseOrg(db, schema);
    const b = await seedBaseOrg(db, schema);
    const id = await seedIntegration(a.orgId, a.humanActorId, 'github');

    const wA = appWithActor(integrations, a.orgId, ['manage'], a.humanActorId);
    await wA.request(`/${id}/sync`, { method: 'POST', headers: J });

    // Org A reads its own integration's run history.
    expect((await wA.request(`/${id}/runs`)).status).toBe(200);

    // Org B is hidden from it (existence-hiding 404, not 403).
    const wB = appWithActor(integrations, b.orgId, ['view'], b.humanActorId);
    expect((await wB.request(`/${id}/runs`)).status).toBe(404);
  });
});

describe('onboarding connect + import (the exact path the connect step calls)', () => {
  // The onboarding user is the org OWNER and so carries both `manage` (to create the
  // integration) and `contribute` (to import). This is the one-click connect→mirror the
  // web connect step performs: POST / to create, then POST /:id/import to mirror work in.
  const OWNER_CAPS = ['manage', 'contribute'] as const;

  /** Create an integration for `provider` exactly as the connect step does, returning its id. */
  async function connect(
    app: ReturnType<typeof appWithActor>,
    provider: string,
  ): Promise<IntegrationRes> {
    const res = await app.request('/', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ provider, pattern: 'connector', roles: ['work'] }),
    });
    expect(res.status).toBe(200);
    return body<IntegrationRes>(res);
  }

  it.each([
    { provider: 'linear', count: 2 },
    { provider: 'gtasks', count: 3 },
    { provider: 'calendar', count: 2 },
  ])(
    'an org owner connects $provider and mirrors its work into the org as linked tasks',
    async ({ provider, count }) => {
      const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
      const owner = appWithActor(integrations, orgId, OWNER_CAPS, humanActorId);

      // 1) Connect: create the integration (no real OAuth/connection fields needed for mock).
      const created = await connect(owner, provider);
      expect(created.organizationId).toBe(orgId);
      expect(created.provider).toBe(provider);

      // 2) Import: mirror the provider's work into the org.
      const importRes = await owner.request(`/${created.id}/import`, {
        method: 'POST',
        headers: J,
        body: '{}',
      });
      expect(importRes.status).toBe(200);
      const imported = await body<{ items: ImportedTaskRes[] }>(importRes);
      expect(imported.items).toHaveLength(count);

      // Every mirrored task is a read-only linked mirror scoped to THIS org + team.
      for (const t of imported.items) {
        expect(t.organizationId).toBe(orgId);
        expect(t.teamId).toBe(teamId);
        expect(t.provenance.source).toBe('linked');
        expect(t.provenance.syncMode).toBe('mirror');
        expect(t.provenance.sourceIntegrationId).toBe(created.id);
        expect(t.provenance.externalId).toBeTruthy();
      }

      // The linked tasks are actually persisted in the org.
      const rows = await db
        .select()
        .from(schema.task)
        .where(
          and(
            eq(schema.task.organizationId, orgId),
            eq(schema.task.source, 'linked'),
            eq(schema.task.sourceIntegrationId, created.id),
          ),
        );
      expect(rows).toHaveLength(count);
    },
  );

  it('mirrors work from all three onboarding sources together into one populated workspace', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const owner = appWithActor(integrations, orgId, OWNER_CAPS, humanActorId);

    for (const provider of ['linear', 'gtasks', 'calendar']) {
      const created = await connect(owner, provider);
      const importRes = await owner.request(`/${created.id}/import`, {
        method: 'POST',
        headers: J,
        body: '{}',
      });
      expect(importRes.status).toBe(200);
    }

    // The workspace now holds every mirrored item (2 linear + 3 gtasks + 2 calendar).
    const rows = await db
      .select({ id: schema.task.id })
      .from(schema.task)
      .where(and(eq(schema.task.organizationId, orgId), eq(schema.task.source, 'linked')));
    expect(rows).toHaveLength(7);
  });

  it('assignToImporter assigns mirrored work to the owner so it lands in My Work', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const owner = appWithActor(integrations, orgId, OWNER_CAPS, humanActorId);

    const created = await connect(owner, 'gtasks');
    // The connect step sends `assignToImporter: true` so the owner's connected work is theirs.
    const importRes = await owner.request(`/${created.id}/import`, {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ assignToImporter: true }),
    });
    expect(importRes.status).toBe(200);
    const imported = await body<{ items: ImportedTaskRes[] }>(importRes);
    expect(imported.items.length).toBeGreaterThan(0);

    // Every mirrored task is assigned to the importing owner (visible under "Assigned to me").
    for (const t of imported.items) {
      expect(t.assigneeId).toBe(humanActorId);
    }
    const rows = await db
      .select({ assigneeId: schema.task.assigneeId })
      .from(schema.task)
      .where(
        and(
          eq(schema.task.organizationId, orgId),
          eq(schema.task.source, 'linked'),
          eq(schema.task.sourceIntegrationId, created.id),
        ),
      );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.assigneeId).toBe(humanActorId);
  });

  it('a default import leaves mirrored work unassigned (the general/sync path)', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const owner = appWithActor(integrations, orgId, OWNER_CAPS, humanActorId);

    const created = await connect(owner, 'gtasks');
    // No `assignToImporter` ⇒ mirrored work stays unassigned (surfaced org-wide in Triage).
    const importRes = await owner.request(`/${created.id}/import`, {
      method: 'POST',
      headers: J,
      body: '{}',
    });
    expect(importRes.status).toBe(200);
    const imported = await body<{ items: ImportedTaskRes[] }>(importRes);
    expect(imported.items.length).toBeGreaterThan(0);
    for (const t of imported.items) {
      expect(t.assigneeId).toBeNull();
    }
  });

  it('reconnecting a source is idempotent: it reuses the integration, so re-import does not duplicate mirrored work', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const owner = appWithActor(integrations, orgId, OWNER_CAPS, humanActorId);

    // First connect + import mirrors the gtasks fixture in full.
    const first = await connect(owner, 'gtasks');
    const firstImport = await body<{ items: ImportedTaskRes[] }>(
      await owner.request(`/${first.id}/import`, { method: 'POST', headers: J, body: '{}' }),
    );
    expect(firstImport.items.length).toBeGreaterThan(0);

    // Reconnecting the same provider (as re-running onboarding does) reuses the SAME
    // integration rather than minting a fresh one.
    const second = await connect(owner, 'gtasks');
    expect(second.id).toBe(first.id);

    // Only one integration row exists for this provider in the org.
    const intgRows = await db
      .select({ id: schema.integration.id })
      .from(schema.integration)
      .where(
        and(
          eq(schema.integration.organizationId, orgId),
          eq(schema.integration.provider, 'gtasks'),
        ),
      );
    expect(intgRows).toHaveLength(1);

    // Re-importing through the reused integration mirrors nothing new (dedupe by external id).
    const secondImport = await body<{ items: ImportedTaskRes[] }>(
      await owner.request(`/${second.id}/import`, { method: 'POST', headers: J, body: '{}' }),
    );
    expect(secondImport.items).toHaveLength(0);

    // The org holds exactly the first import's mirrored tasks — no duplicates.
    const taskRows = await db
      .select({ id: schema.task.id })
      .from(schema.task)
      .where(
        and(
          eq(schema.task.organizationId, orgId),
          eq(schema.task.source, 'linked'),
          eq(schema.task.sourceIntegrationId, first.id),
        ),
      );
    expect(taskRows).toHaveLength(firstImport.items.length);
  });

  it('a member without manage cannot create an integration during connect (403)', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const member = appWithActor(integrations, orgId, ['contribute', 'view'], humanActorId);
    const res = await member.request('/', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ provider: 'gtasks', pattern: 'connector', roles: ['work'] }),
    });
    expect(res.status).toBe(403);
  });
});

describe('integrations connect lifecycle (validate before connected)', () => {
  it('create starts PENDING — never a fabricated connected', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const w = appWithActor(integrations, orgId, ['manage'], humanActorId);
    const res = await w.request('/', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({
        provider: 'github',
        pattern: 'connector',
        roles: ['work'],
        syncMode: 'mirror',
      }),
    });
    expect(res.status).toBe(200);
    const created = await body<IntegrationStateRes>(res);
    expect(created.status).toBe('pending');
  });

  it('rejects providers outside the supported data-provider allowlist', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const w = appWithActor(integrations, orgId, ['manage'], humanActorId);
    const res = await w.request('/', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ provider: 'drive', pattern: 'connector', status: 'connected' }),
    });
    expect(res.status).toBe(422);
  });

  it('ignores a client-supplied status (a caller cannot self-declare connected)', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const w = appWithActor(integrations, orgId, ['manage'], humanActorId);
    const res = await w.request('/', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ provider: 'github', pattern: 'connector', status: 'connected' }),
    });
    const created = await body<IntegrationStateRes>(res);
    expect(created.status).toBe('pending');
  });

  it('verify promotes to connected only after the credential resolves (and records the account)', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const id = await seedIntegration(orgId, humanActorId, 'github');
    const w = appWithActor(integrations, orgId, ['manage'], humanActorId);

    const res = await w.request(`/${id}/verify`, { method: 'POST', headers: J });
    expect(res.status).toBe(200);
    const verified = await body<IntegrationStateRes>(res);
    expect(verified.status).toBe('connected');
    expect(verified.lastError).toBeNull();
    // The mock connector resolves an account label, which is persisted on the connection.
    expect(verified.connection.account).toBeTruthy();
  });
});

describe('background connector sweep', () => {
  it('syncs a due mirror integration on the scheduled trigger and records it durably', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const id = await seedIntegration(orgId, humanActorId, 'github');
    // The sweep only considers connected/error integrations; a pending one is never auto-synced.
    // lastSyncedAt is null → due immediately.
    await db
      .update(schema.integration)
      .set({ status: 'connected', lastSyncedAt: null, syncCadenceMinutes: 60 })
      .where(eq(schema.integration.id, id));

    await sweepConnectorSync(new Date());

    const w = appWithActor(integrations, orgId, ['view'], humanActorId);
    const got = await body<IntegrationStateRes>(await w.request(`/${id}`));
    expect(got.status).toBe('connected');
    expect(got.lastSyncedAt).not.toBeNull();

    const runs = await body<{ items: SyncRunRes[] }>(await w.request(`/${id}/runs`));
    expect(runs.items.some((r) => r.trigger === 'scheduled' && r.status === 'succeeded')).toBe(
      true,
    );
  });

  it('does not re-sync an integration whose cadence is not yet due', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const id = await seedIntegration(orgId, humanActorId, 'linear');
    // Just synced (now) with a 60-minute cadence → not due.
    await db
      .update(schema.integration)
      .set({ status: 'connected', lastSyncedAt: new Date(), syncCadenceMinutes: 60 })
      .where(eq(schema.integration.id, id));

    await sweepConnectorSync(new Date());

    const w = appWithActor(integrations, orgId, ['view'], humanActorId);
    const runs = await body<{ items: SyncRunRes[] }>(await w.request(`/${id}/runs`));
    expect(runs.items.some((r) => r.trigger === 'scheduled')).toBe(false);
  });

  it('never auto-syncs a pending integration (one never validated)', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const id = await seedIntegration(orgId, humanActorId, 'gtasks'); // defaults to pending

    await sweepConnectorSync(new Date());

    const w = appWithActor(integrations, orgId, ['view'], humanActorId);
    const got = await body<IntegrationStateRes>(await w.request(`/${id}`));
    expect(got.status).toBe('pending');
    const runs = await body<{ items: SyncRunRes[] }>(await w.request(`/${id}/runs`));
    expect(runs.items).toHaveLength(0);
  });
});

/** Seed a write-back gtasks integration (the two-way default isn't applied to raw inserts). */
async function seedWritableGtasks(orgId: string, actorId: string): Promise<string> {
  const [row] = await db
    .insert(schema.integration)
    .values({
      organizationId: orgId,
      provider: 'gtasks',
      pattern: 'connector',
      roles: ['work'],
      writeBack: true,
      createdBy: actorId,
    })
    .returning({ id: schema.integration.id });
  return row!.id;
}

describe('two-way Google Tasks sync', () => {
  it('pushes a locally-edited linked task back to the provider on the next sync (echo guard)', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const id = await seedWritableGtasks(orgId, humanActorId);
    const w = appWithActor(integrations, orgId, ['manage'], humanActorId);

    // First sync materializes the fixtures as clean linked tasks (updatedAt == externalUpdatedAt).
    const first = await body<SyncRunRes>(
      await w.request(`/${id}/sync`, { method: 'POST', headers: J }),
    );
    expect(first.processed).toBe(3);

    const loadTask = async () =>
      (
        await db
          .select()
          .from(schema.task)
          .where(
            and(
              eq(schema.task.sourceIntegrationId, id),
              eq(schema.task.externalId, 'gtasks-task-001'),
            ),
          )
          .limit(1)
      )[0]!;

    // Edit the task locally → updatedAt bumps past the anchor, marking it dirty.
    const original = await loadTask();
    await db
      .update(schema.task)
      .set({ title: 'Edited locally' })
      .where(eq(schema.task.id, original.id));
    const dirty = await loadTask();
    expect(dirty.updatedAt.getTime()).toBeGreaterThan(dirty.externalUpdatedAt!.getTime());

    // Second sync pushes exactly that task and re-stamps it clean (anchor advanced, lastPushedAt set).
    const second = await body<SyncRunRes>(
      await w.request(`/${id}/sync`, { method: 'POST', headers: J }),
    );
    expect(second.processed).toBe(1);

    const pushed = await loadTask();
    expect(pushed.lastPushedAt).not.toBeNull();
    expect(pushed.externalUpdatedAt!.getTime()).toBeGreaterThan(
      original.externalUpdatedAt!.getTime(),
    );
    // Echo guard: clean again, so a subsequent sync neither re-pushes nor re-pulls it.
    expect(pushed.updatedAt.getTime()).toBe(pushed.externalUpdatedAt!.getTime());
    expect(pushed.title).toBe('Edited locally');

    const third = await body<SyncRunRes>(
      await w.request(`/${id}/sync`, { method: 'POST', headers: J }),
    );
    expect(third.processed).toBe(0);
  });

  it('lists the provider task lists for the per-account config UI', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const id = await seedIntegration(orgId, humanActorId, 'gtasks');
    const w = appWithActor(integrations, orgId, ['manage'], humanActorId);

    const res = await w.request(`/${id}/lists`);
    expect(res.status).toBe(200);
    const out = await body<{ resources: { id: string; title: string }[] }>(res);
    expect(out.resources.map((r) => r.id)).toContain('@default');
  });

  it('binds an account on create: many gtasks integrations per org, one per account', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const w = appWithActor(integrations, orgId, ['manage'], humanActorId);
    const connect = (externalAccountId: string) =>
      w.request('/', {
        method: 'POST',
        headers: J,
        body: JSON.stringify({ provider: 'gtasks', pattern: 'connector', externalAccountId }),
      });

    const a = await body<IntegrationRes>(await connect('google-sub-A'));
    const b = await body<IntegrationRes>(await connect('google-sub-B'));
    expect(a.id).not.toBe(b.id);

    // Reconnecting the same account is idempotent (reuses the row, keeping sourceIntegrationId stable).
    const aAgain = await body<IntegrationRes>(await connect('google-sub-A'));
    expect(aAgain.id).toBe(a.id);

    const list = await body<{ items: IntegrationRes[] }>(await w.request('/'));
    expect(list.items.filter((i) => i.provider === 'gtasks')).toHaveLength(2);
  });
});

describe('PATCH /:id emailToTask enablement', () => {
  it('seeds the default automation rules the moment email-to-task turns on (idempotent)', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const id = await seedIntegration(orgId, humanActorId, 'gmail');
    const w = appWithActor(integrations, orgId, ['manage'], humanActorId);

    const res = await w.request(`/${id}`, {
      method: 'PATCH',
      headers: J,
      body: JSON.stringify({ config: { emailToTask: { enabled: true, threshold: 50 } } }),
    });
    expect(res.status).toBe(200);

    const rules = await db
      .select()
      .from(schema.automationRule)
      .where(eq(schema.automationRule.organizationId, orgId));
    expect(rules.length).toBeGreaterThan(0);
    expect(rules.every((r) => r.isSeed)).toBe(true);

    // A second enable PATCH does not duplicate the seeds.
    await w.request(`/${id}`, {
      method: 'PATCH',
      headers: J,
      body: JSON.stringify({ config: { emailToTask: { enabled: true, threshold: 70 } } }),
    });
    const again = await db
      .select()
      .from(schema.automationRule)
      .where(eq(schema.automationRule.organizationId, orgId));
    expect(again.length).toBe(rules.length);
  });
});

/** Shape returned for a freshly-created integration, including the fields the Connections
 * surface cares about (pattern/syncMode/writeBack), not just the {@link IntegrationRes} subset
 * the CRUD tests destructure. */
interface ConnectRes {
  id: string;
  pattern: string;
  syncMode: string;
  writeBack: boolean;
}

/** Shape of a patched integration's `config`, for the teamMappings assertions below. */
interface ConfigRes {
  config: { teamMappings?: { externalTeamId: string; teamId: string }[] };
}

describe('Slice 2: Linear on the Connections surface (directory pattern flip)', () => {
  it('the 0022 data migration backfills existing linear rows from migration to connector pattern', async () => {
    // Simulate a row that predates the flip (created back when PROVIDER_DIRECTORY.linear was
    // still `migration`) — the enum itself still accepts either value, only the *directory's
    // recommendation* changed, so a raw insert with the legacy pattern is still valid.
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const [legacy] = await db
      .insert(schema.integration)
      .values({
        organizationId: orgId,
        provider: 'linear',
        pattern: 'migration',
        roles: ['work'],
        createdBy: humanActorId,
      })
      .returning({ id: schema.integration.id, pattern: schema.integration.pattern });
    expect(legacy!.pattern).toBe('migration');

    // Re-run the exact backfill statement from
    // packages/db/drizzle/0022_flip_linear_connector_pattern.sql directly against this row
    // (the full migration chain already ran it once, harmlessly, when the test DB was
    // provisioned — this proves the statement itself correctly flips a legacy row and is
    // idempotent to re-apply).
    await db.execute(
      sql`UPDATE "integration" SET "pattern" = 'connector' WHERE "provider" = 'linear'`,
    );

    const [after] = await db
      .select({ pattern: schema.integration.pattern })
      .from(schema.integration)
      .where(eq(schema.integration.id, legacy!.id));
    expect(after!.pattern).toBe('connector');
  });

  it('directory-driven create: pattern connector, syncMode mirror (DB default), writeBack false; verify → connected', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const w = appWithActor(integrations, orgId, ['manage'], humanActorId);

    // The Connections surface creates with the directory's recommended pattern and sends no
    // syncMode/writeBack, relying on server defaults — no client-side migration→mirror mapping.
    const created = await body<ConnectRes>(
      await w.request('/', {
        method: 'POST',
        headers: J,
        body: JSON.stringify({ provider: 'linear', pattern: 'connector', roles: ['work'] }),
      }),
    );
    expect(created.pattern).toBe('connector');
    // Falls out of the `integration.sync_mode` column's DB default ('mirror'), not a
    // pattern→syncMode branch in the create route — confirmed here rather than assumed.
    expect(created.syncMode).toBe('mirror');
    // Linear is deliberately excluded from WRITE_BACK_PROVIDERS this slice (its `write` OAuth
    // scope doesn't ship until Slice 3), so a directory-driven create still lands read-only.
    expect(created.writeBack).toBe(false);

    const verified = await body<IntegrationStateRes>(
      await w.request(`/${created.id}/verify`, { method: 'POST', headers: J }),
    );
    expect(verified.status).toBe('connected');
    expect(verified.lastError).toBeNull();
  });
});

describe('PATCH config.teamMappings validation', () => {
  it('accepts a valid mapping (each teamId in-org, externalTeamId unique)', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const [teamB] = await db
      .insert(schema.team)
      .values({
        organizationId: orgId,
        name: 'Team B',
        key: `TB${Math.random().toString(36).slice(2, 6)}`,
      })
      .returning({ id: schema.team.id });
    const id = await seedIntegration(orgId, humanActorId, 'linear');
    const w = appWithActor(integrations, orgId, ['manage'], humanActorId);

    const res = await w.request(`/${id}`, {
      method: 'PATCH',
      headers: J,
      body: JSON.stringify({
        config: {
          teamMappings: [
            { externalTeamId: 'ext-1', teamId },
            { externalTeamId: 'ext-2', teamId: teamB!.id },
          ],
        },
      }),
    });
    expect(res.status).toBe(200);
    const patched = await body<ConfigRes>(res);
    expect(patched.config.teamMappings).toHaveLength(2);
  });

  it('rejects a teamMappings entry whose teamId is not a team in the org (422)', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const id = await seedIntegration(orgId, humanActorId, 'linear');
    const w = appWithActor(integrations, orgId, ['manage'], humanActorId);

    const res = await w.request(`/${id}`, {
      method: 'PATCH',
      headers: J,
      body: JSON.stringify({
        config: { teamMappings: [{ externalTeamId: 'ext-1', teamId: 'not-a-real-team' }] },
      }),
    });
    expect(res.status).toBe(422);
  });

  it('rejects a teamId belonging to another org (tenant isolation)', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const other = await seedBaseOrg(db, schema);
    const id = await seedIntegration(orgId, humanActorId, 'linear');
    const w = appWithActor(integrations, orgId, ['manage'], humanActorId);

    const res = await w.request(`/${id}`, {
      method: 'PATCH',
      headers: J,
      body: JSON.stringify({
        config: { teamMappings: [{ externalTeamId: 'ext-1', teamId: other.teamId }] },
      }),
    });
    expect(res.status).toBe(422);
  });

  it('rejects duplicate externalTeamId entries within the array (422)', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const [teamB] = await db
      .insert(schema.team)
      .values({
        organizationId: orgId,
        name: 'Team B',
        key: `TB${Math.random().toString(36).slice(2, 6)}`,
      })
      .returning({ id: schema.team.id });
    const id = await seedIntegration(orgId, humanActorId, 'linear');
    const w = appWithActor(integrations, orgId, ['manage'], humanActorId);

    const res = await w.request(`/${id}`, {
      method: 'PATCH',
      headers: J,
      body: JSON.stringify({
        config: {
          teamMappings: [
            { externalTeamId: 'dup', teamId },
            { externalTeamId: 'dup', teamId: teamB!.id },
          ],
        },
      }),
    });
    expect(res.status).toBe(422);
  });

  it('a config PATCH with no teamMappings key is unaffected (no-op validation)', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const id = await seedIntegration(orgId, humanActorId, 'linear');
    const w = appWithActor(integrations, orgId, ['manage'], humanActorId);

    const res = await w.request(`/${id}`, {
      method: 'PATCH',
      headers: J,
      body: JSON.stringify({ config: { listIds: ['list-1'] } }),
    });
    expect(res.status).toBe(200);
  });
});
