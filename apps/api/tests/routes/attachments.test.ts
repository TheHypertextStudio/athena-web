import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';
import type { AttachmentOut } from '@docket/types';

import { appWithActor, getDb, one, seedBaseOrg } from './harness.test';
import type { attachmentRoutes as attachmentRouter } from '../../src/routes/attachment-routes';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let attachments!: typeof attachmentRouter;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  attachments = (await import('../../src/routes/attachment-routes')).attachmentRoutes;
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
});
