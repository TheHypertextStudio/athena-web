import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type * as DbModule from '@docket/db';
import { and, desc, eq } from 'drizzle-orm';
import {
  nativeRuntimeFixture,
  nativeOccurrence,
  nativeMove,
} from './work-schedule-native-runtime-fixture';
import { appWithActor, getDb, one } from '../support/routes-harness';
import tasksRouter from '../../src/routes/tasks';
import projectsRouter from '../../src/routes/projects';
import {
  createWorkSchedule,
  reviseWorkSchedule,
} from '../../src/lib/recurrence/schedule-authoring';
import { executeScheduleOccurrence } from '../../src/lib/recurrence/schedule-runtime';
import { materializeOccurrence } from '../../src/lib/recurrence/materialize';
import { scheduleRouteFixture } from '../routes/work-schedule-fixture';
import schedulesRouter from '../../src/routes/work-schedules';
import * as creation from '../../src/lib/work-creation/service';
import { WorkScheduleDraft } from '@docket/work/work-schedule';
import { undoChangeSet } from '../../src/mcp/change-set';
import { workScheduleUndoAccess } from '../../src/lib/recurrence/work-schedule-undo-access';
let schema: typeof DbModule;
afterEach(() => vi.restoreAllMocks());
beforeAll(async () => {
  schema = await getDb();
});
const fixture = (forest = false) => nativeRuntimeFixture(schema, forest);
const occurrence = (id: string) => nativeOccurrence(schema, id);
const move = (f: Awaited<ReturnType<typeof fixture>>, date: string) => nativeMove(schema, f, date);
describe('native schedule review regressions', () => {
  it('edits one generated leaf with a read-only unrelated native sibling and more than500 hand-created siblings', async () => {
    const f = await fixture(true);
    const dana = one(
      await schema.db
        .insert(schema.actor)
        .values({ organizationId: f.orgId, kind: 'human', displayName: 'Dana', status: 'active' })
        .returning(),
    );
    await schema.db.insert(schema.grant).values({
      organizationId: f.orgId,
      subjectKind: 'actor',
      subjectId: dana.id,
      resourceKind: 'project',
      resourceId: f.root.id,
      capabilities: ['contribute'],
      effect: 'allow',
      cascades: true,
    });
    await schema.db
      .update(schema.task)
      .set({ assigneeId: dana.id })
      .where(eq(schema.task.id, f.venue.id));
    await schema.db.insert(schema.task).values(
      Array.from({ length: 510 }, (_, index) => ({
        organizationId: f.orgId,
        teamId: f.teamId,
        projectId: f.root.id,
        title: `Independent task ${index}`,
        state: 'todo',
        statusId: f.statusId('task', 'todo'),
      })),
    );
    const response = await appWithActor(tasksRouter, f.orgId, ['contribute'], dana.id).request(
      `/${f.venue.id}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ dueDate: '2026-10-02' }),
      },
    );
    expect(response.status).toBe(200);
    expect(
      one(await schema.db.select().from(schema.task).where(eq(schema.task.id, f.venue.id))).dueDate,
    ).toEqual(new Date('2026-10-02'));
    expect((await occurrence(f.run.occurrenceId)).blueprintRootRefs).toEqual(f.run.roots);
  });
  it('reads a private timing prerequisite with View while editing only its affected Task', async () => {
    const f = await fixture(true);
    const other = f.run.roots.find((root) => root.id !== f.root.id);
    if (!other) throw new Error('Missing sibling root');
    const dana = one(
      await schema.db
        .insert(schema.actor)
        .values({ organizationId: f.orgId, kind: 'human', displayName: 'Dana', status: 'active' })
        .returning(),
    );
    await schema.db.insert(schema.grant).values([
      {
        organizationId: f.orgId,
        subjectKind: 'actor',
        subjectId: dana.id,
        resourceKind: 'project',
        resourceId: f.root.id,
        capabilities: ['contribute'],
        effect: 'allow',
        cascades: true,
      },
      {
        organizationId: f.orgId,
        subjectKind: 'actor',
        subjectId: dana.id,
        resourceKind: 'project',
        resourceId: other.id,
        capabilities: ['view'],
        effect: 'allow',
        cascades: true,
      },
    ]);
    const response = await appWithActor(tasksRouter, f.orgId, ['contribute'], dana.id).request(
      `/${f.venue.id}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ startDate: '2026-10-01' }),
      },
    );
    expect(response.status).toBe(200);
    expect(
      one(await schema.db.select().from(schema.task).where(eq(schema.task.id, f.venue.id))).dueDate,
    ).toEqual(new Date('2026-10-06'));
    expect(
      (await occurrence(f.run.occurrenceId)).scheduleDateOwnership?.find(
        (entry) => entry.id === f.venue.id,
      )?.manual,
    ).toBe(false);
  });
  it.each(['completed', 'diverged'])(
    'does not edit or count a %s private consumer subtree while its prerequisite moves',
    async (condition) => {
      const f = await fixture(true);
      const other = f.run.roots.find((root) => root.id !== f.root.id);
      if (!other) throw new Error('Missing sibling root');
      const dana = one(
        await schema.db
          .insert(schema.actor)
          .values({ organizationId: f.orgId, kind: 'human', displayName: 'Dana', status: 'active' })
          .returning(),
      );
      await schema.db.insert(schema.grant).values([
        {
          organizationId: f.orgId,
          subjectKind: 'actor',
          subjectId: dana.id,
          resourceKind: 'project',
          resourceId: f.root.id,
          capabilities: ['view'],
          effect: 'allow',
          cascades: true,
        },
        {
          organizationId: f.orgId,
          subjectKind: 'actor',
          subjectId: dana.id,
          resourceKind: 'project',
          resourceId: other.id,
          capabilities: ['contribute'],
          effect: 'allow',
          cascades: true,
        },
      ]);
      if (condition === 'completed') {
        const done = one(
          await schema.db
            .select()
            .from(schema.workStatus)
            .where(
              and(
                eq(schema.workStatus.organizationId, f.orgId),
                eq(schema.workStatus.entityType, 'task'),
                eq(schema.workStatus.category, 'completed'),
              ),
            ),
        );
        await schema.db
          .update(schema.task)
          .set({ state: done.key, statusId: done.id, completedAt: new Date() })
          .where(eq(schema.task.id, f.venue.id));
      } else
        await schema.db
          .update(schema.task)
          .set({ dueDate: new Date('2026-10-03') })
          .where(eq(schema.task.id, f.venue.id));
      await schema.db.insert(schema.task).values(
        Array.from({ length: 510 }, (_, index) => ({
          organizationId: f.orgId,
          teamId: f.teamId,
          projectId: f.root.id,
          parentTaskId: f.venue.id,
          title: `Independent descendant ${index}`,
          state: 'todo',
          statusId: f.statusId('task', 'todo'),
        })),
      );
      const response = await appWithActor(projectsRouter, f.orgId, ['contribute'], dana.id).request(
        `/${other.id}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ targetDate: '2026-10-15' }),
        },
      );
      expect(response.status).toBe(200);
      expect(
        one(await schema.db.select().from(schema.task).where(eq(schema.task.id, f.venue.id)))
          .dueDate,
      ).toEqual(new Date(condition === 'completed' ? '2026-10-06' : '2026-10-03'));
      expect(
        (await occurrence(f.run.occurrenceId)).scheduleDateOwnership?.find(
          (entry) => entry.id === f.venue.id,
        )?.manual,
      ).toBe(condition === 'diverged');
      const receipt = one(
        await schema.db
          .select()
          .from(schema.changeSet)
          .where(eq(schema.changeSet.organizationId, f.orgId))
          .orderBy(desc(schema.changeSet.id))
          .limit(1),
      );
      const changes = await schema.db
        .select()
        .from(schema.changeSetEntry)
        .where(eq(schema.changeSetEntry.changeSetId, receipt.id));
      expect(
        changes.some((entry) => entry.entityKind === 'task' && entry.entityId === f.venue.id),
      ).toBe(false);
      expect(
        changes.some(
          (entry) =>
            entry.entityKind === 'native_schedule_date_ownership' &&
            entry.after?.['workId'] === f.venue.id,
        ),
      ).toBe(false);
      if (condition === 'diverged') {
        await undoChangeSet(
          f.orgId,
          receipt.id,
          workScheduleUndoAccess({ ...f.caller, actorId: dana.id }),
        );
        expect(
          (await occurrence(f.run.occurrenceId)).scheduleDateOwnership?.find(
            (entry) => entry.id === f.venue.id,
          )?.manual,
        ).toBe(true);
        expect(
          one(await schema.db.select().from(schema.task).where(eq(schema.task.id, f.venue.id)))
            .dueDate,
        ).toEqual(new Date('2026-10-03'));
        expect(
          one(await schema.db.select().from(schema.project).where(eq(schema.project.id, other.id)))
            .targetDate,
        ).toEqual(new Date('2026-10-08'));
      }
    },
  );
  it('keeps an explicit same-value native pin reversible through a guarded companion-only receipt', async () => {
    const f = await fixture();
    const response = await appWithActor(
      projectsRouter,
      f.orgId,
      ['manage'],
      f.humanActorId,
    ).request(`/${f.root.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ targetDate: '2026-10-08' }),
    });
    expect(response.status).toBe(200);
    const receipt = one(
      await schema.db
        .select()
        .from(schema.changeSet)
        .where(eq(schema.changeSet.organizationId, f.orgId))
        .orderBy(desc(schema.changeSet.id))
        .limit(1),
    );
    expect((await occurrence(f.run.occurrenceId)).scheduleDateOwnership?.[0]?.manual).toBe(true);
    await undoChangeSet(f.orgId, receipt.id, workScheduleUndoAccess(f.caller));
    expect((await occurrence(f.run.occurrenceId)).scheduleDateOwnership?.[0]?.manual).toBe(false);
    await move(f, '2026-10-15');
    expect(
      one(await schema.db.select().from(schema.project).where(eq(schema.project.id, f.root.id)))
        .targetDate,
    ).toEqual(new Date('2026-10-15'));
  });
  it('restores native managed ownership with its work date on undo, then follows the next provider move', async () => {
    const f = await fixture();
    const response = await appWithActor(
      projectsRouter,
      f.orgId,
      ['manage'],
      f.humanActorId,
    ).request(`/${f.root.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ targetDate: '2026-10-12' }),
    });
    expect(response.status).toBe(200);
    expect((await occurrence(f.run.occurrenceId)).scheduleDateOwnership?.[0]?.manual).toBe(true);
    const receipt = one(
      await schema.db
        .select()
        .from(schema.changeSet)
        .where(eq(schema.changeSet.organizationId, f.orgId))
        .orderBy(desc(schema.changeSet.id))
        .limit(1),
    );
    await undoChangeSet(f.orgId, receipt.id);
    expect((await occurrence(f.run.occurrenceId)).scheduleDateOwnership?.[0]).toMatchObject({
      manual: false,
      lastDerivedDate: '2026-10-08',
    });
    await move(f, '2026-10-15');
    expect(
      one(await schema.db.select().from(schema.project).where(eq(schema.project.id, f.root.id)))
        .targetDate,
    ).toEqual(new Date('2026-10-15'));
  });
  it('refuses the whole native undo if another edit changed a recorded work date', async () => {
    const f = await fixture();
    const response = await appWithActor(
      projectsRouter,
      f.orgId,
      ['manage'],
      f.humanActorId,
    ).request(`/${f.root.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ targetDate: '2026-10-12' }),
    });
    expect(response.status).toBe(200);
    const receipt = one(
      await schema.db
        .select()
        .from(schema.changeSet)
        .where(eq(schema.changeSet.organizationId, f.orgId))
        .orderBy(desc(schema.changeSet.id))
        .limit(1),
    );
    await schema.db
      .update(schema.project)
      .set({ targetDate: new Date('2026-10-19') })
      .where(eq(schema.project.id, f.root.id));
    await expect(undoChangeSet(f.orgId, receipt.id)).rejects.toMatchObject({ status: 409 });
    expect((await occurrence(f.run.occurrenceId)).scheduleDateOwnership?.[0]?.manual).toBe(true);
    expect(
      one(await schema.db.select().from(schema.project).where(eq(schema.project.id, f.root.id)))
        .targetDate,
    ).toEqual(new Date('2026-10-19'));
  });
  it('moves a failed accepted provider run using its saved revision and retries the same claim', async () => {
    const base = await scheduleRouteFixture(schema, schedulesRouter);
    const saved = await createWorkSchedule(schema.db, {
      ...base.command,
      organizationId: base.orgId,
      actorId: base.humanActorId,
    });
    const input = {
      organizationId: base.orgId,
      seriesId: saved.series.id,
      seriesRevisionId: saved.revision.id,
      scheduledFor: '2026-10-08',
      externalOccurrenceKey: 'failed-provider-dinner',
    };
    vi.spyOn(creation, 'createWorkBatchInTransaction').mockRejectedValueOnce(
      new Error('Injected work failure'),
    );
    const first = await executeScheduleOccurrence(schema.db, input);
    expect(first.status).toBe('failed');
    const failed = await occurrence(first.occurrenceId);
    expect(failed.acceptedClaim).not.toBeNull();
    const future = await reviseWorkSchedule(schema.db, {
      ...base.command,
      organizationId: base.orgId,
      actorId: base.humanActorId,
      seriesId: saved.series.id,
      expectedRevisionId: saved.revision.id,
      effectiveFrom: '2099-11-01',
      document: WorkScheduleDraft.parse({
        ...base.command.document,
        titlePattern: '{month} Gathering',
      }),
    });
    await materializeOccurrence(schema.db, {
      ...input,
      seriesRevisionId: future.revision.id,
      scheduledFor: '2099-11-20',
    });
    const retried = await occurrence(first.occurrenceId);
    expect(retried).toMatchObject({
      seriesRevisionId: saved.revision.id,
      scheduledFor: '2099-11-20',
      originalScheduledFor: '2026-10-08',
      acceptedClaim: failed.acceptedClaim,
    });
    expect(retried.blueprintAppliedAt).not.toBeNull();
    expect(
      one(
        await schema.db
          .select()
          .from(schema.project)
          .where(eq(schema.project.organizationId, base.orgId)),
      ).targetDate,
    ).toEqual(new Date('2099-11-20'));
    expect(
      await schema.db
        .select()
        .from(schema.processOccurrence)
        .where(eq(schema.processOccurrence.seriesId, saved.series.id)),
    ).toHaveLength(1);
  });
});
