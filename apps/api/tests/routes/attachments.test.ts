import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';
import type { AttachmentOut } from '@docket/types';

import { appWithActor, getDb, one, seedBaseOrg } from './harness.test';
import type { attachmentRoutes as attachmentRouter } from '../../src/routes/attachment-routes';
import type * as ContainerModule from '../../src/container';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let attachments!: typeof attachmentRouter;
// Imported dynamically (after the harness sets `SKIP_ENV_VALIDATION`) so loading the container
// doesn't trip fail-fast env validation at module load.
let getContainer!: typeof ContainerModule.getContainer;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  attachments = (await import('../../src/routes/attachment-routes')).attachmentRoutes;
  getContainer = (await import('../../src/container')).getContainer;
});

const MISSING = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const J = { 'content-type': 'application/json' };

async function body<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

interface Page<T> {
  items: T[];
}

/** A fresh org with a team, a human actor, and one task to attach to. */
async function seedOrgWithTask(): Promise<{
  orgId: string;
  teamId: string;
  humanActorId: string;
  taskId: string;
}> {
  const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
  const task = one(
    await db
      .insert(schema.task)
      .values({
        organizationId: orgId,
        teamId,
        title: 'Host task',
        state: 'todo',
        createdBy: humanActorId,
      })
      .returning({ id: schema.task.id }),
  );
  return { orgId, teamId, humanActorId, taskId: task.id };
}

/** POST a url attachment onto a task. */
async function createUrl(
  app: ReturnType<typeof appWithActor>,
  taskId: string,
  payload: Record<string, unknown> = {},
) {
  return app.request(`/${taskId}/attachments`, {
    method: 'POST',
    headers: J,
    body: JSON.stringify({
      kind: 'url',
      title: 'Docket',
      url: 'https://docket.example.com/x',
      ...payload,
    }),
  });
}

/** Build an in-memory file of `size` bytes (filled with `0x61`) with the given name/type. */
function fileOfSize(name: string, size: number, type = 'text/plain'): File {
  return new File([new Uint8Array(size).fill(0x61)], name, { type });
}

/** POST a multipart file upload onto a task. */
async function uploadFile(
  app: ReturnType<typeof appWithActor>,
  taskId: string,
  file: File,
  title?: string,
) {
  const form = new FormData();
  form.set('file', file);
  if (title !== undefined) form.set('title', title);
  return app.request(`/${taskId}/attachments/upload`, { method: 'POST', body: form });
}

/** The deterministic blob key an uploaded attachment is stored under. */
function blobKeyFor(orgId: string, attachmentId: string): string {
  return `attachments/${orgId}/${attachmentId}`;
}

