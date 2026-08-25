/** Time Ledger route contract: exact segments, task anchoring, personal ownership, switching. */
import type { TimeRecordOut } from '@docket/types';
import { and, asc, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import time from '../../src/routes/time';
import timeSubmissions from '../../src/routes/time-submissions';
import type { StatusIdLookup } from '../support/routes-harness';
import {
  addMember,
  appWithActor,
  appWithSession,
  fakeSession,
  getDb,
  one,
  seedOrg,
  seedStatuses,
  seedUserWithHub,
} from '../support/routes-harness';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

async function json<T>(response: Response): Promise<T> {
  return response.json() as Promise<T>;
}

describe('Time Ledger routes', () => {
  let userId: string;
  let organizationId: string;
  let teamId: string;
  let actorId: string;
  let statusId: StatusIdLookup;
  let app: ReturnType<typeof appWithSession>;

  beforeEach(async () => {
    const schema = await getDb();
    userId = await seedUserWithHub(schema.db, schema, 'TimeLedger');
    organizationId = await seedOrg(schema.db, schema);
    statusId = await seedStatuses(schema.db, schema, organizationId);
    actorId = await addMember(schema.db, schema, organizationId, userId);
    // Every real workspace is created with a default team, and the timer creates its task on one.
    teamId = one(
      await schema.db
        .insert(schema.team)
        .values({
          organizationId,
          name: 'Core',
          key: `K${Math.random().toString(36).slice(2, 6)}`,
        })
        .returning({ id: schema.team.id }),
    ).id;
    await schema.db.insert(schema.grant).values({
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

  /** Start tracking, returning the live record. */
  async function startTracking(body: Record<string, unknown>): Promise<TimeRecordOut> {
    const response = await app.request('/records', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(body),
    });
    expect(response.status).toBe(200);
    return json<TimeRecordOut>(response);
  }

  /**
   * Read the anchor off a record that is supposed to have one.
   *
   * @remarks
   * `taskId` is nullable now, because a session may run before anyone names it. A test that
   * started from a label is not such a session, so failing loudly here keeps that distinction
   * visible rather than letting a silently-unanchored record pass as an anchored one.
   */
  function anchorOf(record: TimeRecordOut): string {
    if (record.taskId === null) throw new Error('expected the record to be anchored to a task');
    return record.taskId;
  }

  /** Seed an ordinary Docket task the timer can be pointed at. */
  async function seedTask(title: string, overrides: Record<string, unknown> = {}): Promise<string> {
    const schema = await getDb();
    return one(
      await schema.db
        .insert(schema.task)
        .values({
          organizationId,
          teamId,
          title,
          state: 'todo',
          statusId: statusId('task', 'todo'),
          createdBy: actorId,
          ...overrides,
        })
        .returning({ id: schema.task.id }),
    ).id;
  }

  it('requires a session', async () => {
    const anonymous = appWithSession(time, null);
    expect((await anonymous.request('/active')).status).toBe(401);
  });

  it('lists only cycle periods from workspaces where the caller is an active member', async () => {
    const schema = await getDb();
    const [ownCycle] = await schema.db
      .insert(schema.cycle)
      .values({
        organizationId,
        teamId,
        number: 4,
        name: 'August review',
        startsAt: new Date('2026-08-03T07:00:00.000Z'),
        endsAt: new Date('2026-08-17T07:00:00.000Z'),
        createdBy: actorId,
      })
      .returning({ id: schema.cycle.id });
    const otherOrgId = await seedOrg(schema.db, schema);
    const otherTeam = one(
      await schema.db
        .insert(schema.team)
        .values({
          organizationId: otherOrgId,
          name: 'Other',
          key: `O${Math.random().toString(36).slice(2, 6)}`,
        })
        .returning({ id: schema.team.id }),
    );
    await schema.db.insert(schema.cycle).values({
      organizationId: otherOrgId,
      teamId: otherTeam.id,
      number: 1,
      name: 'Not mine',
      startsAt: new Date('2026-08-17T07:00:00.000Z'),
      endsAt: new Date('2026-08-31T07:00:00.000Z'),
      createdBy: actorId,
    });

    const response = await app.request('/cycles');
    expect(response.status).toBe(200);
    expect(
      await json<{ items: { id: string; workspaceId: string; name: string }[] }>(response),
    ).toMatchObject({
      items: [{ id: ownCycle?.id, workspaceId: organizationId, name: 'August review' }],
    });
  });

  it('starts a record from freeform context and publishes it as the active tracker', async () => {
    const record = await startTracking({ context: { label: 'Untangle deployment access' } });
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

  // Regression: pausing closes the interval and moves the record to 'paused' without leaving any
  // open interval behind, so `/active` has to find it by querying `timeRecord` directly rather
  // than joining through an open `timeInterval` — the join used to make a just-paused record
  // disappear from `/active` and fall back to the idle "Start a timer" state client-side.
  it('keeps a paused record as the active tracker instead of reporting no tracker at all', async () => {
    const record = await startTracking({ context: { label: 'Untangle deployment access' } });
    const paused = await app.request(`/records/${record.id}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'paused' }),
    });
    expect(paused.status).toBe(200);
    expect((await json<TimeRecordOut>(paused)).status).toBe('paused');

    const active = await app.request('/active');
    expect(active.status).toBe(200);
    const body = await json<{ record: TimeRecordOut | null }>(active);
    expect(body.record?.id).toBe(record.id);
    expect(body.record?.status).toBe('paused');
    expect(body.record?.intervals.every((interval) => interval.endedAt !== null)).toBe(true);
  });

  // the thing a timer names is an ordinary task, not a tracking-only entity.
  it('creates a first-class Docket task when tracking is started from a freeform name', async () => {
    const record = await startTracking({
      context: { label: 'Draft the launch note', organizationId },
    });
    expect(record.taskId).toEqual(expect.any(String));

    const schema = await getDb();
    const created = one(
      await schema.db
        .select({
          id: schema.task.id,
          title: schema.task.title,
          organizationId: schema.task.organizationId,
          teamId: schema.task.teamId,
          state: schema.task.state,
          assigneeId: schema.task.assigneeId,
          source: schema.task.source,
        })
        .from(schema.task)
        .where(eq(schema.task.id, anchorOf(record))),
    );
    // The same row shape every other task has: real workspace, real team, real workflow state,
    // native provenance — nothing that marks it as belonging to the timer.
    expect(created).toEqual({
      id: record.taskId,
      title: 'Draft the launch note',
      organizationId,
      teamId,
      state: expect.any(String),
      assigneeId: actorId,
      source: 'native',
    });
  });

  it('tracks an existing task by id without creating a second one', async () => {
    const taskId = await seedTask('Existing work');
    const before = (await (await getDb()).db.select().from((await getDb()).task)).length;
    const record = await startTracking({ context: { label: 'Existing work', taskId } });
    const after = (await (await getDb()).db.select().from((await getDb()).task)).length;
    expect(record.taskId).toBe(taskId);
    expect(after).toBe(before);
    expect(record.allocations).toEqual([
      expect.objectContaining({ targetKind: 'task', targetId: taskId, basisPoints: 10_000 }),
    ]);
  });

  it('claims an unassigned task and moves unstarted work into progress when tracking begins', async () => {
    const taskId = await seedTask('Start the task', { priority: 'high' });

    await startTracking({ context: { label: 'Start the task', taskId } });

    const schema = await getDb();
    const started = one(
      await schema.db
        .select({
          assigneeId: schema.task.assigneeId,
          state: schema.task.state,
          statusId: schema.task.statusId,
          priority: schema.task.priority,
        })
        .from(schema.task)
        .where(eq(schema.task.id, taskId)),
    );
    expect(started).toEqual({
      assigneeId: actorId,
      state: 'in_progress',
      statusId: statusId('task', 'in_progress'),
      priority: 'high',
    });
  });

  it('keeps an existing assignee while moving unstarted work into progress', async () => {
    const schema = await getDb();
    const otherUserId = await seedUserWithHub(schema.db, schema, 'OtherTracker');
    const otherActorId = await addMember(schema.db, schema, organizationId, otherUserId);
    const taskId = await seedTask('Already assigned', {
      assigneeId: otherActorId,
      priority: 'urgent',
    });

    await startTracking({ context: { label: 'Already assigned', taskId } });

    const started = one(
      await schema.db
        .select({
          assigneeId: schema.task.assigneeId,
          state: schema.task.state,
          statusId: schema.task.statusId,
          priority: schema.task.priority,
        })
        .from(schema.task)
        .where(eq(schema.task.id, taskId)),
    );
    expect(started).toEqual({
      assigneeId: otherActorId,
      state: 'in_progress',
      statusId: statusId('task', 'in_progress'),
      priority: 'urgent',
    });
  });

  it('tracks completed work without reopening or claiming it', async () => {
    const taskId = await seedTask('Completed work', {
      state: 'done',
      statusId: statusId('task', 'done'),
      completedAt: new Date(),
    });
    const schema = await getDb();

    const record = await startTracking({ context: { label: 'Completed work', taskId } });

    expect(record.taskId).toBe(taskId);
    expect(
      await schema.db
        .select({ assigneeId: schema.task.assigneeId, state: schema.task.state })
        .from(schema.task)
        .where(eq(schema.task.id, taskId)),
    ).toEqual([{ assigneeId: null, state: 'done' }]);
  });

  it('rolls back timer creation when the task cannot move from unstarted work into progress', async () => {
    const taskId = await seedTask('No started status');
    const schema = await getDb();
    await schema.db
      .delete(schema.workStatus)
      .where(eq(schema.workStatus.id, statusId('task', 'in_progress')));

    const response = await app.request('/records', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ context: { label: 'No started status', taskId } }),
    });

    expect(response.status).toBe(409);
    expect(
      await schema.db
        .select({ id: schema.timeRecord.id })
        .from(schema.timeRecord)
        .where(eq(schema.timeRecord.taskId, taskId)),
    ).toEqual([]);
    expect(
      one(
        await schema.db
          .select({ assigneeId: schema.task.assigneeId, state: schema.task.state })
          .from(schema.task)
          .where(eq(schema.task.id, taskId)),
      ),
    ).toEqual({ assigneeId: null, state: 'todo' });
  });

  it('rolls back the task start when a joined segment disappears before it can reopen', async () => {
    const taskId = await seedTask('Joined resume race', { priority: 'high' });
    const schema = await getDb();
    const hubId = one(
      await schema.db
        .select({ id: schema.hub.id })
        .from(schema.hub)
        .where(eq(schema.hub.userId, userId)),
    ).id;
    const endedAt = new Date();
    const recordId = one(
      await schema.db
        .insert(schema.timeRecord)
        .values({
          hubId,
          createdByUserId: userId,
          taskId,
          title: 'Joined resume race',
          status: 'closed',
          startedAt: new Date(endedAt.getTime() - 30_000),
          endedAt,
          closedAt: endedAt,
        })
        .returning({ id: schema.timeRecord.id }),
    ).id;
    await schema.db.insert(schema.timeInterval).values({
      timeRecordId: recordId,
      hubId,
      taskId,
      actorKind: 'human',
      userId,
      mode: 'human_active',
      source: 'user_timer',
      startedAt: new Date(endedAt.getTime() - 30_000),
      endedAt,
      closedAt: endedAt,
    });

    const client = Reflect.get(schema.db, '$client') as { exec(sql: string): Promise<unknown> };
    await client.exec(`
      CREATE FUNCTION reject_joined_resume() RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        IF OLD.time_record_id = '${recordId}' AND OLD.ended_at IS NOT NULL AND NEW.ended_at IS NULL THEN
          RETURN NULL;
        END IF;
        RETURN NEW;
      END;
      $$;
      CREATE TRIGGER reject_joined_resume_trigger
      BEFORE UPDATE ON time_interval
      FOR EACH ROW EXECUTE FUNCTION reject_joined_resume();
    `);
    try {
      const response = await app.request(`/records/${recordId}/status`, {
        method: 'PUT',
        headers: JSON_HEADERS,
        body: JSON.stringify({ status: 'running' }),
      });

      expect(response.status).toBe(409);
      expect(
        one(
          await schema.db
            .select({
              assigneeId: schema.task.assigneeId,
              state: schema.task.state,
              priority: schema.task.priority,
            })
            .from(schema.task)
            .where(eq(schema.task.id, taskId)),
        ),
      ).toEqual({ assigneeId: null, state: 'todo', priority: 'high' });
      expect(
        one(
          await schema.db
            .select({ status: schema.timeRecord.status, endedAt: schema.timeRecord.endedAt })
            .from(schema.timeRecord)
            .where(eq(schema.timeRecord.id, recordId)),
        ),
      ).toMatchObject({ status: 'closed', endedAt });
      expect(
        one(
          await schema.db
            .select({ endedAt: schema.timeInterval.endedAt })
            .from(schema.timeInterval)
            .where(eq(schema.timeInterval.timeRecordId, recordId)),
        ).endedAt,
      ).toEqual(endedAt);
    } finally {
      await client.exec(`
        DROP TRIGGER IF EXISTS reject_joined_resume_trigger ON time_interval;
        DROP FUNCTION IF EXISTS reject_joined_resume();
      `);
    }
  });

  it('refuses to track a task in a workspace the caller cannot see', async () => {
    const schema = await getDb();
    const foreignOrg = await seedOrg(schema.db, schema);
    const foreignStatusId = await seedStatuses(schema.db, schema, foreignOrg);
    const foreignTeam = one(
      await schema.db
        .insert(schema.team)
        .values({ organizationId: foreignOrg, name: 'Other', key: 'OTH' })
        .returning({ id: schema.team.id }),
    ).id;
    const foreignTask = one(
      await schema.db
        .insert(schema.task)
        .values({
          organizationId: foreignOrg,
          teamId: foreignTeam,
          title: 'Hidden',
          state: 'todo',
          statusId: foreignStatusId('task', 'todo'),
        })
        .returning({ id: schema.task.id }),
    ).id;
    const response = await app.request('/records', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ context: { label: 'Peek', taskId: foreignTask } }),
    });
    expect(response.status).toBe(404);
  });

  it('atomically switches human tracking without double-counting the prior record', async () => {
    const first = await startTracking({ context: { label: 'First thread' } });
    const second = await startTracking({ context: { label: 'Second thread' } });

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

  // the acceptance sequence, exactly as written.
  it('persists start/pause/resume/pause/resume/stop as exactly three bounded segments', async () => {
    const record = await startTracking({ context: { label: 'Segmented work' } });
    for (const status of ['paused', 'running', 'paused', 'running', 'stopped']) {
      // Each transition is separated by more than the join window so the acceptance's THREE
      // segments are what the ledger holds; see the sub-minute join test for the other case.
      await advanceStoredClock(record.id, 5 * 60_000);
      const response = await app.request(`/records/${record.id}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      expect(response.status).toBe(200);
    }
    const schema = await getDb();
    const segments = await schema.db
      .select()
      .from(schema.timeInterval)
      .where(eq(schema.timeInterval.timeRecordId, record.id))
      .orderBy(asc(schema.timeInterval.startedAt));
    expect(segments).toHaveLength(3);
    let summed = 0;
    for (const [index, segment] of segments.entries()) {
      expect(segment.startedAt).toBeInstanceOf(Date);
      expect(segment.endedAt).toBeInstanceOf(Date);
      expect(segment.taskId).toBe(record.taskId);
      summed += (segment.endedAt?.getTime() ?? 0) - segment.startedAt.getTime();
      const next = segments[index + 1];
      // No segment may span a paused gap: each one ends strictly before the next begins.
      if (next) expect(segment.endedAt?.getTime()).toBeLessThan(next.startedAt.getTime());
    }
    const detail = await json<{ items: TimeRecordOut[] }>(
      await app.request(`/timeline?${WIDE_RANGE}`),
    );
    const hydrated = detail.items.find((item) => item.id === record.id);
    expect(hydrated?.measures.humanEffortMs).toBe(summed);
  });

  // the segment itself carries the subject, and a task change moves the subject.
  it('associates every segment with the task it tracked and switches subjects cleanly', async () => {
    const alpha = await seedTask('Alpha');
    const beta = await seedTask('Beta');
    const first = await startTracking({ context: { label: 'Alpha', taskId: alpha } });
    await advanceStoredClock(first.id, 10 * 60_000);
    const second = await startTracking({ context: { label: 'Beta', taskId: beta } });

    const schema = await getDb();
    const segments = await schema.db.select().from(schema.timeInterval);
    expect(segments.length).toBeGreaterThanOrEqual(2);
    expect(segments.every((segment) => typeof segment.taskId === 'string')).toBe(true);

    const alphaSegments = segments.filter((segment) => segment.taskId === alpha);
    const betaSegments = segments.filter((segment) => segment.taskId === beta);
    expect(alphaSegments).toHaveLength(1);
    expect(betaSegments).toHaveLength(1);
    // The old subject's segment is closed; the new subject's is the only one still accruing.
    expect(alphaSegments[0]?.endedAt).not.toBeNull();
    expect(betaSegments[0]?.endedAt).toBeNull();
    expect(betaSegments[0]?.timeRecordId).toBe(second.id);
  });

  // a restart inside the window continues the stretch; outside it starts a new one.
  it('joins a restart under a minute and records a break at or beyond one minute', async () => {
    const taskId = await seedTask('Continuous work');
    const record = await startTracking({ context: { label: 'Continuous work', taskId } });
    await app.request(`/records/${record.id}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'stopped' }),
    });

    // 59 seconds later: one segment spanning the whole span, no break recorded.
    await rewindLastSegment(record.id, 59_000);
    const rejoined = await startTracking({ context: { label: 'Continuous work', taskId } });
    expect(rejoined.id).toBe(record.id);
    expect(await segmentCountForTask(taskId)).toBe(1);
    expect(rejoined.intervals.filter((interval) => interval.endedAt === null)).toHaveLength(1);

    // 61 seconds later: a genuinely separate segment on the same task.
    await app.request(`/records/${record.id}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'stopped' }),
    });
    await rewindLastSegment(record.id, 61_000);
    await startTracking({ context: { label: 'Continuous work', taskId } });
    expect(await segmentCountForTask(taskId)).toBe(2);
  });

  it('never joins across a task change, however brief the gap', async () => {
    const alpha = await seedTask('Alpha');
    const beta = await seedTask('Beta');
    const first = await startTracking({ context: { label: 'Alpha', taskId: alpha } });
    await app.request(`/records/${first.id}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'stopped' }),
    });
    await rewindLastSegment(first.id, 1_000);
    const second = await startTracking({ context: { label: 'Beta', taskId: beta } });
    expect(second.id).not.toBe(first.id);
    expect(await segmentCount(first.id)).toBe(1);
    expect(await segmentCount(second.id)).toBe(1);
  });

  // the refusal is the SERVER's, reachable with no UI in the loop.
  it('refuses to stop a session whose task has no name, and leaves it running', async () => {
    const record = await startTracking({ context: { label: 'Nameable work' } });
    const schema = await getDb();
    // The anchor task cannot be blanked at all — `task_title_not_blank` refuses the write even
    // from raw SQL, which is a stronger guarantee than the requirement asks for. The record's own
    // label has no such constraint, so that is the hole the stop guard has to close.
    await expect(
      schema.db
        .update(schema.task)
        .set({ title: '   ' })
        .where(eq(schema.task.id, anchorOf(record))),
    ).rejects.toThrow();
    // Bypass every client and every validator, exactly as the acceptance requires.
    await schema.db
      .update(schema.timeRecord)
      .set({ title: '   ' })
      .where(eq(schema.timeRecord.id, record.id));

    const refused = await app.request(`/records/${record.id}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'stopped' }),
    });
    expect(refused.status).toBe(422);
    const problem = await json<{ code: string; fieldErrors: Record<string, unknown> }>(refused);
    expect(problem.code).toBe('validation_error');
    expect(problem.fieldErrors).toHaveProperty('title');

    const stillOpen = one(
      await schema.db
        .select({ status: schema.timeRecord.status })
        .from(schema.timeRecord)
        .where(eq(schema.timeRecord.id, record.id)),
    );
    expect(stillOpen.status).toBe('open');

    // The same call succeeds the moment the work has a name.
    await schema.db
      .update(schema.timeRecord)
      .set({ title: 'Named at last' })
      .where(eq(schema.timeRecord.id, record.id));
    const stopped = await app.request(`/records/${record.id}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'stopped' }),
    });
    expect(stopped.status).toBe(200);
    expect((await json<TimeRecordOut>(stopped)).status).toBe('closed');
  });

  it('rejects an empty name at creation and at rename', async () => {
    const blankCreate = await app.request('/records', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ context: { label: '   ' } }),
    });
    expect(blankCreate.status).toBe(422);

    const record = await startTracking({ context: { label: 'Real work' } });
    const blankRename = await app.request(`/records/${record.id}`, {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify({ title: '  ' }),
    });
    expect(blankRename.status).toBe(422);
  });

  // The one-click start. An omitted label is a person beginning work before naming it, which is
  // a different thing from the blank label above — that one is a client sending nonsense.
  it('starts a session with no label and no task at all', async () => {
    const record = await startTracking({ context: {} });
    expect(record.status).toBe('open');
    expect(record.taskId).toBeNull();
    expect(record.title).toBe('');
    expect(record.intervals).toHaveLength(1);
    expect(record.intervals[0]?.taskId).toBeNull();
    // Nothing is reportable until there is a subject to credit.
    expect(record.allocations).toEqual([]);

    // Scoped to this test's own workspace: the suite shares one database, so a global count would
    // be measuring every other test's fixtures rather than this one's restraint.
    const schema = await getDb();
    const tasks = await schema.db
      .select({ id: schema.task.id })
      .from(schema.task)
      .where(eq(schema.task.organizationId, organizationId));
    expect(tasks).toHaveLength(0);
  });

  it('refuses to finish an unnamed session, and leaves it running', async () => {
    const record = await startTracking({ context: {} });
    const refused = await app.request(`/records/${record.id}/status`, {
      method: 'PUT',
      headers: JSON_HEADERS,
      body: JSON.stringify({ status: 'stopped' }),
    });
    expect(refused.status).toBe(422);
    expect((await json<{ code: string }>(refused)).code).toBe('validation_error');

    const schema = await getDb();
    const stillOpen = one(
      await schema.db
        .select({ status: schema.timeRecord.status })
        .from(schema.timeRecord)
        .where(eq(schema.timeRecord.id, record.id)),
    );
    expect(stillOpen.status).toBe('open');
  });

  it('anchors the record, its segments and its allocation when the stop carries a name', async () => {
    const record = await startTracking({ context: {} });
    const stopped = await app.request(`/records/${record.id}/status`, {
      method: 'PUT',
      headers: JSON_HEADERS,
      body: JSON.stringify({ status: 'stopped', title: 'Fixing the drag handles' }),
    });
    expect(stopped.status).toBe(200);
    const closed = await json<TimeRecordOut>(stopped);
    expect(closed.status).toBe('closed');
    expect(closed.title).toBe('Fixing the drag handles');
    const taskId = anchorOf(closed);

    // The denormalized segment anchor is what a breakdown sums, so a record whose segments kept a
    // null id would report zero against the very task it names.
    expect(closed.intervals.every((interval) => interval.taskId === taskId)).toBe(true);
    expect(closed.allocations).toEqual([
      expect.objectContaining({ targetKind: 'task', targetId: taskId, basisPoints: 10_000 }),
    ]);

    const schema = await getDb();
    const created = one(
      await schema.db
        .select({ title: schema.task.title, source: schema.task.source })
        .from(schema.task)
        .where(eq(schema.task.id, taskId)),
    );
    expect(created).toEqual({ title: 'Fixing the drag handles', source: 'native' });
  });

  it('anchors on an inline rename, without stopping the timer', async () => {
    const record = await startTracking({ context: {} });
    const renamed = await app.request(`/records/${record.id}`, {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify({ title: 'Naming it while I work' }),
    });
    expect(renamed.status).toBe(200);
    const body = await json<TimeRecordOut>(renamed);
    expect(body.status).toBe('open');
    const taskId = anchorOf(body);
    expect(body.intervals.every((interval) => interval.taskId === taskId)).toBe(true);
  });

  // Two nameless sessions are two pieces of work. Treating `null === null` as "the same task"
  // would silently weld them into one continuous stretch nobody worked.
  it('never joins two unnamed sessions, however brief the gap', async () => {
    const first = await startTracking({ context: {} });
    await app.request(`/records/${first.id}/status`, {
      method: 'PUT',
      headers: JSON_HEADERS,
      body: JSON.stringify({ status: 'stopped', title: 'First thing' }),
    });
    await rewindLastSegment(first.id, 1_000);
    const second = await startTracking({ context: {} });
    expect(second.id).not.toBe(first.id);
    expect(await segmentCount(second.id)).toBe(1);
  });

  // The guarantee that keeps every terminal-record reader safe. Enforced by the database, not by
  // whichever write path happened to remember to check.
  it('makes a closed record without an anchor unrepresentable, even from raw SQL', async () => {
    const record = await startTracking({ context: {} });
    const schema = await getDb();
    await expect(
      schema.db
        .update(schema.timeRecord)
        .set({ status: 'closed' })
        .where(eq(schema.timeRecord.id, record.id)),
    ).rejects.toThrow();
  });

  // every transition is announced, once, in order, with the task on it.
  it('emits exactly one typed event per timer transition, in order', async () => {
    const taskId = await seedTask('Observable work');
    const record = await startTracking({ context: { label: 'Observable work', taskId } });
    await advanceStoredClock(record.id, 5 * 60_000);
    await app.request(`/records/${record.id}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'paused' }),
    });
    await advanceStoredClock(record.id, 5 * 60_000);
    await app.request(`/records/${record.id}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'running' }),
    });
    const other = await seedTask('Something else');
    await advanceStoredClock(record.id, 5 * 60_000);
    const switched = await startTracking({ context: { label: 'Something else', taskId: other } });
    await app.request(`/records/${switched.id}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'stopped' }),
    });

    const schema = await getDb();
    const events = await schema.db
      .select({
        kind: schema.event.kind,
        detail: schema.event.detail,
        entity: schema.event.entity,
        userId: schema.event.userId,
        organizationId: schema.event.organizationId,
        occurredAt: schema.event.occurredAt,
      })
      .from(schema.event)
      // Scoped to this test's freshly-seeded workspace: the suite shares one database, so an
      // unscoped read would report every other test's timer too.
      .where(eq(schema.event.organizationId, organizationId))
      .orderBy(asc(schema.event.id));
    const timerEvents = events.filter((row) => row.kind.startsWith('timer_'));
    expect(timerEvents.map((row) => row.kind)).toEqual([
      'timer_started',
      'timer_paused',
      'timer_resumed',
      'timer_switched',
      'timer_stopped',
    ]);
    for (const row of timerEvents) {
      expect(row.userId).toBe(userId);
      expect(row.organizationId).toBe(organizationId);
      expect(row.occurredAt).toBeInstanceOf(Date);
      expect(row.detail).toMatchObject({ schema: 'docket.timer' });
      expect(row.entity).toMatchObject({ kind: 'work_item' });
    }
    const switchEvent = timerEvents.find((row) => row.kind === 'timer_switched');
    expect(switchEvent?.detail).toMatchObject({ previousTimeRecordId: record.id });
    expect(switchEvent?.entity).toMatchObject({ externalId: other });
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

  it('keeps non-counting contexts separate from the anchor’s reportable credit', async () => {
    const record = await startTracking({ context: { label: 'Coordinate release' } });
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
    expect(contextResponse.status).toBe(201);
    const contextualized = await json<TimeRecordOut>(contextResponse);
    expect(contextualized.contexts).toHaveLength(1);
    // The calendar link earns no credit; the anchor task remains the only allocation.
    expect(contextualized.allocations).toEqual([
      expect.objectContaining({ targetKind: 'task', targetId: record.taskId }),
    ]);

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

  it('validates Docket contexts against the caller’s workspace access', async () => {
    const accessible = await startTracking({
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
    });
    expect(accessible.contexts).toEqual([expect.objectContaining({ organizationId })]);

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
          organizationId,
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

  it('groups personal reflection by workspace and preserves submitted snapshots', async () => {
    const record = await json<TimeRecordOut>(
      await app.request('/records', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({
          startNow: false,
          startsAt: '2026-07-10T10:00:00.000Z',
          endsAt: '2026-07-10T11:00:00.000Z',
          context: { label: 'Ship the time ledger', organizationId },
        }),
      }),
    );

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

    await app.request(`/records/${record.id}/allocations`, {
      method: 'PUT',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        allocations: [{ targetKind: 'workspace', targetId: organizationId, basisPoints: 10_000 }],
      }),
    });
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
    expect(submission.status).toBe(201);
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

  // all four named dimensions, each reconciling, with explicit unassigned buckets.
  it('breaks tracked time down by project, program, initiative and workspace', async () => {
    const schema = await getDb();
    const programId = one(
      await schema.db
        .insert(schema.program)
        .values({
          organizationId,
          name: 'Platform',
          status: 'active',
          statusId: statusId('program', 'active'),
        })
        .returning({ id: schema.program.id }),
    ).id;
    const projectId = one(
      await schema.db
        .insert(schema.project)
        .values({
          organizationId,
          name: 'Ledger',
          programId,
          status: 'planned',
          statusId: statusId('project', 'planned'),
        })
        .returning({ id: schema.project.id }),
    ).id;
    const initiativeId = one(
      await schema.db
        .insert(schema.initiative)
        .values({
          organizationId,
          name: 'Ship v1',
          status: 'active',
          statusId: statusId('initiative', 'active'),
        })
        .returning({ id: schema.initiative.id }),
    ).id;
    await schema.db
      .insert(schema.initiativeProject)
      .values({ initiativeId, projectId, organizationId });

    const placed = await seedTask('Inside the hierarchy', { projectId });
    const loose = await seedTask('Outside the hierarchy');
    await app.request('/records', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        startNow: false,
        startsAt: '2026-07-10T09:00:00.000Z',
        endsAt: '2026-07-10T10:00:00.000Z',
        context: { label: 'Inside the hierarchy', taskId: placed },
      }),
    });
    await app.request('/records', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        startNow: false,
        startsAt: '2026-07-10T10:00:00.000Z',
        endsAt: '2026-07-10T10:30:00.000Z',
        context: { label: 'Outside the hierarchy', taskId: loose },
      }),
    });

    const expected: Record<string, [string, number][]> = {
      project: [
        [projectId, 60 * 60_000],
        ['unassigned:project', 30 * 60_000],
      ],
      program: [
        [programId, 60 * 60_000],
        ['unassigned:program', 30 * 60_000],
      ],
      initiative: [
        [initiativeId, 60 * 60_000],
        ['unassigned:initiative', 30 * 60_000],
      ],
      workspace: [[organizationId, 90 * 60_000]],
    };
    for (const [dimension, buckets] of Object.entries(expected)) {
      const response = await app.request(
        `/breakdown?start=2026-07-10T00:00:00.000Z&end=2026-07-11T00:00:00.000Z&groupBy=${dimension}`,
      );
      expect(response.status).toBe(200);
      const body = await json<{
        buckets: { key: string; label: string; measures: { humanEffortMs: number } }[];
        total: { humanEffortMs: number };
      }>(response);
      for (const [key, humanEffortMs] of buckets) {
        expect(body.buckets).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ key, measures: expect.objectContaining({ humanEffortMs }) }),
          ]),
        );
      }
      // Every dimension reconciles to the same period total, to the millisecond.
      expect(body.buckets.reduce((sum, bucket) => sum + bucket.measures.humanEffortMs, 0)).toBe(
        body.total.humanEffortMs,
      );
      expect(body.total.humanEffortMs).toBe(90 * 60_000);
    }
  });

  it('clips reports to the requested range and preserves real elapsed wall clock under overlap', async () => {
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

  it('repairs and removes a person’s unsubmitted manual time without leaving it in history', async () => {
    const created = await app.request('/records', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        startNow: false,
        captureSource: 'manual',
        startsAt: '2026-07-12T09:00:00.000Z',
        endsAt: '2026-07-12T10:00:00.000Z',
        context: { label: 'Reconstruct the launch review', organizationId },
      }),
    });
    expect(created.status).toBe(200);
    const record = await json<TimeRecordOut>(created);
    const intervalId = record.intervals[0]?.id;
    expect(intervalId).toEqual(expect.any(String));

    const repaired = await app.request(`/records/${record.id}/intervals/${intervalId}`, {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        startsAt: '2026-07-12T09:15:00.000Z',
        endsAt: '2026-07-12T10:30:00.000Z',
      }),
    });
    expect(repaired.status).toBe(200);
    const repairedRecord = await json<TimeRecordOut>(repaired);
    expect(repairedRecord.intervals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: intervalId, supersededById: expect.any(String) }),
        expect.objectContaining({
          startedAt: '2026-07-12T09:15:00.000Z',
          endedAt: '2026-07-12T10:30:00.000Z',
          supersededById: null,
        }),
      ]),
    );

    const removed = await app.request(`/records/${record.id}`, { method: 'DELETE' });
    expect(removed.status).toBe(200);
    expect((await json<TimeRecordOut>(removed)).status).toBe('superseded');

    const timeline = await app.request(
      '/timeline?start=2026-07-12T00:00:00.000Z&end=2026-07-13T00:00:00.000Z',
    );
    expect(timeline.status).toBe(200);
    expect((await json<{ items: TimeRecordOut[] }>(timeline)).items).toEqual([]);
  });
});

