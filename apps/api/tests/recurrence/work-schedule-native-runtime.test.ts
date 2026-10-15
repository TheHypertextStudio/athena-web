import {
  nativeRuntimeFixture,
  nativeOccurrence,
  nativeMove,
  nativePin,
} from './work-schedule-native-runtime-fixture';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type * as DbModule from '@docket/db';
import { and, eq } from 'drizzle-orm';
import { WorkScheduleDraft } from '@docket/work/work-schedule';
import { WorkTemplateDefinition } from '@docket/work/work-template-contract';
import {
  createWorkSchedule,
  reviseWorkSchedule,
} from '../../src/lib/recurrence/schedule-authoring';
import { transitionWorkSchedule } from '../../src/lib/recurrence/schedule-lifecycle';
import { recoverNativeScheduleContinuations } from '../../src/lib/recurrence/schedule-native-recovery';
import * as creation from '../../src/lib/work-creation/service';
import {
  executeScheduleOccurrence,
  retryScheduleOccurrence,
} from '../../src/lib/recurrence/schedule-runtime';
import { moveNativeScheduleOccurrence } from '../../src/lib/recurrence/schedule-native-movement';
import { advanceNativeScheduleOccurrence } from '../../src/lib/recurrence/schedule-native-completion';
import {
  authorizeNativeScheduleOccurrence,
  requireNativeScheduleFacts,
} from '../../src/lib/recurrence/schedule-native-facts';
import { loadNativeGeneratedWorkRecurrence } from '../../src/lib/recurrence/schedule-native-backlinks';
import { createWorkTemplate, publishWorkTemplate } from '../../src/lib/templates/service';
import tasksRouter from '../../src/routes/tasks';
import { appWithActor, getDb, one, seedTask } from '../support/routes-harness';
import type { NativeScheduleSnapshotAuthority } from '../../src/lib/recurrence/schedule-native-facts';