describe('attachment routes', () => {
  it('creates a url attachment on a task with subject derived from the route', async () => {
    const { orgId, humanActorId, taskId } = await seedOrgWithTask();
    const w = appWithActor(attachments, orgId, ['contribute'], humanActorId);

    const res = await createUrl(w, taskId);
    expect(res.status).toBe(200);
    const created = await body<AttachmentOut>(res);
    expect(created.kind).toBe('url');
    expect(created.subjectType).toBe('task');
    expect(created.subjectId).toBe(taskId);
    expect(created.url).toBe('https://docket.example.com/x');
    expect(created.organizationId).toBe(orgId);
    expect(created.sourceIntegrationId).toBeNull();
    expect(created.externalId).toBeNull();
    expect(created.fileName).toBeNull();
    expect(created.mimeType).toBeNull();
    expect(created.byteSize).toBeNull();
  });

  it('lists attachments for a task, scoped to that task', async () => {
    const { orgId, humanActorId, taskId } = await seedOrgWithTask();
    const other = await seedOrgWithTask();
    const w = appWithActor(attachments, orgId, ['contribute'], humanActorId);

    await createUrl(w, taskId, { title: 'one' });
    await createUrl(w, taskId, { title: 'two' });
    // Attachment on a different task must not appear.
    const wOther = appWithActor(attachments, other.orgId, ['contribute'], other.humanActorId);
    await createUrl(wOther, other.taskId, { title: 'elsewhere' });

    const page = await body<Page<AttachmentOut>>(await w.request(`/${taskId}/attachments`));
    expect(page.items).toHaveLength(2);
    expect(page.items.every((a) => a.subjectId === taskId)).toBe(true);
  });

  it('rejects a url attachment with no url (422)', async () => {
    const { orgId, humanActorId, taskId } = await seedOrgWithTask();
    const w = appWithActor(attachments, orgId, ['contribute'], humanActorId);
    const res = await w.request(`/${taskId}/attachments`, {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ kind: 'url', title: 'no url' }),
    });
    expect(res.status).toBe(422);
  });

  it('404s when attaching to a task that does not exist', async () => {
    const { orgId, humanActorId } = await seedOrgWithTask();
    const w = appWithActor(attachments, orgId, ['contribute'], humanActorId);
    expect((await createUrl(w, MISSING)).status).toBe(404);
  });

  it('removes an attachment and 404s on a second delete', async () => {
    const { orgId, humanActorId, taskId } = await seedOrgWithTask();
    const w = appWithActor(attachments, orgId, ['contribute'], humanActorId);
    const created = await body<AttachmentOut>(await createUrl(w, taskId));

    const del = await w.request(`/${taskId}/attachments/${created.id}`, { method: 'DELETE' });
    expect(del.status).toBe(200);
    expect(await body<{ id: string; removed: boolean }>(del)).toEqual({
      id: created.id,
      removed: true,
    });

    expect(
      (await body<Page<AttachmentOut>>(await w.request(`/${taskId}/attachments`))).items,
    ).toHaveLength(0);
    expect(
      (await w.request(`/${taskId}/attachments/${created.id}`, { method: 'DELETE' })).status,
    ).toBe(404);
  });

  it('enforces the `contribute` capability on mutations (403) but allows reads', async () => {
    const { orgId, humanActorId, taskId } = await seedOrgWithTask();
    const writer = appWithActor(attachments, orgId, ['contribute'], humanActorId);
    const created = await body<AttachmentOut>(await createUrl(writer, taskId));

    const viewer = appWithActor(attachments, orgId, ['view'], humanActorId);
    expect((await createUrl(viewer, taskId)).status).toBe(403);
    expect(
      (await viewer.request(`/${taskId}/attachments/${created.id}`, { method: 'DELETE' })).status,
    ).toBe(403);
    expect((await viewer.request(`/${taskId}/attachments`)).status).toBe(200);
  });

  it('isolates by tenant: another org cannot see or delete attachments', async () => {
    const a = await seedOrgWithTask();
    const wa = appWithActor(attachments, a.orgId, ['contribute'], a.humanActorId);
    const created = await body<AttachmentOut>(await createUrl(wa, a.taskId));

    const b = await seedOrgWithTask();
    const wb = appWithActor(attachments, b.orgId, ['contribute'], b.humanActorId);
    // Org B cannot even address org A's task (task load 404s before the attachment is reached).
    expect((await wb.request(`/${a.taskId}/attachments`)).status).toBe(404);
    expect(
      (await wb.request(`/${a.taskId}/attachments/${created.id}`, { method: 'DELETE' })).status,
    ).toBe(404);
  });

  it("creates an email attachment when sourceIntegrationId belongs to the caller's own org", async () => {
    const { orgId, humanActorId, taskId } = await seedOrgWithTask();
    const integrationRow = one(
      await db
        .insert(schema.integration)
        .values({
          organizationId: orgId,
          provider: 'gmail',
          pattern: 'connector',
          roles: ['signal'],
          createdBy: humanActorId,
        })
        .returning({ id: schema.integration.id }),
    );
    const w = appWithActor(attachments, orgId, ['contribute'], humanActorId);
    const res = await w.request(`/${taskId}/attachments`, {
      method: 'POST',
      headers: J,
      body: JSON.stringify({
        kind: 'email',
        title: 'Interview thread',
        sourceIntegrationId: integrationRow.id,
        externalId: 'thread_xyz',
      }),
    });
    expect(res.status).toBe(200);
    const created = await body<AttachmentOut>(res);
    expect(created.sourceIntegrationId).toBe(integrationRow.id);
  });

  it('404s an email attachment whose sourceIntegrationId belongs to a different org', async () => {
    // Regression test: a caller must not be able to point a task's email attachment at another
    // org's integration — that integration id later flows into automation mail actions, which
    // would then act on the victim org's real mailbox using the victim's OAuth grant.
    const victim = await seedOrgWithTask();
    const victimIntegration = one(
      await db
        .insert(schema.integration)
        .values({
          organizationId: victim.orgId,
          provider: 'gmail',
          pattern: 'connector',
          roles: ['signal'],
          createdBy: victim.humanActorId,
        })
        .returning({ id: schema.integration.id }),
    );

    const attacker = await seedOrgWithTask();
    const w = appWithActor(attachments, attacker.orgId, ['contribute'], attacker.humanActorId);
    const res = await w.request(`/${attacker.taskId}/attachments`, {
      method: 'POST',
      headers: J,
      body: JSON.stringify({
        kind: 'email',
        title: 'Interview thread',
        sourceIntegrationId: victimIntegration.id,
        externalId: 'thread_xyz',
      }),
    });
    expect(res.status).toBe(404);
  });

  it('uploads a file: stores the bytes and records file metadata', async () => {
    const { orgId, humanActorId, taskId } = await seedOrgWithTask();
    const w = appWithActor(attachments, orgId, ['contribute'], humanActorId);

    const res = await uploadFile(w, taskId, fileOfSize('notes.txt', 12));
    expect(res.status).toBe(200);
    const created = await body<AttachmentOut>(res);
    expect(created.kind).toBe('file');
    expect(created.subjectId).toBe(taskId);
    expect(created.fileName).toBe('notes.txt');
    expect(created.mimeType).toBe('text/plain');
    expect(created.byteSize).toBe(12);
    // Title defaults to the filename when omitted.
    expect(created.title).toBe('notes.txt');
    // The bytes are in the blob store under the deterministic key.
    const stored = await getContainer().blob.get(blobKeyFor(orgId, created.id));
    expect(stored?.length).toBe(12);
  });

  it('uses an explicit title over the filename when provided', async () => {
    const { orgId, humanActorId, taskId } = await seedOrgWithTask();
    const w = appWithActor(attachments, orgId, ['contribute'], humanActorId);
    const created = await body<AttachmentOut>(
      await uploadFile(w, taskId, fileOfSize('raw.bin', 4, 'application/octet-stream'), 'Design'),
    );
    expect(created.title).toBe('Design');
  });

  it('downloads a file attachment as raw bytes with a content-typed attachment disposition', async () => {
    const { orgId, humanActorId, taskId } = await seedOrgWithTask();
    const w = appWithActor(attachments, orgId, ['contribute'], humanActorId);
    const created = await body<AttachmentOut>(
      await uploadFile(w, taskId, fileOfSize('report.txt', 7)),
    );

    const dl = await w.request(`/${taskId}/attachments/${created.id}/download`);
    expect(dl.status).toBe(200);
    expect(dl.headers.get('content-type')).toBe('text/plain');
    expect(dl.headers.get('content-disposition')).toContain("filename*=UTF-8''report.txt");
    expect(new Uint8Array(await dl.arrayBuffer())).toHaveLength(7);
  });

  it('deletes a file attachment and cleans up its blob', async () => {
    const { orgId, humanActorId, taskId } = await seedOrgWithTask();
    const w = appWithActor(attachments, orgId, ['contribute'], humanActorId);
    const created = await body<AttachmentOut>(
      await uploadFile(w, taskId, fileOfSize('gone.txt', 5)),
    );
    const key = blobKeyFor(orgId, created.id);
    expect(await getContainer().blob.get(key)).not.toBeNull();

    const del = await w.request(`/${taskId}/attachments/${created.id}`, { method: 'DELETE' });
    expect(del.status).toBe(200);
    // The blob is removed, and the download route 404s now the row is gone.
    expect(await getContainer().blob.get(key)).toBeNull();
    expect((await w.request(`/${taskId}/attachments/${created.id}/download`)).status).toBe(404);
  });

  it('rejects an over-limit upload (422)', async () => {
    const { orgId, humanActorId, taskId } = await seedOrgWithTask();
    const w = appWithActor(attachments, orgId, ['contribute'], humanActorId);
    const tooBig = fileOfSize('huge.bin', 4 * 1024 * 1024 + 1, 'application/octet-stream');
    expect((await uploadFile(w, taskId, tooBig)).status).toBe(422);
  });

  it('requires `contribute` to upload (403 for a viewer)', async () => {
    const { orgId, humanActorId, taskId } = await seedOrgWithTask();
    const viewer = appWithActor(attachments, orgId, ['view'], humanActorId);
    expect((await uploadFile(viewer, taskId, fileOfSize('x.txt', 3))).status).toBe(403);
  });
});
