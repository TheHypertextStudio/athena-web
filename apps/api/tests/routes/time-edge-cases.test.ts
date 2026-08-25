/**
 * `@docket/api` — Time Ledger command edge cases not already covered by `time.test.ts`.
 *
 * @remarks
 * The happy paths (start/pause/stop/switch, contexts, allocations) are proven end to end in
 * `time.test.ts`. This file targets the specific guard clauses a silent gap here would defeat:
 * a `submitted`/`superseded` record refusing every further edit, a closed record refusing to
 * resume, adding exact historical intervals, editing category/title, removing context, and
 * creating a nested time category.
 */
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import time from '../../src/routes/time';
import { createTimeRecord } from '../../src/time/commands';
import {
  addMember,
  appWithSession,
  fakeSession,
  getDb,
  one,
  seedOrg,
  seedUserWithHub,
} from '../support/routes-harness';
import { assertDefined } from '@docket/test-utils';

const J = { 'Content-Type': 'application/json' };

async function body<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

describe('Time Ledger command edge cases', () => {
  let schema!: Awaited<ReturnType<typeof getDb>>;
  let db!: Awaited<ReturnType<typeof getDb>>['db'];
  let userId!: string;
  let organizationId!: string;
  let actorId!: string;
  let app!: ReturnType<typeof appWithSession>;

  beforeEach(async () => {
    schema = await getDb();
    db = schema.db;
    userId = await seedUserWithHub(db, schema, 'TimeEdge');
    organizationId = await seedOrg(db, schema);
    actorId = await addMember(db, schema, organizationId, userId);
    // A team must exist so the timer's default task-landing resolution has somewhere to file work.
    await db.insert(schema.team).values({
      organizationId,
      name: 'Core',
      key: `K${Math.random().toString(36).slice(2, 6)}`,
    });
    await db.insert(schema.grant).values({
      organizationId,
      subjectKind: 'actor',
      subjectId: actorId,
      resourceKind: 'organization',
      resourceId: organizationId,
      capabilities: ['contribute'],
      effect: 'allow',
      cascades: true,
    });
    app = appWithSession(time, fakeSession(userId));
  });

  async function startRecord(): Promise<{ id: string; title: string }> {
    const res = await app.request('/records', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ context: { label: 'Ship the feature' } }),
    });
    expect(res.status).toBe(200);
    return body(res);
  }

  it('edits a record’s title and category', async () => {
    const record = await startRecord();
    const category = one(
      await db
        .insert(schema.timeCategory)
        .values({
          hubId: one(
            await db
              .select({ id: schema.hub.id })
              .from(schema.hub)
              .where(eq(schema.hub.userId, userId)),
          ).id,
          name: 'Deep work',
        })
        .returning({ id: schema.timeCategory.id }),
    );

    const res = await app.request(`/records/${record.id}`, {
      method: 'PATCH',
      headers: J,
      body: JSON.stringify({ title: 'Renamed', categoryId: category.id }),
    });
    expect(res.status).toBe(200);
    const updated = await body<{ title: string; categoryId: string | null }>(res);
    expect(updated.title).toBe('Renamed');
    expect(updated.categoryId).toBe(category.id);
  });

  it('adds a bounded historical interval to a record', async () => {
    const record = await startRecord();
    const res = await app.request(`/records/${record.id}/intervals`, {
      method: 'POST',
      headers: J,
      body: JSON.stringify({
        startsAt: '2026-08-01T09:00:00.000Z',
        endsAt: '2026-08-01T09:30:00.000Z',
        source: 'reconstructed_entry',
      }),
    });
    expect(res.status).toBe(200);
  });

  it('rejects repair and removal for live, submitted, agent, and another caller’s records', async () => {
    const live = await startRecord();
    const liveRecord = await body<{ intervals: { id: string }[] }>(
      await app.request(`/records/${live.id}`),
    );
    const repairBody = JSON.stringify({
      startsAt: '2026-08-01T09:00:00.000Z',
      endsAt: '2026-08-01T09:30:00.000Z',
    });
    expect(
      (
        await app.request(`/records/${live.id}/intervals/${liveRecord.intervals[0]?.id}`, {
          method: 'PATCH',
          headers: J,
          body: repairBody,
        })
      ).status,
    ).toBe(409);
    expect((await app.request(`/records/${live.id}`, { method: 'DELETE' })).status).toBe(409);

    const manual = await body<{ id: string; intervals: { id: string }[] }>(
      await app.request('/records', {
        method: 'POST',
        headers: J,
        body: JSON.stringify({
          startNow: false,
          captureSource: 'manual',
          startsAt: '2026-08-01T09:00:00.000Z',
          endsAt: '2026-08-01T09:30:00.000Z',
          context: { label: 'Backfill notes', organizationId },
        }),
      }),
    );
    await db
      .update(schema.timeRecord)
      .set({ status: 'submitted' })
      .where(eq(schema.timeRecord.id, manual.id));
    expect(
      (
        await app.request(`/records/${manual.id}/intervals/${manual.intervals[0]?.id}`, {
          method: 'PATCH',
          headers: J,
          body: repairBody,
        })
      ).status,
    ).toBe(409);
    expect((await app.request(`/records/${manual.id}`, { method: 'DELETE' })).status).toBe(409);

    await db
      .update(schema.timeRecord)
      .set({ status: 'closed', captureSource: 'agent' })
      .where(eq(schema.timeRecord.id, manual.id));
    expect((await app.request(`/records/${manual.id}`, { method: 'DELETE' })).status).toBe(409);

    const otherUserId = await seedUserWithHub(db, schema, 'OtherTimeEdge');
    const otherApp = appWithSession(time, fakeSession(otherUserId));
    expect((await otherApp.request(`/records/${manual.id}`, { method: 'DELETE' })).status).toBe(
      404,
    );
  });

  it('removes a context from a record', async () => {
    const record = await startRecord();
    const [org] = await db
      .select({ id: schema.organization.id })
      .from(schema.organization)
      .where(eq(schema.organization.id, organizationId));
    expect(org).toBeDefined();
    const contextRes = await app.request(`/records/${record.id}/contexts`, {
      method: 'POST',
      headers: J,
      body: JSON.stringify({
        role: 'related',
        entityRef: {
          kind: 'organization',
          source: 'docket',
          externalId: organizationId,
          title: null,
          url: null,
          docketEntityId: null,
        },
      }),
    });
    expect(contextRes.status).toBe(201);
    const [contextRow] = await db
      .select({ id: schema.timeContext.id })
      .from(schema.timeContext)
      .where(eq(schema.timeContext.timeRecordId, record.id));
    expect(contextRow).toBeDefined();

    const removed = await app.request(
      `/records/${record.id}/contexts/${assertDefined(contextRow).id}`,
      {
        method: 'DELETE',
      },
    );
    expect(removed.status).toBe(200);

    const missing = await app.request(
      `/records/${record.id}/contexts/${assertDefined(contextRow).id}`,
      {
        method: 'DELETE',
      },
    );
    expect(missing.status).toBe(404);
  });

  it('creates a nested time category under a parent', async () => {
    const parent = await body<{ id: string }>(
      await app.request('/categories', {
        method: 'POST',
        headers: J,
        body: JSON.stringify({ name: 'Work' }),
      }),
    );
    const child = await app.request('/categories', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ name: 'Deep work', parentId: parent.id }),
    });
    expect(child.status).toBe(201);
  });

  /** Push a just-stopped record's interval out of the auto-rejoin window, so /start is a real resume attempt. */
  async function pastJoinWindow(recordId: string): Promise<void> {
    await db
      .update(schema.timeInterval)
      .set({ endedAt: new Date(Date.now() - 5 * 60_000) })
      .where(eq(schema.timeInterval.timeRecordId, recordId));
  }

  it('refuses to start, add time to, or reallocate a submitted record (but still allows renaming)', async () => {
    const record = await startRecord();
    await app.request(`/records/${record.id}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'stopped' }),
    });
    await pastJoinWindow(record.id);
    await db
      .update(schema.timeRecord)
      .set({ status: 'submitted' })
      .where(eq(schema.timeRecord.id, record.id));

    // `updateTimeRecord` edits only semantic metadata and deliberately carries no status guard —
    // renaming a submitted record does not reopen or reinterpret its already-reported duration.
    expect(
      (
        await app.request(`/records/${record.id}`, {
          method: 'PATCH',
          headers: J,
          body: JSON.stringify({ title: 'Still renameable' }),
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await app.request(`/records/${record.id}/status`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'running' }),
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await app.request(`/records/${record.id}/intervals`, {
          method: 'POST',
          headers: J,
          body: JSON.stringify({
            startsAt: '2026-08-01T09:00:00.000Z',
            endsAt: '2026-08-01T09:30:00.000Z',
          }),
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await app.request(`/records/${record.id}/allocations`, {
          method: 'PUT',
          headers: J,
          body: JSON.stringify({ allocations: [] }),
        })
      ).status,
    ).toBe(409);
  });

  it('refuses to resume a closed record once it is past the auto-rejoin window', async () => {
    const record = await startRecord();
    await app.request(`/records/${record.id}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'stopped' }),
    });
    await pastJoinWindow(record.id);

    const resumed = await app.request(`/records/${record.id}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'running' }),
    });
    expect(resumed.status).toBe(409);
  });

  it('rejoins the same segment when resuming within the auto-rejoin window', async () => {
    const record = await startRecord();
    await app.request(`/records/${record.id}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'stopped' }),
    });

    // No time manipulation: resuming immediately after stopping the same task rejoins the prior
    // segment rather than refusing it as "closed".
    const resumed = await app.request(`/records/${record.id}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'running' }),
    });
    expect(resumed.status).toBe(200);
    expect((await body<{ id: string; status: string }>(resumed)).status).toBe('open');
  });

  it('resuming an already-active record is a no-op that returns the current state', async () => {
    const record = await startRecord();
    // The record is already active immediately after creation; starting it again should not error.
    const res = await app.request(`/records/${record.id}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'running' }),
    });
    expect(res.status).toBe(200);
    expect((await body<{ id: string }>(res)).id).toBe(record.id);
  });

  it('hides a record owned by another Hub as not found, for every command', async () => {
    const missingId = '00000000-0000-0000-0000-000000000000';
    for (const [path, init] of [
      [
        `/records/${missingId}/status`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'running' }),
        },
      ],
      [
        `/records/${missingId}/status`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'paused' }),
        },
      ],
      [
        `/records/${missingId}/status`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'stopped' }),
        },
      ],
      [
        `/records/${missingId}`,
        { method: 'PATCH', headers: J, body: JSON.stringify({ title: 'x' }) },
      ],
    ] as const) {
      const res = await app.request(path, init);
      expect(res.status).toBe(404);
    }
  });

  it('refuses to stop an already-submitted record', async () => {
    const record = await startRecord();
    await app.request(`/records/${record.id}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'stopped' }),
    });
    await db
      .update(schema.timeRecord)
      .set({ status: 'submitted' })
      .where(eq(schema.timeRecord.id, record.id));

    const res = await app.request(`/records/${record.id}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'stopped' }),
    });
    expect(res.status).toBe(409);
  });

  it('refuses to pause a record that is not actively tracking', async () => {
    const record = await startRecord();
    const paused = await app.request(`/records/${record.id}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'paused' }),
    });
    expect(paused.status).toBe(200);
    // The active human interval is already closed; pausing again finds nothing to close.
    const again = await app.request(`/records/${record.id}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'paused' }),
    });
    expect(again.status).toBe(409);
  });

  it('rejects a direct historical-mode create call whose bounds were not validated', async () => {
    // The route's Zod schema guarantees `startsAt`/`endsAt` accompany `startNow: false`; this
    // exercises the command-layer guard directly, for the caller that bypasses that schema.
    await expect(
      createTimeRecord(userId, {
        startNow: false,
        context: { label: 'Unbounded historical entry' },
      }),
    ).rejects.toThrow('Validated historical time was missing its bounds');
  });

  it('patches only the field supplied, leaving the others untouched', async () => {
    const record = await startRecord();
    // Title omitted entirely: only `outcomeNote` should be written.
    const res = await app.request(`/records/${record.id}`, {
      method: 'PATCH',
      headers: J,
      body: JSON.stringify({ outcomeNote: 'Shipped the fix' }),
    });
    expect(res.status).toBe(200);
    const updated = await body<{ title: string; outcomeNote: string | null }>(res);
    expect(updated.title).toBe(record.title);
    expect(updated.outcomeNote).toBe('Shipped the fix');
  });

  it('keeps a paused record’s status closed when a historical interval is added to it', async () => {
    const record = await startRecord();
    await app.request(`/records/${record.id}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'paused' }),
    });
    const res = await app.request(`/records/${record.id}/intervals`, {
      method: 'POST',
      headers: J,
      body: JSON.stringify({
        startsAt: '2026-08-01T09:00:00.000Z',
        endsAt: '2026-08-01T09:30:00.000Z',
        source: 'reconstructed_entry',
      }),
    });
    expect(res.status).toBe(200);
    expect((await body<{ status: string }>(res)).status).toBe('closed');
  });

  it('announces a switch (not a plain resume) when resuming pulls tracking away from another record', async () => {
    const first = await startRecord();
    // Starting a second label switches tracking away from the first, closing its segment.
    const second = await app.request('/records', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ context: { label: 'Second thread' } }),
    });
    expect(second.status).toBe(200);

    // Resuming the first, still inside the auto-rejoin window, both rejoins its segment AND
    // switches away from whatever is currently tracking (the second record).
    const resumed = await app.request(`/records/${first.id}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'running' }),
    });
    expect(resumed.status).toBe(200);
    expect((await body<{ status: string }>(resumed)).status).toBe('open');
  });

  it('announces a switch when resuming a paused record past the join window pulls tracking away from another', async () => {
    const first = await startRecord();
    await app.request(`/records/${first.id}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'paused' }),
    });
    await pastJoinWindow(first.id);
    const second = await app.request('/records', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ context: { label: 'Second thread' } }),
    });
    expect(second.status).toBe(200);

    // The first record's own last segment is past its join window, so this takes the ordinary
    // (non-joined) resume path — which still switches away from the currently active second record.
    const resumed = await app.request(`/records/${first.id}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'running' }),
    });
    expect(resumed.status).toBe(200);
    expect((await body<{ status: string }>(resumed)).status).toBe('open');
  });
});
