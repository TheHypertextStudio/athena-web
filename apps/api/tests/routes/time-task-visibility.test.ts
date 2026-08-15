/** Time Ledger task visibility must be re-evaluated when personal history is read. */
import type * as DbModule from '@docket/db';
import type { TimeRecordOut } from '@docket/types';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import time from '../../src/routes/time';
import {
  appWithSession,
  fakeSession,
  getDb,
  one,
  seedBaseOrg,
  seedUserWithHub,
} from '../support/routes-harness';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
});

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

interface TimelineWire {
  readonly items: readonly TimeRecordOut[];
}

interface ActiveWire {
  readonly record: TimeRecordOut | null;
}

interface BreakdownWire {
  readonly buckets: readonly {
    readonly key: string;
    readonly label: string;
    readonly measures: { readonly humanEffortMs: number };
  }[];
}

/** Return one serialized context by its durable row id. */
function contextById(record: TimeRecordOut | null | undefined, contextId: string) {
  const context = record?.contexts.find((candidate) => candidate.id === contextId);
  if (!context) throw new Error(`expected time context ${contextId}`);
  return context;
}

describe('Time Ledger task visibility', () => {
  it('redacts a revoked private task from every REST ledger projection while retaining duration', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const userId = await seedUserWithHub(db, schema, 'TimeRevokedTask');
    await db.update(schema.actor).set({ userId }).where(eq(schema.actor.id, humanActorId));
    const hub = one(
      await db.select({ id: schema.hub.id }).from(schema.hub).where(eq(schema.hub.userId, userId)),
    );
    const taskTitle = 'Board compensation review';
    const programTitle = 'Compensation operations';
    const program = one(
      await db
        .insert(schema.program)
        .values({ organizationId: orgId, name: programTitle })
        .returning({ id: schema.program.id }),
    );
    const projectTitle = 'Executive compensation project';
    const trackedProject = one(
      await db
        .insert(schema.project)
        .values({
          organizationId: orgId,
          teamId,
          programId: program.id,
          name: projectTitle,
          visibility: 'private',
        })
        .returning({ id: schema.project.id }),
    );
    const trackedTask = one(
      await db
        .insert(schema.task)
        .values({
          organizationId: orgId,
          teamId,
          projectId: trackedProject.id,
          programId: program.id,
          title: taskTitle,
          state: 'backlog',
          visibility: 'private',
        })
        .returning({ id: schema.task.id }),
    );
    const grant = one(
      await db
        .insert(schema.grant)
        .values({
          organizationId: orgId,
          subjectKind: 'actor',
          subjectId: humanActorId,
          resourceKind: 'task',
          resourceId: trackedTask.id,
          capabilities: ['view'],
          effect: 'allow',
          cascades: false,
        })
        .returning({ id: schema.grant.id }),
    );
    const startedAt = new Date('2026-08-01T09:00:00.000Z');
    const endedAt = new Date('2026-08-01T09:30:00.000Z');
    const record = one(
      await db
        .insert(schema.timeRecord)
        .values({
          hubId: hub.id,
          createdByUserId: userId,
          taskId: trackedTask.id,
          title: taskTitle,
          status: 'paused',
          startedAt,
          endedAt,
        })
        .returning({ id: schema.timeRecord.id }),
    );
    await db.insert(schema.timeInterval).values({
      timeRecordId: record.id,
      hubId: hub.id,
      taskId: trackedTask.id,
      actorKind: 'human',
      userId,
      mode: 'human_active',
      source: 'user_timer',
      startedAt,
      endedAt,
      closedAt: endedAt,
    });
    const taskContext = one(
      await db
        .insert(schema.timeContext)
        .values({
          timeRecordId: record.id,
          role: 'primary',
          entityKind: 'work_item',
          sourceSystem: 'docket',
          externalId: trackedTask.id,
          titleSnapshot: taskTitle,
          urlSnapshot: null,
          docketEntityId: trackedTask.id,
          organizationId: orgId,
          createdByUserId: userId,
        })
        .returning({ id: schema.timeContext.id }),
    );
    const projectContext = one(
      await db
        .insert(schema.timeContext)
        .values({
          timeRecordId: record.id,
          role: 'related',
          entityKind: 'project',
          sourceSystem: 'docket',
          externalId: trackedProject.id,
          titleSnapshot: projectTitle,
          urlSnapshot: null,
          docketEntityId: trackedProject.id,
          organizationId: orgId,
          createdByUserId: userId,
        })
        .returning({ id: schema.timeContext.id }),
    );
    const programContext = one(
      await db
        .insert(schema.timeContext)
        .values({
          timeRecordId: record.id,
          role: 'related',
          entityKind: 'program',
          sourceSystem: 'docket',
          externalId: program.id,
          titleSnapshot: programTitle,
          urlSnapshot: null,
          docketEntityId: program.id,
          organizationId: orgId,
          createdByUserId: userId,
        })
        .returning({ id: schema.timeContext.id }),
    );
    const workspaceTitle = 'Board matters workspace';
    const workspaceContext = one(
      await db
        .insert(schema.timeContext)
        .values({
          timeRecordId: record.id,
          role: 'related',
          entityKind: 'organization',
          sourceSystem: 'docket',
          externalId: orgId,
          titleSnapshot: workspaceTitle,
          urlSnapshot: null,
          docketEntityId: orgId,
          organizationId: orgId,
          createdByUserId: userId,
        })
        .returning({ id: schema.timeContext.id }),
    );
    const calendarLayer = one(
      await db
        .insert(schema.calendarLayer)
        .values({ userId, sourceKind: 'native', title: 'Personal calendar' })
        .returning({ id: schema.calendarLayer.id }),
    );
    const calendarItem = one(
      await db
        .insert(schema.calendarItem)
        .values({ userId, layerId: calendarLayer.id, kind: 'block', title: 'Personal focus' })
        .returning({ id: schema.calendarItem.id }),
    );
    const calendarContext = one(
      await db
        .insert(schema.timeContext)
        .values({
          timeRecordId: record.id,
          role: 'planning_context',
          entityKind: 'calendar_event',
          sourceSystem: 'docket',
          externalId: calendarItem.id,
          titleSnapshot: 'Personal focus',
          urlSnapshot: null,
          docketEntityId: calendarItem.id,
          organizationId: orgId,
          createdByUserId: userId,
        })
        .returning({ id: schema.timeContext.id }),
    );
    await db.insert(schema.timeAllocation).values([
      {
        timeRecordId: record.id,
        targetKind: 'task',
        targetId: trackedTask.id,
        organizationId: orgId,
        basisPoints: 5_000,
      },
      {
        timeRecordId: record.id,
        targetKind: 'workspace',
        targetId: orgId,
        organizationId: orgId,
        basisPoints: 5_000,
      },
    ]);

    const app = appWithSession(time, fakeSession(userId));
    const before = await json<ActiveWire>(await app.request('/active'));
    expect(before.record).toMatchObject({
      taskId: trackedTask.id,
      organizationId: orgId,
      title: taskTitle,
    });
    expect(contextById(before.record, taskContext.id)).toMatchObject({
      organizationId: orgId,
      entityRef: { externalId: trackedTask.id, title: taskTitle },
    });
    expect(contextById(before.record, projectContext.id)).toMatchObject({
      organizationId: orgId,
      entityRef: { externalId: trackedProject.id, title: projectTitle },
    });
    expect(contextById(before.record, programContext.id)).toMatchObject({
      organizationId: orgId,
      entityRef: { externalId: program.id, title: programTitle },
    });
    expect(contextById(before.record, workspaceContext.id)).toMatchObject({
      organizationId: orgId,
      entityRef: { externalId: orgId, title: workspaceTitle },
    });
    expect(contextById(before.record, calendarContext.id)).toMatchObject({
      organizationId: orgId,
      entityRef: { externalId: calendarItem.id, title: 'Personal focus' },
    });
    expect(before.record?.allocations).toEqual([
      expect.objectContaining({
        targetKind: 'task',
        targetId: trackedTask.id,
        organizationId: orgId,
      }),
      expect.objectContaining({
        targetKind: 'workspace',
        targetId: orgId,
        organizationId: orgId,
      }),
    ]);

    await db.delete(schema.grant).where(eq(schema.grant.id, grant.id));

    const active = await json<ActiveWire>(await app.request('/active'));
    const timeline = await json<TimelineWire>(
      await app.request('/timeline?start=2026-08-01T00:00:00.000Z&end=2026-08-02T00:00:00.000Z'),
    );
    const breakdown = await json<BreakdownWire>(
      await app.request(
        '/breakdown?start=2026-08-01T00:00:00.000Z&end=2026-08-02T00:00:00.000Z&groupBy=task',
      ),
    );
    const summary = await json<{ humanEffortMs: number }>(
      await app.request('/summary?start=2026-08-01T00:00:00.000Z&end=2026-08-02T00:00:00.000Z'),
    );

    expect(active.record).toMatchObject({
      id: record.id,
      taskId: null,
      organizationId: null,
      title: 'Restricted work',
    });
    expect(timeline.items).toHaveLength(1);
    expect(timeline.items[0]).toMatchObject({
      id: record.id,
      taskId: null,
      organizationId: null,
      title: 'Restricted work',
    });
    expect(timeline.items[0]?.intervals).toEqual([expect.objectContaining({ taskId: null })]);
    for (const contextId of [
      taskContext.id,
      projectContext.id,
      programContext.id,
      workspaceContext.id,
    ]) {
      expect(contextById(timeline.items[0], contextId)).toMatchObject({
        organizationId: null,
        entityRef: {
          externalId: contextId,
          title: null,
          docketEntityId: null,
        },
      });
    }
    expect(contextById(timeline.items[0], calendarContext.id)).toMatchObject({
      organizationId: null,
      entityRef: {
        externalId: calendarItem.id,
        title: 'Personal focus',
        docketEntityId: calendarItem.id,
      },
    });
    expect(timeline.items[0]?.allocations).toEqual([]);
    expect(breakdown.buckets).toEqual([
      expect.objectContaining({
        key: 'unassigned:task',
        label: 'Unassigned',
        measures: expect.objectContaining({ humanEffortMs: 30 * 60_000 }),
      }),
    ]);
    expect(summary.humanEffortMs).toBe(30 * 60_000);

    const serialized = JSON.stringify({ active, timeline, breakdown });
    expect(serialized).not.toContain(trackedTask.id);
    expect(serialized).not.toContain(orgId);
    expect(serialized).not.toContain(taskTitle);
    expect(serialized).not.toContain(trackedProject.id);
    expect(serialized).not.toContain(projectTitle);
    expect(serialized).not.toContain(program.id);
    expect(serialized).not.toContain(programTitle);
    expect(serialized).not.toContain(workspaceTitle);
    expect(serialized).toContain(calendarItem.id);
    expect(serialized).toContain('Personal focus');
  });

  it('keeps Docket placement contexts for an active member viewing a public task', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const userId = await seedUserWithHub(db, schema, 'TimePublicTask');
    await db.update(schema.actor).set({ userId }).where(eq(schema.actor.id, humanActorId));
    const hub = one(
      await db.select({ id: schema.hub.id }).from(schema.hub).where(eq(schema.hub.userId, userId)),
    );
    const projectTitle = 'Public delivery project';
    const visibleProject = one(
      await db
        .insert(schema.project)
        .values({ organizationId: orgId, teamId, name: projectTitle, visibility: 'public' })
        .returning({ id: schema.project.id }),
    );
    const taskTitle = 'Publish the release notes';
    const visibleTask = one(
      await db
        .insert(schema.task)
        .values({
          organizationId: orgId,
          teamId,
          projectId: visibleProject.id,
          title: taskTitle,
          state: 'backlog',
          visibility: 'public',
        })
        .returning({ id: schema.task.id }),
    );
    const startedAt = new Date('2026-08-03T09:00:00.000Z');
    const endedAt = new Date('2026-08-03T09:15:00.000Z');
    const record = one(
      await db
        .insert(schema.timeRecord)
        .values({
          hubId: hub.id,
          createdByUserId: userId,
          taskId: visibleTask.id,
          title: taskTitle,
          status: 'closed',
          startedAt,
          endedAt,
          closedAt: endedAt,
        })
        .returning({ id: schema.timeRecord.id }),
    );
    await db.insert(schema.timeInterval).values({
      timeRecordId: record.id,
      hubId: hub.id,
      taskId: visibleTask.id,
      actorKind: 'human',
      userId,
      mode: 'human_active',
      source: 'user_timer',
      startedAt,
      endedAt,
      closedAt: endedAt,
    });
    const projectContext = one(
      await db
        .insert(schema.timeContext)
        .values({
          timeRecordId: record.id,
          role: 'primary',
          entityKind: 'project',
          sourceSystem: 'docket',
          externalId: visibleProject.id,
          titleSnapshot: projectTitle,
          urlSnapshot: null,
          docketEntityId: visibleProject.id,
          organizationId: orgId,
          createdByUserId: userId,
        })
        .returning({ id: schema.timeContext.id }),
    );

    const app = appWithSession(time, fakeSession(userId));
    const timeline = await json<TimelineWire>(
      await app.request('/timeline?start=2026-08-03T00:00:00.000Z&end=2026-08-04T00:00:00.000Z'),
    );

    expect(timeline.items).toHaveLength(1);
    expect(timeline.items[0]).toMatchObject({
      id: record.id,
      taskId: visibleTask.id,
      organizationId: orgId,
      title: taskTitle,
    });
    expect(contextById(timeline.items[0], projectContext.id)).toMatchObject({
      organizationId: orgId,
      entityRef: {
        externalId: visibleProject.id,
        title: projectTitle,
        docketEntityId: visibleProject.id,
      },
    });
  });
});
