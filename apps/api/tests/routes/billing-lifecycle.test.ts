import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';
import { eq } from 'drizzle-orm';

import { appWithActor, getDb, seedBaseOrg } from '../support/routes-harness';
import type billingRouter from '../../src/routes/billing';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let billing!: typeof billingRouter;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  billing = (await import('../../src/routes/billing')).default;
});

/** Parse a JSON response body as the given shape. */
async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

/** Read an org's lifecycle columns straight from the db (bypassing the route). */
async function lifecycleOf(
  orgId: string,
): Promise<{ state: string; exportReadyAt: Date | null; deleteAfterAt: Date | null }> {
  const rows = await db
    .select({
      state: schema.organization.lifecycleState,
      exportReadyAt: schema.organization.exportReadyAt,
      deleteAfterAt: schema.organization.deleteAfterAt,
    })
    .from(schema.organization)
    .where(eq(schema.organization.id, orgId))
    .limit(1);
  return rows[0]!;
}

// A valid ULID-shaped id that no seeded row uses (a path-level org id mismatch).
const MISSING_ULID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';

describe('billing lifecycle: GET /lifecycle', () => {
  it('returns the org lifecycle status (active, no timestamps) for a member', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const app = appWithActor(billing, orgId, ['view']);
    const res = await app.request('/lifecycle', { method: 'GET' });
    expect(res.status).toBe(200);
    const body = await json<{
      organizationId: string;
      lifecycleState: string;
      exportReadyAt: string | null;
      deleteAfterAt: string | null;
    }>(res);
    expect(body.organizationId).toBe(orgId);
    expect(body.lifecycleState).toBe('active');
    expect(body.exportReadyAt).toBeNull();
    expect(body.deleteAfterAt).toBeNull();
  });

  it('404s when the actor-context org row does not exist', async () => {
    const app = appWithActor(billing, MISSING_ULID, ['view']);
    const res = await app.request('/lifecycle', { method: 'GET' });
    expect(res.status).toBe(404);
  });
});

describe('billing lifecycle: POST /lifecycle/start-export-window', () => {
  it('opens the export window with both lifecycle timestamps stamped', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const app = appWithActor(billing, orgId, ['manage']);
    const res = await app.request('/lifecycle/start-export-window', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await json<{
      lifecycleState: string;
      exportReadyAt: string | null;
      deleteAfterAt: string | null;
    }>(res);
    expect(body.lifecycleState).toBe('export_window');
    expect(body.exportReadyAt).not.toBeNull();
    expect(body.deleteAfterAt).not.toBeNull();
    // deleteAfterAt is ~14 days after exportReadyAt.
    const delta = new Date(body.deleteAfterAt!).getTime() - new Date(body.exportReadyAt!).getTime();
    expect(delta).toBe(14 * 24 * 60 * 60 * 1000);

    const persisted = await lifecycleOf(orgId);
    expect(persisted.state).toBe('export_window');
    expect(persisted.deleteAfterAt).not.toBeNull();
  });

  it('is denied (403) for a member without manage', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const app = appWithActor(billing, orgId, ['contribute']);
    const res = await app.request('/lifecycle/start-export-window', { method: 'POST' });
    expect(res.status).toBe(403);
    // The org must remain untouched.
    expect((await lifecycleOf(orgId)).state).toBe('active');
  });

  it('404s when the org does not exist', async () => {
    const app = appWithActor(billing, MISSING_ULID, ['manage']);
    const res = await app.request('/lifecycle/start-export-window', { method: 'POST' });
    expect(res.status).toBe(404);
  });
});

describe('billing lifecycle: POST /lifecycle/reactivate', () => {
  it('rescues an org out of the export window back to active and clears timestamps', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    // Put the org into the export window directly.
    await db
      .update(schema.organization)
      .set({
        lifecycleState: 'export_window',
        exportReadyAt: new Date(),
        deleteAfterAt: new Date(Date.now() + 1000),
      })
      .where(eq(schema.organization.id, orgId));

    const app = appWithActor(billing, orgId, ['manage']);
    const res = await app.request('/lifecycle/reactivate', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await json<{
      lifecycleState: string;
      exportReadyAt: string | null;
      deleteAfterAt: string | null;
    }>(res);
    expect(body.lifecycleState).toBe('active');
    expect(body.exportReadyAt).toBeNull();
    expect(body.deleteAfterAt).toBeNull();

    const persisted = await lifecycleOf(orgId);
    expect(persisted.state).toBe('active');
    expect(persisted.exportReadyAt).toBeNull();
  });

  it('is denied (403) for a member without manage', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const app = appWithActor(billing, orgId, ['view']);
    const res = await app.request('/lifecycle/reactivate', { method: 'POST' });
    expect(res.status).toBe(403);
  });
});

describe('billing: POST /export', () => {
  it('generates a downloadable archive of the org work layer and stamps exportReadyAt', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    // Seed a couple of work-layer rows so the archive is non-trivial.
    await db.insert(schema.initiative).values({
      organizationId: orgId,
      name: 'Q3 Goals',
      createdBy: humanActorId,
    });
    await db.insert(schema.task).values({
      organizationId: orgId,
      teamId,
      title: 'Ship export',
      state: 'todo',
      createdBy: humanActorId,
    });

    const app = appWithActor(billing, orgId, ['manage']);
    const res = await app.request('/export', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await json<{ downloadUrl: string; expiresAt: string }>(res);
    expect(body.downloadUrl).toMatch(/^(file|https?):\/\//);
    // expiresAt is in the future.
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now());

    // exportReadyAt is stamped on the org.
    const persisted = await lifecycleOf(orgId);
    expect(persisted.exportReadyAt).not.toBeNull();
  });

  it('only includes the calling org rows (tenant isolation)', async () => {
    const a = await seedBaseOrg(db, schema);
    const b = await seedBaseOrg(db, schema);
    // A task in org B that must NOT appear in org A's export.
    await db.insert(schema.task).values({
      organizationId: b.orgId,
      teamId: b.teamId,
      title: 'Other org secret',
      state: 'todo',
      createdBy: b.humanActorId,
    });
    // A task in org A that MUST appear.
    await db.insert(schema.task).values({
      organizationId: a.orgId,
      teamId: a.teamId,
      title: 'My org task',
      state: 'todo',
      createdBy: a.humanActorId,
    });

    const app = appWithActor(billing, a.orgId, ['manage']);
    const res = await app.request('/export', { method: 'POST' });
    expect(res.status).toBe(200);
    const { downloadUrl } = await json<{ downloadUrl: string }>(res);

    // Read the stored artifact back off disk (the test/local blob is LocalDiskBlob,
    // which addresses artifacts with file:// URLs) and verify tenant isolation.
    const archive = await readArtifact(downloadUrl);
    expect(archive).toContain('My org task');
    expect(archive).not.toContain('Other org secret');
  });

  it('is denied (403) for a member without manage', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const app = appWithActor(billing, orgId, ['contribute']);
    const res = await app.request('/export', { method: 'POST' });
    expect(res.status).toBe(403);
  });

  it('404s when the actor-context org row does not exist', async () => {
    const app = appWithActor(billing, MISSING_ULID, ['manage']);
    const res = await app.request('/export', { method: 'POST' });
    expect(res.status).toBe(404);
  });
});

/** Read a `file://` export artifact's text contents directly off disk. */
async function readArtifact(fileUrl: string): Promise<string> {
  const { readFile } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  return readFile(fileURLToPath(fileUrl), 'utf8');
}
