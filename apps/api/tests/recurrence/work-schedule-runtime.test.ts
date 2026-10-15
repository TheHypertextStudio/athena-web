import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type * as DbModule from '@docket/db';
import { and, eq } from 'drizzle-orm';
import { WorkScheduleDraft } from '@docket/work/work-schedule';
import { WorkTemplateDefinition } from '@docket/work/work-template-contract';
import {
  createWorkSchedule,
  reviseWorkSchedule,
} from '../../src/lib/recurrence/schedule-authoring';
import {
  executeScheduleOccurrence,
  retryScheduleOccurrence,
} from '../../src/lib/recurrence/schedule-runtime';
import { authorizeScheduleExecution } from '../../src/lib/recurrence/schedule-authority';
import * as creation from '../../src/lib/work-creation/service';
import {
  createWorkTemplate,
  editWorkTemplateDraft,
  publishWorkTemplate,
  archiveWorkTemplate,
} from '../../src/lib/templates/service';
import { getDb, one, seedTaskAccessOrg } from '../support/routes-harness';

let schema: typeof DbModule;
beforeAll(async () => {
  schema = await getDb();
});
afterEach(() => vi.restoreAllMocks());
function definition(child = 'Book venue') {
  return WorkTemplateDefinition.parse({
    name: 'Dinner',
    payload: { targetType: 'project', name: 'Dinner' },
    blueprint: {
      steps: [
        {
          key: 'book_venue',
          kind: 'task',
          parentStepKey: null,
          sort: 0,
          fields: { title: child },
          template: null,
          optional: { enabled: false, selectedByDefault: true },
          teamRule: 'parent_team',
          actorRule: 'unassigned',
          cycleRule: 'none',
          dates: {
            dueDate: {
              kind: 'anchor',
              anchor: { kind: 'parent' },
              offset: { days: -7, unit: 'calendar' },
            },
          },
        },
      ],
      dependencies: [],
    },
  });
}
async function fixture() {
  const base = await seedTaskAccessOrg(schema.db, schema, 'manage');
  const caller = {
    orgId: base.orgId,
    actorId: base.humanActorId,
    roleId: null,
    capabilities: ['manage'],
  };
  const draft = await createWorkTemplate(caller, {
    targetType: 'project',
    scope: 'organization',
    offeredTeamIds: [],
    definition: definition(),
  });
  const published = await publishWorkTemplate(caller, draft.id, draft.draftRevision);
  const schedule = await createWorkSchedule(schema.db, {
    organizationId: base.orgId,
    actorId: base.humanActorId,
    name: 'Dinner',
    effectiveFrom: '2026-10-08',
    trigger: { kind: 'manual' },
    document: WorkScheduleDraft.parse({
      kind: 'schedule',
      revision: 1,
      template: { targetType: 'project', workTypeId: draft.id, selection: { kind: 'latest' } },
      titlePattern: '{month} Dinner',
      timezone: 'America/Los_Angeles',
      root: { kind: 'project', fields: {}, dates: {}, placement: {}, teamId: base.teamId },
      stepOverrides: [],
      optionalChoices: [],
    }),
  });
  const input = {
    organizationId: base.orgId,
    seriesId: schedule.series.id,
    seriesRevisionId: schedule.revision.id,
    scheduledFor: '2026-10-08',
  };
  return { ...base, caller, published, schedule, input };
}
async function occurrence(id: string) {
  return one(
    await schema.db
      .select()
      .from(schema.processOccurrence)
      .where(eq(schema.processOccurrence.id, id)),
  );
}
describe('durable canonical schedule execution', () => {
  it('rolls all work back but retains the exact failed claim across v2 publication and archive, then creates one forest', async () => {
    const f = await fixture();
    const original = creation.createWorkBatchInTransaction;
    vi.spyOn(creation, 'createWorkBatchInTransaction').mockImplementationOnce(
      async (tx, command) => {
        await original(tx, command);
        throw new Error('Injected failure after all work writes');
      },
    );
    const failed = await executeScheduleOccurrence(schema.db, f.input);
    expect(failed.status).toBe('failed');
    const claim = (await occurrence(failed.occurrenceId)).acceptedClaim;
    expect(claim?.roots[0]?.versionId).toBe(f.published.latestPublishedVersionId);
    expect(
      await schema.db
        .select()
        .from(schema.project)
        .where(eq(schema.project.organizationId, f.orgId)),
    ).toHaveLength(0);
    expect(
      await schema.db.select().from(schema.task).where(eq(schema.task.organizationId, f.orgId)),
    ).toHaveLength(0);
    const edited = await editWorkTemplateDraft(f.caller, f.published.id, {
      expectedRevision: f.published.draftRevision,
      definition: definition('Changed v2 title'),
    });
    const v2 = await publishWorkTemplate(f.caller, edited.id, edited.draftRevision);
    await archiveWorkTemplate(f.caller, v2.id);
    const retried = await retryScheduleOccurrence(schema.db, {
      organizationId: f.orgId,
      occurrenceId: failed.occurrenceId,
    });
    expect(retried.status).toBe('materialized');
    expect((await occurrence(failed.occurrenceId)).acceptedClaim).toEqual(claim);
    expect(
      await schema.db.select().from(schema.task).where(eq(schema.task.organizationId, f.orgId)),
    ).toEqual([expect.objectContaining({ title: 'Book venue', dueDate: new Date('2026-10-01') })]);
    const replay = await executeScheduleOccurrence(schema.db, f.input);
    expect(replay.roots).toEqual(retried.roots);
    expect(replay.attempt).toBe(2);
    expect(
      await schema.db
        .select()
        .from(schema.project)
        .where(eq(schema.project.organizationId, f.orgId)),
    ).toHaveLength(1);
    expect(
      await schema.db
        .select()
        .from(schema.processInstance)
        .where(eq(schema.processInstance.organizationId, f.orgId)),
    ).toHaveLength(0);
  });
  it('rechecks live creator permissions on retry while retaining the original accepted closure', async () => {
    const f = await fixture();
    vi.spyOn(creation, 'createWorkBatchInTransaction').mockRejectedValueOnce(
      new Error('Injected work failure'),
    );
    const failed = await executeScheduleOccurrence(schema.db, f.input);
    const claim = (await occurrence(failed.occurrenceId)).acceptedClaim;
    await schema.db
      .update(schema.actor)
      .set({ status: 'suspended' })
      .where(eq(schema.actor.id, f.humanActorId));
    const denied = await retryScheduleOccurrence(schema.db, {
      organizationId: f.orgId,
      occurrenceId: failed.occurrenceId,
    });
    expect(denied.status).toBe('failed');
    expect((await occurrence(failed.occurrenceId)).acceptedClaim).toEqual(claim);
    expect(
      await schema.db
        .select()
        .from(schema.project)
        .where(eq(schema.project.organizationId, f.orgId)),
    ).toHaveLength(0);
    await schema.db
      .update(schema.actor)
      .set({ status: 'active' })
      .where(eq(schema.actor.id, f.humanActorId));
    expect(
      (
        await retryScheduleOccurrence(schema.db, {
          organizationId: f.orgId,
          occurrenceId: failed.occurrenceId,
        })
      ).status,
    ).toBe('materialized');
  });
  it('uses the newest accepted complete same-revision closure for later archive continuation', async () => {
    const f = await fixture();
    const first = await executeScheduleOccurrence(schema.db, f.input);
    const edited = await editWorkTemplateDraft(f.caller, f.published.id, {
      expectedRevision: f.published.draftRevision,
      definition: definition('New accepted title'),
    });
    const v2 = await publishWorkTemplate(f.caller, edited.id, edited.draftRevision);
    vi.spyOn(creation, 'createWorkBatchInTransaction').mockRejectedValueOnce(
      new Error('Failure after v2 acceptance'),
    );
    const second = await executeScheduleOccurrence(schema.db, {
      ...f.input,
      scheduledFor: '2026-11-12',
    });
    expect(second.status).toBe('failed');
    const accepted = await occurrence(second.occurrenceId);
    expect(accepted.acceptedClaim?.roots[0]?.versionId).toBe(v2.latestPublishedVersionId);
    expect(accepted.acceptanceOrdinal).toBeGreaterThan(
      (await occurrence(first.occurrenceId)).acceptanceOrdinal ?? 0,
    );
    await archiveWorkTemplate(f.caller, v2.id);
    const third = await executeScheduleOccurrence(schema.db, {
      ...f.input,
      scheduledFor: '2026-12-10',
    });
    expect(third.status).toBe('materialized');
    expect((await occurrence(third.occurrenceId)).acceptedClaim?.roots).toEqual(
      accepted.acceptedClaim?.roots,
    );
  });
  it('rejects stale worker attempts and terminal runs before acquiring work authority', async () => {
    const f = await fixture();
    vi.spyOn(creation, 'createWorkBatchInTransaction').mockRejectedValueOnce(
      new Error('Injected work failure'),
    );
    const failed = await executeScheduleOccurrence(schema.db, f.input);
    await schema.db.transaction(async (tx) => {
      await expect(
        authorizeScheduleExecution(tx, {
          organizationId: f.orgId,
          occurrenceId: failed.occurrenceId,
          attempt: failed.attempt - 1,
        }),
      ).rejects.toThrow();
    });
    await schema.db
      .update(schema.processOccurrence)
      .set({ status: 'canceled' })
      .where(
        and(
          eq(schema.processOccurrence.id, failed.occurrenceId),
          eq(schema.processOccurrence.attempt, failed.attempt),
        ),
      );
    await expect(
      retryScheduleOccurrence(schema.db, {
        organizationId: f.orgId,
        occurrenceId: failed.occurrenceId,
      }),
    ).rejects.toThrow();
  });
  it('prevents a stale failure recorder from overwriting a later successful attempt', async () => {
    const f = await fixture();
    vi.spyOn(creation, 'createWorkBatchInTransaction').mockRejectedValueOnce(
      new Error('First worker failed'),
    );
    let announceFailure: () => void = () => {
      throw new Error('Failure barrier is not initialized');
    };
    let releaseFailure: () => void = () => {
      throw new Error('Failure barrier is not initialized');
    };
    const failureReady = new Promise<void>((resolve) => {
      announceFailure = resolve;
    });
    const failureGate = new Promise<void>((resolve) => {
      releaseFailure = resolve;
    });
    let transactions = 0;
    const database = new Proxy(schema.db, {
      get(target, key, receiver) {
        if (key !== 'transaction') return Reflect.get(target, key, receiver);
        return async (...args: Parameters<typeof schema.db.transaction>) => {
          transactions++;
          if (transactions === 4) {
            announceFailure();
            await failureGate;
          }
          return target.transaction(...args);
        };
      },
    });
    const first = executeScheduleOccurrence(database, f.input);
    await failureReady;
    const successful = await executeScheduleOccurrence(database, f.input);
    expect(successful.status).toBe('materialized');
    releaseFailure();
    await expect(first).rejects.toThrow('The schedule attempt changed.');
    expect(await occurrence(successful.occurrenceId)).toMatchObject({
      attempt: 2,
      status: 'materialized',
      failureCode: null,
      failedAt: null,
    });
  });
  it('refuses an otherwise valid persisted capability in a different transaction', async () => {
    const f = await fixture();
    vi.spyOn(creation, 'createWorkBatchInTransaction').mockRejectedValueOnce(
      new Error('Keep accepted claim without work'),
    );
    const failed = await executeScheduleOccurrence(schema.db, f.input);
    const command = await schema.db.transaction((tx) =>
      authorizeScheduleExecution(tx, {
        organizationId: f.orgId,
        occurrenceId: failed.occurrenceId,
        attempt: failed.attempt,
      }),
    );
    await schema.db.transaction(async (tx) => {
      await expect(creation.createWorkBatchInTransaction(tx, command)).rejects.toThrow('Forbidden');
    });
    expect(
      await schema.db
        .select()
        .from(schema.project)
        .where(eq(schema.project.organizationId, f.orgId)),
    ).toHaveLength(0);
  });
  it('retains every nested latest publication on failed retry after a nested publication and root archive', async () => {
    const f = await fixture();
    const vendorDefinition = (title: string) =>
      WorkTemplateDefinition.parse({
        name: 'Vendor booking',
        payload: { targetType: 'task', title: 'Vendor booking' },
        blueprint: {
          steps: [{ ...definition().blueprint.steps[0], key: 'confirm', fields: { title } }],
          dependencies: [],
        },
      });
    const vendorDraft = await createWorkTemplate(f.caller, {
      targetType: 'task',
      scope: 'organization',
      offeredTeamIds: [],
      definition: vendorDefinition('Confirm deposit v1'),
    });
    const vendorV1 = await publishWorkTemplate(f.caller, vendorDraft.id, vendorDraft.draftRevision);
    const rootDefinition = definition();
    const revisedRoot = await editWorkTemplateDraft(f.caller, f.published.id, {
      expectedRevision: f.published.draftRevision,
      definition: WorkTemplateDefinition.parse({
        ...rootDefinition,
        blueprint: {
          ...rootDefinition.blueprint,
          steps: [
            ...rootDefinition.blueprint.steps,
            {
              ...rootDefinition.blueprint.steps[0],
              key: 'vendor',
              fields: { title: 'Vendor booking' },
              template: { workTypeId: vendorV1.id, selection: { kind: 'latest' } },
            },
          ],
        },
      }),
    });
    const rootV2 = await publishWorkTemplate(f.caller, revisedRoot.id, revisedRoot.draftRevision);
    vi.spyOn(creation, 'createWorkBatchInTransaction').mockRejectedValueOnce(
      new Error('Keep exact nested claim'),
    );
    const failed = await executeScheduleOccurrence(schema.db, f.input);
    const claim = (await occurrence(failed.occurrenceId)).acceptedClaim;
    expect(claim?.roots[0]?.resolvedManifest).toContainEqual(
      expect.objectContaining({ path: ['vendor'], versionId: vendorV1.latestPublishedVersionId }),
    );
    const editedVendor = await editWorkTemplateDraft(f.caller, vendorV1.id, {
      expectedRevision: vendorV1.draftRevision,
      definition: vendorDefinition('Confirm deposit v2'),
    });
    await publishWorkTemplate(f.caller, editedVendor.id, editedVendor.draftRevision);
    await archiveWorkTemplate(f.caller, rootV2.id);
    const retried = await retryScheduleOccurrence(schema.db, {
      organizationId: f.orgId,
      occurrenceId: failed.occurrenceId,
    });
    expect(retried.status).toBe('materialized');
    expect((await occurrence(failed.occurrenceId)).acceptedClaim).toEqual(claim);
    const tasks = await schema.db
      .select()
      .from(schema.task)
      .where(eq(schema.task.organizationId, f.orgId));
    expect(tasks.map((task) => task.title).sort()).toEqual([
      'Book venue',
      'Confirm deposit v1',
      'Vendor booking',
    ]);
  });
  it('edits future archived schedules through registered source closure while preserving past claims', async () => {
    const f = await fixture();
    const run = await executeScheduleOccurrence(schema.db, f.input);
    const saved = await occurrence(run.occurrenceId);
    await archiveWorkTemplate(f.caller, f.published.id);
    const original = WorkScheduleDraft.parse(f.schedule.revision.scheduleDraft);
    const revised = await reviseWorkSchedule(schema.db, {
      organizationId: f.orgId,
      actorId: f.humanActorId,
      seriesId: f.schedule.series.id,
      expectedRevisionId: f.schedule.revision.id,
      effectiveFrom: '2026-11-12',
      trigger: { kind: 'manual' },
      document: { ...original, titlePattern: 'Updated {month} Dinner' },
    });
    expect(revised.revision.authoringFallback?.roots).toEqual(saved.acceptedClaim?.roots);
    expect(revised.revision.authoringFallback?.draftFingerprint).not.toBe(
      saved.acceptedClaim?.draftFingerprint,
    );
    expect((await occurrence(run.occurrenceId)).acceptedClaim).toEqual(saved.acceptedClaim);
    const next = await executeScheduleOccurrence(schema.db, {
      ...f.input,
      seriesRevisionId: revised.revision.id,
      scheduledFor: '2026-11-12',
    });
    expect(next.status).toBe('materialized');
    expect(
      await schema.db
        .select()
        .from(schema.project)
        .where(eq(schema.project.id, next.roots[0]?.id ?? 'missing')),
    ).toEqual([expect.objectContaining({ name: 'Updated November Dinner' })]);
    await expect(
      createWorkSchedule(schema.db, {
        organizationId: f.orgId,
        actorId: f.humanActorId,
        name: 'New archived schedule',
        document: original,
        effectiveFrom: '2026-12-10',
        trigger: { kind: 'manual' },
      }),
    ).rejects.toThrow();
    await expect(
      reviseWorkSchedule(schema.db, {
        organizationId: f.orgId,
        actorId: f.humanActorId,
        seriesId: f.schedule.series.id,
        expectedRevisionId: revised.revision.id,
        effectiveFrom: '2026-12-10',
        trigger: { kind: 'manual' },
        document: {
          ...original,
          template: {
            ...original.template,
            selection: {
              kind: 'pinned',
              workTypeVersionId: one(saved.acceptedClaim?.roots ?? []).versionId,
            },
          },
        },
      }),
    ).rejects.toThrow();
  });
});