let schema: typeof DbModule;
beforeAll(async () => {
  schema = await getDb();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
const fixture = (forest = false, afterCompletion = false) =>
  nativeRuntimeFixture(schema, forest, afterCompletion);
const occurrence = (id: string) => nativeOccurrence(schema, id);
const move = (f: Awaited<ReturnType<typeof fixture>>, date: string) => nativeMove(schema, f, date);
const pin = nativePin;
describe('native actual occurrence movement and completion', () => {
  it('recovers exactly one saved completion after resume and an idempotent sweep retry', async () => {
    const f = await fixture(false, true);
    const access = {
      organizationId: f.orgId,
      actorId: f.humanActorId,
      seriesId: f.schedule.series.id,
    };
    await transitionWorkSchedule(schema.db, access, { action: 'pause' });
    const statuses = await schema.db
      .select()
      .from(schema.workStatus)
      .where(
        and(
          eq(schema.workStatus.organizationId, f.orgId),
          eq(schema.workStatus.category, 'completed'),
        ),
      );
    const taskStatus = one(statuses.filter((row) => row.entityType === 'task'));
    const projectStatus = one(statuses.filter((row) => row.entityType === 'project'));
    await schema.db
      .update(schema.task)
      .set({ state: taskStatus.key, statusId: taskStatus.id, completedAt: new Date() })
      .where(eq(schema.task.id, f.venue.id));
    await schema.db
      .update(schema.project)
      .set({ status: projectStatus.key, statusId: projectStatus.id })
      .where(eq(schema.project.id, f.root.id));
    expect(
      await advanceNativeScheduleOccurrence(schema.db, {
        organizationId: f.orgId,
        occurrenceId: f.run.occurrenceId,
      }),
    ).toEqual({ completed: true, nextOccurrenceId: null });
    await transitionWorkSchedule(schema.db, access, { action: 'resume' });
    const successors = await schema.db
      .select()
      .from(schema.processOccurrence)
      .where(eq(schema.processOccurrence.continuedFromOccurrenceId, f.run.occurrenceId));
    expect(successors).toHaveLength(1);
    expect(await recoverNativeScheduleContinuations(schema.db, access)).toBe(0);
    expect(
      await schema.db
        .select()
        .from(schema.processOccurrence)
        .where(eq(schema.processOccurrence.continuedFromOccurrenceId, f.run.occurrenceId)),
    ).toHaveLength(1);
  });
  it('records paused nullable-owner completion facts without inventing an actor or successor', async () => {
    const f = await fixture(false, true);
    const statuses = await schema.db
      .select()
      .from(schema.workStatus)
      .where(
        and(
          eq(schema.workStatus.organizationId, f.orgId),
          eq(schema.workStatus.category, 'completed'),
        ),
      );
    const taskStatus = one(statuses.filter((row) => row.entityType === 'task'));
    const projectStatus = one(statuses.filter((row) => row.entityType === 'project'));
    await schema.db
      .update(schema.task)
      .set({ state: taskStatus.key, statusId: taskStatus.id, completedAt: new Date() })
      .where(eq(schema.task.id, f.venue.id));
    await schema.db
      .update(schema.project)
      .set({ status: projectStatus.key, statusId: projectStatus.id })
      .where(eq(schema.project.id, f.root.id));
    await schema.db
      .update(schema.recurrenceSeries)
      .set({ createdBy: null, status: 'paused', pausedAt: new Date() })
      .where(eq(schema.recurrenceSeries.id, f.schedule.series.id));
    expect(
      await advanceNativeScheduleOccurrence(schema.db, {
        organizationId: f.orgId,
        occurrenceId: f.run.occurrenceId,
      }),
    ).toEqual({ completed: true, nextOccurrenceId: null });
    expect((await occurrence(f.run.occurrenceId)).status).toBe('completed');
    expect(
      await schema.db
        .select()
        .from(schema.processOccurrence)
        .where(eq(schema.processOccurrence.continuedFromOccurrenceId, f.run.occurrenceId)),
    ).toEqual([]);
  });
  it('moves the same provider dinner and preparation, retains its authored title, and preserves a hand-set/null date', async () => {
    const f = await fixture();
    await schema.db
      .update(schema.project)
      .set({ name: 'Dinner on the roof' })
      .where(eq(schema.project.id, f.root.id));
    await move(f, '2026-10-15');
    expect(
      one(await schema.db.select().from(schema.project).where(eq(schema.project.id, f.root.id))),
    ).toMatchObject({ name: 'Dinner on the roof', targetDate: new Date('2026-10-15') });
    expect(
      one(await schema.db.select().from(schema.task).where(eq(schema.task.id, f.venue.id))).dueDate,
    ).toEqual(new Date('2026-10-08'));
    await pin(f, '2026-10-08');
    await move(f, '2026-10-22');
    expect(
      one(await schema.db.select().from(schema.task).where(eq(schema.task.id, f.venue.id))).dueDate,
    ).toEqual(new Date('2026-10-08'));
    await pin(f, null);
    await move(f, '2026-10-29');
    expect(
      one(await schema.db.select().from(schema.task).where(eq(schema.task.id, f.venue.id))).dueDate,
    ).toBeNull();
    expect(await occurrence(f.run.occurrenceId)).toMatchObject({
      externalOccurrenceKey: 'provider-event-42',
      originalScheduledFor: '2026-10-08',
      scheduledFor: '2026-10-29',
      blueprintRootRefs: f.run.roots,
    });
    expect(
      (await executeScheduleOccurrence(schema.db, { ...f.input, scheduledFor: '2026-10-29' }))
        .roots,
    ).toEqual(f.run.roots);
    expect(
      await schema.db
        .select()
        .from(schema.project)
        .where(eq(schema.project.organizationId, f.orgId)),
    ).toHaveLength(1);
  });
  it('moves private forest-derived timing despite its generated manual marker and preserves a later same-value explicit pin', async () => {
    const f = await fixture(true);
    const before = await occurrence(f.run.occurrenceId);
    expect(before.scheduleDateOwnership?.find((entry) => entry.id === f.venue.id)).toMatchObject({
      manual: false,
      lastDerivedDate: '2026-10-06',
    });
    expect(
      one(await schema.db.select().from(schema.task).where(eq(schema.task.id, f.venue.id)))
        .blueprintDateBindings.dueDate?.manual,
    ).toBe(true);
    await move(f, '2026-10-15');
    expect(
      one(await schema.db.select().from(schema.task).where(eq(schema.task.id, f.venue.id))).dueDate,
    ).toEqual(new Date('2026-10-13'));
    await pin(f, '2026-10-13');
    await move(f, '2026-10-22');
    expect(
      one(await schema.db.select().from(schema.task).where(eq(schema.task.id, f.venue.id))).dueDate,
    ).toEqual(new Date('2026-10-13'));
    expect(
      (await occurrence(f.run.occurrenceId)).scheduleDateOwnership?.find(
        (entry) => entry.id === f.venue.id,
      )?.manual,
    ).toBe(true);
  });
  it('retains deleted preparation and terminal roots while denying a changed provider key or forged policy', async () => {
    const f = await fixture();
    await schema.db.delete(schema.task).where(eq(schema.task.id, f.venue.id));
    await move(f, '2026-10-15');
    expect(
      await schema.db.select().from(schema.task).where(eq(schema.task.id, f.venue.id)),
    ).toEqual([]);
    await expect(
      schema.db.transaction((tx) =>
        moveNativeScheduleOccurrence(tx, {
          organizationId: f.orgId,
          occurrenceId: f.run.occurrenceId,
          scheduledFor: '2026-10-22',
          externalOccurrenceKey: 'wrong-provider-key',
        }),
      ),
    ).rejects.toThrow();
    const saved = (await occurrence(f.run.occurrenceId)).scheduleDateOwnership;
    if (!saved) throw new Error('Missing registered dates');
    await expect(
      schema.db
        .update(schema.processOccurrence)
        .set({ scheduleDateOwnership: saved.map((entry) => ({ ...entry, id: f.program.id })) })
        .where(eq(schema.processOccurrence.id, f.run.occurrenceId)),
    ).rejects.toThrow();
    const completed = one(
      await schema.db
        .select()
        .from(schema.workStatus)
        .where(
          and(
            eq(schema.workStatus.organizationId, f.orgId),
            eq(schema.workStatus.entityType, 'project'),
            eq(schema.workStatus.category, 'completed'),
          ),
        ),
    );
    await schema.db
      .update(schema.project)
      .set({ statusId: completed.id, status: completed.key })
      .where(eq(schema.project.id, f.root.id));
    await advanceNativeScheduleOccurrence(schema.db, {
      organizationId: f.orgId,
      occurrenceId: f.run.occurrenceId,
    });
    await move(f, '2026-10-22');
    expect(
      one(await schema.db.select().from(schema.project).where(eq(schema.project.id, f.root.id)))
        .targetDate,
    ).toEqual(new Date('2026-10-15'));
  });
  it.each([false, true])(
    'uses actual Task completion and retains the same successor across future revision edits (failed: %s)',
    async (failSuccessor) => {
      const base = await fixture();
      const draft = await createWorkTemplate(base.caller, {
        targetType: 'task',
        scope: 'organization',
        offeredTeamIds: [],
        definition: WorkTemplateDefinition.parse({
          name: 'Water plants',
          payload: { targetType: 'task', title: 'Water plants' },
        }),
      });
      await publishWorkTemplate(base.caller, draft.id, draft.draftRevision);
      const document = WorkScheduleDraft.parse({
        kind: 'schedule',
        revision: 1,
        template: { targetType: 'task', workTypeId: draft.id, selection: { kind: 'latest' } },
        titlePattern: 'Water plants',
        timezone: 'America/Los_Angeles',
        root: { kind: 'task', fields: {}, dates: {}, placement: {}, teamId: base.teamId },
        stepOverrides: [],
        optionalChoices: [],
      });
      const schedule = await createWorkSchedule(schema.db, {
        organizationId: base.orgId,
        actorId: base.humanActorId,
        name: 'Water plants',
        document,
        effectiveFrom: '2026-10-08',
        trigger: { kind: 'after_completion', interval: 1, unit: 'day' },
      });
      const run = await executeScheduleOccurrence(schema.db, {
        organizationId: base.orgId,
        seriesId: schedule.series.id,
        seriesRevisionId: schedule.revision.id,
        scheduledFor: '2026-10-08',
      });
      const root = one(run.roots);
      const status = one(
        await schema.db
          .select()
          .from(schema.workStatus)
          .where(
            and(
              eq(schema.workStatus.organizationId, base.orgId),
              eq(schema.workStatus.entityType, 'task'),
              eq(schema.workStatus.category, 'completed'),
            ),
          ),
      );
      const completedAt = new Date('2026-11-02T00:30:00.000Z');
      await schema.db
        .update(schema.task)
        .set({ state: status.key, statusId: status.id, completedAt })
        .where(eq(schema.task.id, root.id));
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-11-05T12:00:00Z'));
      if (failSuccessor)
        vi.spyOn(creation, 'createWorkBatchInTransaction').mockRejectedValueOnce(
          new Error('Injected continuation failure'),
        );
      const next = await advanceNativeScheduleOccurrence(schema.db, {
        organizationId: base.orgId,
        occurrenceId: run.occurrenceId,
      });
      expect(next.completed).toBe(true);
      if (!next.nextOccurrenceId) throw new Error('Missing continuation');
      expect(await occurrence(next.nextOccurrenceId)).toMatchObject({
        scheduledFor: '2026-11-02',
        continuedFromOccurrenceId: run.occurrenceId,
        seriesRevisionId: schedule.revision.id,
        externalOccurrenceKey: null,
      });
      const acceptedSuccessor = await occurrence(next.nextOccurrenceId);
      expect(acceptedSuccessor.status).toBe(failSuccessor ? 'failed' : 'materialized');
      vi.setSystemTime(new Date('2026-10-15T12:00:00Z'));
      await reviseWorkSchedule(schema.db, {
        organizationId: base.orgId,
        actorId: base.humanActorId,
        seriesId: schedule.series.id,
        expectedRevisionId: schedule.revision.id,
        effectiveFrom: '2026-11-01',
        trigger: { kind: 'after_completion', interval: 1, unit: 'day' },
        document: { ...document, titlePattern: 'Water tomorrow' },
      });
      expect(
        (
          await advanceNativeScheduleOccurrence(schema.db, {
            organizationId: base.orgId,
            occurrenceId: run.occurrenceId,
          })
        ).nextOccurrenceId,
      ).toBe(next.nextOccurrenceId);
      expect(
        await schema.db
          .select()
          .from(schema.processOccurrence)
          .where(eq(schema.processOccurrence.continuedFromOccurrenceId, run.occurrenceId)),
      ).toHaveLength(1);
      expect((await occurrence(run.occurrenceId)).completedAt).toEqual(completedAt);
      expect((await occurrence(next.nextOccurrenceId)).acceptedClaim).toEqual(
        acceptedSuccessor.acceptedClaim,
      );
      if (failSuccessor) {
        expect((await occurrence(next.nextOccurrenceId)).status).toBe('failed');
        const retried = await retryScheduleOccurrence(schema.db, {
          organizationId: base.orgId,
          occurrenceId: next.nextOccurrenceId,
        });
        expect(retried.status).toBe('materialized');
        expect(retried.occurrenceId).toBe(next.nextOccurrenceId);
        expect((await occurrence(next.nextOccurrenceId)).seriesRevisionId).toBe(
          schedule.revision.id,
        );
        expect((await occurrence(next.nextOccurrenceId)).acceptedClaim).toEqual(
          acceptedSuccessor.acceptedClaim,
        );
      }
    },
  );
  it('rejects cross-transaction native authority and keeps actual backlinks private', async () => {
    const f = await fixture();
    let authority: NativeScheduleSnapshotAuthority | undefined;
    await schema.db.transaction(async (tx) => {
      authority = (
        await authorizeNativeScheduleOccurrence(tx, {
          organizationId: f.orgId,
          occurrenceId: f.run.occurrenceId,
        })
      ).authority;
    });
    if (!authority) throw new Error('Missing proof');
    const stale = authority;
    await expect(
      schema.db.transaction(async (tx) => requireNativeScheduleFacts(tx, stale)),
    ).rejects.toThrow();
    expect(
      await loadNativeGeneratedWorkRecurrence(schema.db, {
        organizationId: f.orgId,
        actorId: f.humanActorId,
        kind: 'project',
        id: f.root.id,
      }),
    ).toMatchObject({ occurrenceId: f.run.occurrenceId, seriesId: f.schedule.series.id });
    expect(
      await loadNativeGeneratedWorkRecurrence(schema.db, {
        organizationId: f.orgId,
        kind: 'project',
        id: f.root.id,
      }),
    ).toBeNull();
  });
  it('allows a current assignee after creator revocation without revealing another person’s private schedule', async () => {
    const f = await fixture();
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
      resourceKind: 'program',
      resourceId: f.program.id,
      capabilities: ['contribute'],
      effect: 'allow',
      cascades: true,
    });
    await schema.db
      .update(schema.task)
      .set({ assigneeId: dana.id })
      .where(eq(schema.task.id, f.venue.id));
    await schema.db
      .update(schema.actor)
      .set({ archivedAt: new Date() })
      .where(eq(schema.actor.id, f.humanActorId));
    const response = await appWithActor(tasksRouter, f.orgId, ['contribute'], dana.id).request(
      `/${f.venue.id}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ dueDate: '2026-10-01' }),
      },
    );
    expect(response.status).toBe(200);
    expect(
      await loadNativeGeneratedWorkRecurrence(schema.db, {
        organizationId: f.orgId,
        actorId: dana.id,
        kind: 'task',
        id: f.venue.id,
      }),
    ).toBeNull();
    expect(
      (
        await executeScheduleOccurrence(schema.db, {
          ...f.input,
          scheduledFor: '2026-10-15',
          externalOccurrenceKey: 'new-provider-after-creator-revocation',
        })
      ).status,
    ).toBe('failed');
    const unrelated = await seedTask(schema.db, schema, f.statusId, {
      organizationId: f.orgId,
      teamId: f.teamId,
      title: 'Unrelated preparation',
      state: 'todo',
      projectId: f.root.id,
    });
    await expect(
      schema.db.transaction((tx) =>
        authorizeNativeScheduleOccurrence(tx, {
          organizationId: f.orgId,
          occurrenceId: f.run.occurrenceId,
          actorId: dana.id,
          initiatingWork: { kind: 'task', id: unrelated.id },
        }),
      ),
    ).rejects.toThrow();
  });
});