/** A range wide enough to contain everything a test writes. */
const WIDE_RANGE = 'start=2026-01-01T00:00:00.000Z&end=2030-01-01T00:00:00.000Z';

/**
 * Push a record's existing segments back in time.
 *
 * @remarks
 * Every transition in a test happens within the same millisecond, which is both unrealistic and
 * indistinguishable from the sub-minute join the ledger is supposed to apply. Rewriting the
 * stored timestamps is how a test states "and then five minutes passed" without a fake clock —
 * the commands read the real clock, so moving the DATA is the honest lever.
 */
async function advanceStoredClock(recordId: string, ms: number): Promise<void> {
  const schema = await getDb();
  const rows = await schema.db
    .select()
    .from(schema.timeInterval)
    .where(eq(schema.timeInterval.timeRecordId, recordId));
  for (const row of rows) {
    await schema.db
      .update(schema.timeInterval)
      .set({
        startedAt: new Date(row.startedAt.getTime() - ms),
        ...(row.endedAt ? { endedAt: new Date(row.endedAt.getTime() - ms) } : {}),
      })
      .where(eq(schema.timeInterval.id, row.id));
  }
}

/** Move a record's most recent segment end `gapMs` into the past, simulating that much delay. */
async function rewindLastSegment(recordId: string, gapMs: number): Promise<void> {
  const schema = await getDb();
  const rows = await schema.db
    .select()
    .from(schema.timeInterval)
    .where(eq(schema.timeInterval.timeRecordId, recordId))
    .orderBy(asc(schema.timeInterval.startedAt));
  const last = rows[rows.length - 1];
  if (!last?.endedAt) throw new Error('expected a closed segment to rewind');
  const shift = gapMs;
  await schema.db
    .update(schema.timeInterval)
    .set({
      startedAt: new Date(last.startedAt.getTime() - shift),
      endedAt: new Date(last.endedAt.getTime() - shift),
    })
    .where(eq(schema.timeInterval.id, last.id));
}

/** Count a record's live (non-superseded) segments. */
async function segmentCount(recordId: string): Promise<number> {
  const schema = await getDb();
  const rows = await schema.db
    .select({ id: schema.timeInterval.id })
    .from(schema.timeInterval)
    .where(eq(schema.timeInterval.timeRecordId, recordId));
  return rows.length;
}

/**
 * Count every segment recorded against one task, across records.
 *
 * @remarks
 * The join rule is about a *task's* history, not a record's: a break long enough to matter opens
 * a new record, so counting per record would report "1" for both the joined and the broken case
 * and prove nothing.
 */
async function segmentCountForTask(taskId: string): Promise<number> {
  const schema = await getDb();
  const rows = await schema.db
    .select({ id: schema.timeInterval.id })
    .from(schema.timeInterval)
    .where(eq(schema.timeInterval.taskId, taskId));
  return rows.length;
}
