import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import { appWithActor, getDb, seedBaseOrg } from './harness.test';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let integrations!: unknown;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  integrations = (await import('../../src/routes/integrations')).default;
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
  }[];
}
interface SyncJobRes {
  jobId: string;
  integrationId: string;
  status: string;
  processed: number;
  total: number;
  error: string | null;
  createdAt: string;
}

describe('integrations directory', () => {
  it('lists every connector provider with pattern/roles/category (view capability)', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const v = appWithActor(integrations, orgId, ['view']);

    const res = await v.request('/directory');
    expect(res.status).toBe(200);
    const dir = await body<DirectoryRes>(res);

    const providers = dir.providers.map((p) => p.provider).sort();
    expect(providers).toEqual(['calendar', 'drive', 'github', 'gmail', 'linear']);

    const github = dir.providers.find((p) => p.provider === 'github')!;
    expect(github.name).toBe('GitHub');
    expect(github.pattern).toBe('connector');
    expect(github.roles).toContain('code');
    expect(github.category).toBe('engineering');

    // Migration vs connector patterns are both represented (decided up front).
    const patterns = new Set(dir.providers.map((p) => p.pattern));
    expect(patterns.has('migration')).toBe(true);
    expect(patterns.has('connector')).toBe(true);
  });
});

describe('integrations sync', () => {
  it('runs the connector and records a succeeded job, readable via GET /jobs/:jobId', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const id = await seedIntegration(orgId, humanActorId, 'github');
    const w = appWithActor(integrations, orgId, ['manage'], humanActorId);

    const res = await w.request(`/${id}/sync`, { method: 'POST', headers: J });
    expect(res.status).toBe(200);
    const job = await body<SyncJobRes>(res);
    expect(job.status).toBe('succeeded');
    expect(job.integrationId).toBe(id);
    expect(job.total).toBe(1); // one fixture item per provider
    expect(job.processed).toBe(1); // first run materializes it
    expect(job.error).toBeNull();
    expect(job.jobId).toMatch(/^syncjob_/);

    // Status is retrievable (view capability suffices).
    const v = appWithActor(integrations, orgId, ['view']);
    const got = await v.request(`/jobs/${job.jobId}`);
    expect(got.status).toBe(200);
    const status = await body<SyncJobRes>(got);
    expect(status.jobId).toBe(job.jobId);
    expect(status.status).toBe('succeeded');
    expect(status.processed).toBe(1);
  });

  it('is idempotent: a second sync processes nothing already materialized', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const id = await seedIntegration(orgId, humanActorId, 'linear');
    const w = appWithActor(integrations, orgId, ['manage'], humanActorId);

    const first = await body<SyncJobRes>(
      await w.request(`/${id}/sync`, { method: 'POST', headers: J }),
    );
    expect(first.processed).toBe(1);

    const second = await body<SyncJobRes>(
      await w.request(`/${id}/sync`, { method: 'POST', headers: J }),
    );
    expect(second.total).toBe(1);
    expect(second.processed).toBe(0); // already imported, nothing new
    expect(second.status).toBe('succeeded');
    expect(second.jobId).not.toBe(first.jobId);
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
        provider: 'drive',
        pattern: 'connector',
        roles: ['context'],
        config: { teamId: 'not-a-real-team' },
        createdBy: humanActorId,
      })
      .returning({ id: schema.integration.id });

    const w = appWithActor(integrations, orgId, ['manage'], humanActorId);

    const v = await body<SyncJobRes>(
      await w.request(`/${valid!.id}/sync`, { method: 'POST', headers: J }),
    );
    expect(v.status).toBe('succeeded');
    expect(v.processed).toBe(1);

    const iv = await body<SyncJobRes>(
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

  it('409 when the org has no team to import work into', async () => {
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
    expect(res.status).toBe(409);
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

describe('integrations job status', () => {
  it('404 for an unknown job id', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const v = appWithActor(integrations, orgId, ['view']);
    expect((await v.request('/jobs/syncjob_99999999')).status).toBe(404);
  });

  it('is tenant-isolated: another org cannot read this org job', async () => {
    const a = await seedBaseOrg(db, schema);
    const b = await seedBaseOrg(db, schema);
    const id = await seedIntegration(a.orgId, a.humanActorId, 'github');

    const wA = appWithActor(integrations, a.orgId, ['manage'], a.humanActorId);
    const job = await body<SyncJobRes>(
      await wA.request(`/${id}/sync`, { method: 'POST', headers: J }),
    );

    // Org A reads it.
    expect((await wA.request(`/jobs/${job.jobId}`)).status).toBe(200);

    // Org B is hidden from it (existence-hiding 404, not 403).
    const wB = appWithActor(integrations, b.orgId, ['view'], b.humanActorId);
    expect((await wB.request(`/jobs/${job.jobId}`)).status).toBe(404);
  });
});
