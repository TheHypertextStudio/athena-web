/** Time Ledger route contract: exact intervals, personal ownership, and atomic switching. */
import type { TimeRecordOut } from '@docket/types';
import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import time from '../../src/routes/time';
import timeSubmissions from '../../src/routes/time-submissions';
import {
  addMember,
  appWithActor,
  appWithSession,
  fakeSession,
  getDb,
  seedOrg,
  seedUserWithHub,
} from '../support/routes-harness';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

async function json<T>(response: Response): Promise<T> {
  return response.json() as Promise<T>;
}

describe('Time Ledger routes', () => {
  let userId: string;
  let organizationId: string;
  let app: ReturnType<typeof appWithSession>;

  beforeEach(async () => {
    const schema = await getDb();
    userId = await seedUserWithHub(schema.db, schema, 'TimeLedger');
    organizationId = await seedOrg(schema.db, schema);
    await addMember(schema.db, schema, organizationId, userId);
    app = appWithSession(time, fakeSession(userId));
  });

  it('requires a session', async () => {
    const anonymous = appWithSession(time, null);
    expect((await anonymous.request('/active')).status).toBe(401);
  });

  it('starts a record from freeform context and publishes it as the active tracker', async () => {
    const created = await app.request('/records', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ context: { label: 'Untangle deployment access' } }),
    });
    expect(created.status).toBe(200);
    const record = await json<TimeRecordOut>(created);
    expect(record.status).toBe('open');
    expect(record.intervals).toHaveLength(1);
    expect(record.intervals[0]).toMatchObject({ actorKind: 'human', mode: 'human_active' });
    expect(record.intervals[0]?.endedAt).toBeNull();

    const active = await app.request('/active');
    expect(active.status).toBe(200);
    const body = await json<{ record: TimeRecordOut | null; serverNow: string }>(active);
    expect(body.record?.id).toBe(record.id);
    expect(new Date(body.serverNow).toString()).not.toBe('Invalid Date');
  });

  it('atomically switches human tracking without double-counting the prior record', async () => {
    const first = await json<TimeRecordOut>(
      await app.request('/records', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ context: { label: 'First thread' } }),
      }),
    );
    const second = await json<TimeRecordOut>(
      await app.request('/records', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ context: { label: 'Second thread' } }),
      }),
    );

    expect(second.status).toBe('open');
    const timeline = await json<{ items: TimeRecordOut[] }>(
      await app.request('/timeline?start=2026-01-01T00:00:00.000Z&end=2030-01-01T00:00:00.000Z'),
    );
    const refreshedFirst = timeline.items.find((item) => item.id === first.id);
    expect(refreshedFirst?.status).toBe('paused');
    expect(refreshedFirst?.intervals[0]?.endedAt).not.toBeNull();
    expect(
      timeline.items.filter((item) => item.intervals.some((i) => i.endedAt === null)),
    ).toHaveLength(1);
  });

  it('records exact reconstructed time without claiming that it was live-tracked', async () => {
    const response = await app.request('/records', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        captureSource: 'reconstructed',
        startNow: false,
        startsAt: '2026-07-12T09:00:00.000Z',
        endsAt: '2026-07-12T09:45:00.000Z',
        context: { label: 'Reconstruct support triage' },
      }),
    });
    expect(response.status).toBe(200);
    const record = await json<TimeRecordOut>(response);
    expect(record.status).toBe('closed');
    expect(record.captureSource).toBe('reconstructed');
    expect(record.intervals[0]).toMatchObject({
      source: 'reconstructed_entry',
      startedAt: '2026-07-12T09:00:00.000Z',
      endedAt: '2026-07-12T09:45:00.000Z',
    });
    expect(record.measures.humanEffortMs).toBe(45 * 60_000);
  });

  it('keeps contexts separate from reportable allocations', async () => {
    const record = await json<TimeRecordOut>(
      await app.request('/records', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ context: { label: 'Coordinate release' } }),
      }),
    );
    const contextResponse = await app.request(`/records/${record.id}/contexts`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        role: 'related',
        entityRef: {
          kind: 'calendar_event',
          source: 'google_calendar',
          externalId: 'meeting-1',
          title: 'Release meeting',
          url: null,
          docketEntityId: null,
        },
      }),
    });
    expect(contextResponse.status).toBe(200);
    const contextualized = await json<TimeRecordOut>(contextResponse);
    expect(contextualized.contexts).toHaveLength(1);
    expect(contextualized.allocations).toHaveLength(0);

    const invalidAllocation = await app.request(`/records/${record.id}/allocations`, {
      method: 'PUT',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        allocations: [{ targetKind: 'workspace', targetId: organizationId, basisPoints: 9_000 }],
      }),
    });
    expect(invalidAllocation.status).toBe(422);

    const allocated = await app.request(`/records/${record.id}/allocations`, {
      method: 'PUT',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        allocations: [{ targetKind: 'workspace', targetId: organizationId, basisPoints: 10_000 }],
      }),
    });
    expect(allocated.status).toBe(200);
    expect((await json<TimeRecordOut>(allocated)).allocations).toHaveLength(1);
  });

  it('validates Docket contexts and allocation targets against the caller’s workspace access', async () => {
    const accessible = await app.request('/records', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        context: {
          label: 'Review workspace planning',
          primaryRef: {
            kind: 'organization',
            source: 'docket',
            externalId: organizationId,
            title: 'Accessible workspace',
            url: null,
            docketEntityId: organizationId,
          },
        },
      }),
    });
    expect(accessible.status).toBe(200);
    await expect(json<TimeRecordOut>(accessible)).resolves.toEqual(
      expect.objectContaining({
        contexts: [expect.objectContaining({ organizationId })],
        allocations: [
          expect.objectContaining({
            targetKind: 'workspace',
            targetId: organizationId,
            basisPoints: 10_000,
          }),
        ],
      }),
    );

    const schema = await getDb();
    const foreignOrganizationId = await seedOrg(schema.db, schema);
    const inaccessible = await app.request('/records', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        context: {
          label: 'Should not resolve another workspace',
          primaryRef: {
            kind: 'organization',
            source: 'docket',
            externalId: foreignOrganizationId,
            title: 'Hidden workspace',
            url: null,
            docketEntityId: foreignOrganizationId,
          },
        },
      }),
    });
    expect(inaccessible.status).toBe(404);
  });

  it('redacts a Docket context snapshot after the caller loses access to its workspace', async () => {
    const created = await app.request('/records', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        startNow: false,
        startsAt: '2026-07-10T09:00:00.000Z',
        endsAt: '2026-07-10T10:00:00.000Z',
        context: {
          label: 'Private workspace review',
          primaryRef: {
            kind: 'organization',
            source: 'docket',
            externalId: organizationId,
            title: 'Workspace that is no longer visible',
            url: null,
            docketEntityId: organizationId,
          },
        },
      }),
    });
    expect(created.status).toBe(200);
    const record = await json<TimeRecordOut>(created);

    const schema = await getDb();
    await schema.db
      .delete(schema.actor)
      .where(
        and(
          eq(schema.actor.organizationId, organizationId),
          eq(schema.actor.userId, userId),
          eq(schema.actor.kind, 'human'),
        ),
      );

    const timeline = await app.request(
      '/timeline?start=2026-07-10T00:00:00.000Z&end=2026-07-11T00:00:00.000Z',
    );
    expect(timeline.status).toBe(200);
    const refreshed = (await json<{ items: TimeRecordOut[] }>(timeline)).items.find(
      (item) => item.id === record.id,
    );
    expect(refreshed?.contexts[0]).toEqual(
      expect.objectContaining({
        organizationId: null,
        entityRef: expect.objectContaining({ title: null, url: null, docketEntityId: null }),
      }),
    );
  });

  it('groups personal reflection by explicit allocation and preserves submitted snapshots', async () => {
    const record = await json<TimeRecordOut>(
      await app.request('/records', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({
          startNow: false,
          startsAt: '2026-07-10T10:00:00.000Z',
          endsAt: '2026-07-10T11:00:00.000Z',
          context: { label: 'Ship the time ledger' },
        }),
      }),
    );
    await app.request(`/records/${record.id}/allocations`, {
      method: 'PUT',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        allocations: [{ targetKind: 'workspace', targetId: organizationId, basisPoints: 10_000 }],
      }),
    });

    const breakdown = await app.request(
      '/breakdown?start=2026-07-01T00:00:00.000Z&end=2026-07-20T00:00:00.000Z&groupBy=workspace',
    );
    expect(breakdown.status).toBe(200);
    const breakdownBody = await json<{
      groupBy: string;
      buckets: { key: string; measures: { humanEffortMs: number } }[];
    }>(breakdown);
    expect(breakdownBody.groupBy).toBe('workspace');
    expect(breakdownBody.buckets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: organizationId,
          measures: expect.objectContaining({ humanEffortMs: 3_600_000 }),
        }),
      ]),
    );

    const submission = await app.request('/submissions', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        organizationId,
        periodStartsAt: '2026-07-01T00:00:00.000Z',
        periodEndsAt: '2026-07-20T00:00:00.000Z',
        timezone: 'America/Los_Angeles',
        measure: 'human_effort',
        timeRecordIds: [record.id],
      }),
    });
    expect(submission.status).toBe(200);
    const snapshot = await json<{ id: string; status: string; items: { durationMs: number }[] }>(
      submission,
    );
    expect(snapshot.status).toBe('submitted');
    expect(snapshot.items).toEqual([expect.objectContaining({ durationMs: 3_600_000 })]);
    expect((await app.request(`/submissions/${snapshot.id}`)).status).toBe(200);

    const recipient = appWithActor(timeSubmissions, organizationId, ['view']);
    const visible = await recipient.request('/');
    expect(visible.status).toBe(200);
    await expect(
      json<{ items: { hubId?: string; items: { timeRecordId?: string }[] }[] }>(visible),
    ).resolves.toEqual(
      expect.objectContaining({
        items: [
          expect.objectContaining({
            organizationId,
            items: [expect.not.objectContaining({ timeRecordId: expect.any(String) })],
          }),
        ],
      }),
    );
  });

  it('reconciles workspace breakdowns across task and workspace allocations in the same workspace', async () => {
    const schema = await getDb();
    const actor = (
      await schema.db
        .select({ id: schema.actor.id })
        .from(schema.actor)
        .where(
          and(eq(schema.actor.organizationId, organizationId), eq(schema.actor.userId, userId)),
        )
        .limit(1)
    )[0];
    if (!actor) throw new Error('member seed failed');
    const team = (
      await schema.db
        .insert(schema.team)
        .values({
          organizationId,
          name: 'Ledger',
          key: `LED${Math.random().toString(36).slice(2, 6)}`,
        })
        .returning({ id: schema.team.id })
    )[0];
    if (!team) throw new Error('team seed failed');
    const task = (
      await schema.db
        .insert(schema.task)
        .values({
          organizationId,
          teamId: team.id,
          title: 'Attribute Athena work',
          state: 'todo',
          createdBy: actor.id,
        })
        .returning({ id: schema.task.id })
    )[0];
    if (!task) throw new Error('task seed failed');
    const record = await json<TimeRecordOut>(
      await app.request('/records', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({
          startNow: false,
          startsAt: '2026-07-10T09:00:00.000Z',
          endsAt: '2026-07-10T10:00:00.000Z',
          context: { label: 'Attribute implementation work' },
        }),
      }),
    );
    const replace = await app.request(`/records/${record.id}/allocations`, {
      method: 'PUT',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        allocations: [
          { targetKind: 'task', targetId: task.id, basisPoints: 5_000 },
          { targetKind: 'workspace', targetId: organizationId, basisPoints: 5_000 },
        ],
      }),
    });
    expect(replace.status).toBe(200);

    const response = await app.request(
      '/breakdown?start=2026-07-10T00:00:00.000Z&end=2026-07-11T00:00:00.000Z&groupBy=workspace',
    );
    expect(response.status).toBe(200);
    const breakdown = await json<{
      total: { humanEffortMs: number };
      buckets: { key: string; measures: { humanEffortMs: number } }[];
    }>(response);
    const workspace = breakdown.buckets.find((bucket) => bucket.key === organizationId);
    expect(workspace?.measures.humanEffortMs).toBe(60 * 60_000);
    expect(
      breakdown.buckets.reduce((total, bucket) => total + bucket.measures.humanEffortMs, 0),
    ).toBe(breakdown.total.humanEffortMs);
  });

  it('clips reports to the requested range and preserves real elapsed wall clock under agent overlap', async () => {
    const first = await app.request('/records', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        startNow: false,
        startsAt: '2026-07-10T09:00:00.000Z',
        endsAt: '2026-07-10T11:00:00.000Z',
        context: { label: 'Morning focus' },
      }),
    });
    expect(first.status).toBe(200);
    const second = await app.request('/records', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        startNow: false,
        startsAt: '2026-07-10T10:00:00.000Z',
        endsAt: '2026-07-10T12:00:00.000Z',
        context: { label: 'Parallel delivery' },
      }),
    });
    expect(second.status).toBe(200);

    const summary = await app.request(
      '/summary?start=2026-07-10T10:00:00.000Z&end=2026-07-10T11:30:00.000Z',
    );
    expect(summary.status).toBe(200);
    await expect(json<{ elapsedMs: number; humanEffortMs: number }>(summary)).resolves.toEqual(
      expect.objectContaining({
        // The records overlap: elapsed is wall-clock union, while human effort is the sum of
        // each exact in-range interval (one hour plus ninety minutes).
        elapsedMs: 90 * 60_000,
        humanEffortMs: 150 * 60_000,
      }),
    );

    const timeline = await app.request(
      '/timeline?start=2026-07-10T10:00:00.000Z&end=2026-07-10T11:30:00.000Z',
    );
    expect(timeline.status).toBe(200);
    await expect(json<{ items: TimeRecordOut[] }>(timeline)).resolves.toEqual(
      expect.objectContaining({
        items: expect.arrayContaining([
          expect.objectContaining({
            measures: expect.objectContaining({ humanEffortMs: 60 * 60_000 }),
          }),
          expect.objectContaining({
            measures: expect.objectContaining({ humanEffortMs: 90 * 60_000 }),
          }),
        ]),
      }),
    );
  });
});
