import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type * as DbModule from '@docket/db';
import { eq, sql } from 'drizzle-orm';
import { WorkScheduleForest } from '@docket/work/work-schedule-forest';
import type { PlannedWorkTree } from '@docket/work/blueprints';
import { CapabilityError, ConflictError, NotFoundError } from '../../src/error';
import {
  assertSchedulePlanBinding,
  authorizeScheduleContinuity,
  authorizeScheduleExecution,
  authorizeScheduleRevisionContinuity,
  requireScheduleRootBinding,
} from '../../src/lib/recurrence/schedule-authority';
import { executeScheduleOccurrence } from '../../src/lib/recurrence/schedule-runtime';
import * as creation from '../../src/lib/work-creation/service';
import { archiveWorkTemplate } from '../../src/lib/templates/service';
import { getDb } from '../support/routes-harness';
import { nativeOccurrence, nativeRuntimeFixture } from './work-schedule-native-runtime-fixture';

let schema: typeof DbModule;
beforeAll(async () => {
  schema = await getDb();
});
afterEach(() => vi.restoreAllMocks());

const UNKNOWN_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const FORGED = `sha256:${'0'.repeat(64)}`;
const EMPTY_TREE: PlannedWorkTree = {
  nodes: [],
  dependencies: [],
  manifest: [],
  warnings: [],
  fingerprint: 'empty',
};
type RuntimeFixture = Awaited<ReturnType<typeof nativeRuntimeFixture>>;
type AcceptedClaim = NonNullable<(typeof DbModule.processOccurrence.$inferSelect)['acceptedClaim']>;

/** Accept a second provider run but roll its work back, leaving an executable accepted claim. */
async function failedRun(f: RuntimeFixture) {
  vi.spyOn(creation, 'createWorkBatchInTransaction').mockRejectedValueOnce(
    new Error('Injected work failure'),
  );
  const run = await executeScheduleOccurrence(schema.db, {
    ...f.input,
    scheduledFor: '2026-11-12',
    externalOccurrenceKey: 'provider-event-43',
  });
  expect(run.status).toBe('failed');
  return run;
}
async function editClaim(
  occurrenceId: string,
  edit: (claim: AcceptedClaim) => AcceptedClaim,
): Promise<void> {
  const claim = (await nativeOccurrence(schema, occurrenceId)).acceptedClaim;
  if (!claim) throw new Error('Missing accepted claim');
  await forgePersistedState(() =>
    schema.db
      .update(schema.processOccurrence)
      .set({ acceptedClaim: edit(claim) })
      .where(eq(schema.processOccurrence.id, occurrenceId)),
  );
}
/** Simulate corrupted storage by bypassing the immutability triggers for one write. */
async function forgePersistedState(write: () => Promise<unknown>): Promise<void> {
  await schema.db.execute(sql`set session_replication_role = replica`);
  try {
    await write();
  } finally {
    await schema.db.execute(sql`set session_replication_role = origin`);
  }
}
function attempt(f: RuntimeFixture, run: { occurrenceId: string; attempt: number }) {
  return { organizationId: f.orgId, occurrenceId: run.occurrenceId, attempt: run.attempt };
}

describe('persisted schedule execution authority', () => {
  it('refuses an occurrence that is not a persisted scheduled run', async () => {
    const f = await nativeRuntimeFixture(schema);
    await schema.db.transaction(async (tx) => {
      await expect(
        authorizeScheduleExecution(tx, { ...attempt(f, f.run), occurrenceId: UNKNOWN_ID }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  it('refuses an accepted claim whose draft fingerprint no longer matches the revision', async () => {
    const f = await nativeRuntimeFixture(schema);
    const run = await failedRun(f);
    await editClaim(run.occurrenceId, (claim) => ({ ...claim, draftFingerprint: FORGED }));
    await schema.db.transaction(async (tx) => {
      await expect(authorizeScheduleExecution(tx, attempt(f, run))).rejects.toBeInstanceOf(
        CapabilityError,
      );
    });
  });

  it('refuses an accepted claim that does not cover every compiled root', async () => {
    const f = await nativeRuntimeFixture(schema);
    const run = await failedRun(f);
    await editClaim(run.occurrenceId, (claim) => ({
      ...claim,
      roots: claim.roots.map((root) => ({ ...root, key: 'unrelated' })),
    }));
    await schema.db.transaction(async (tx) => {
      await expect(authorizeScheduleExecution(tx, attempt(f, run))).rejects.toBeInstanceOf(
        CapabilityError,
      );
    });
  });

  it('binds each compiled root and refuses a planned tree that differs from the accepted selection', async () => {
    const f = await nativeRuntimeFixture(schema);
    const run = await failedRun(f);
    await schema.db.transaction(async (tx) => {
      const command = await authorizeScheduleExecution(tx, attempt(f, run));
      const root = command.roots[0]?.command;
      if (!root) throw new Error('Missing bound root');
      expect(requireScheduleRootBinding(tx, root)?.key).toBe(command.roots[0]?.key);
      expect(() => {
        assertSchedulePlanBinding(tx, root, EMPTY_TREE);
      }).toThrow(CapabilityError);
      const { scheduleBinding, ...invocation } = root.invocation;
      expect(scheduleBinding).toBeDefined();
      expect(() => {
        assertSchedulePlanBinding(tx, { ...root, invocation }, EMPTY_TREE);
      }).not.toThrow();
    });
  });
});

describe('persisted schedule continuity authority', () => {
  it('refuses continuity for an unknown or archived schedule revision', async () => {
    const f = await nativeRuntimeFixture(schema);
    const input = {
      organizationId: f.orgId,
      seriesRevisionId: f.schedule.revision.id,
      runDate: '2026-11-12',
    };
    await schema.db.transaction(async (tx) => {
      await expect(
        authorizeScheduleContinuity(tx, { ...input, seriesRevisionId: UNKNOWN_ID }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
    await schema.db
      .update(schema.recurrenceSeries)
      .set({ archivedAt: new Date() })
      .where(eq(schema.recurrenceSeries.id, f.schedule.series.id));
    await schema.db.transaction(async (tx) => {
      await expect(authorizeScheduleContinuity(tx, input)).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  it('refuses continuity from a newest accepted closure that no longer matches the revision', async () => {
    const f = await nativeRuntimeFixture(schema);
    await editClaim(f.run.occurrenceId, (claim) => ({ ...claim, draftFingerprint: FORGED }));
    await schema.db.transaction(async (tx) => {
      await expect(
        authorizeScheduleContinuity(tx, {
          organizationId: f.orgId,
          seriesRevisionId: f.schedule.revision.id,
          runDate: '2026-11-12',
        }),
      ).rejects.toBeInstanceOf(CapabilityError);
    });
  });

  it('refuses a revision edit against an unknown revision or a changed root structure', async () => {
    const f = await nativeRuntimeFixture(schema);
    const saved = f.schedule.revision.scheduleDraft;
    if (saved?.kind !== 'schedule') throw new Error('Expected a single-root saved draft');
    const input = {
      organizationId: f.orgId,
      actorId: f.humanActorId,
      seriesId: f.schedule.series.id,
      expectedRevisionId: f.schedule.revision.id,
      document: saved,
      runDate: '2026-11-12',
    };
    const forest = WorkScheduleForest.parse({
      kind: 'forest',
      revision: 1,
      state: 'published',
      roots: [
        { key: 'one', draft: saved },
        { key: 'two', draft: saved },
      ],
      dependencies: [],
      timing: [],
    });
    await schema.db.transaction(async (tx) => {
      await expect(
        authorizeScheduleRevisionContinuity(tx, { ...input, expectedRevisionId: UNKNOWN_ID }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
    await schema.db.transaction(async (tx) => {
      await expect(
        authorizeScheduleRevisionContinuity(tx, { ...input, document: forest }),
      ).rejects.toBeInstanceOf(ConflictError);
    });
  });

  it('continues an archived template through its accepted closure for creator and retained authority', async () => {
    const f = await nativeRuntimeFixture(schema);
    const saved = f.schedule.revision.scheduleDraft;
    if (saved?.kind !== 'schedule') throw new Error('Expected a single-root saved draft');
    await archiveWorkTemplate(f.caller, saved.template.workTypeId);
    const owned = await executeScheduleOccurrence(schema.db, {
      ...f.input,
      scheduledFor: '2026-11-12',
      externalOccurrenceKey: 'provider-archived-owned',
    });
    expect(owned.status).toBe('materialized');
    await schema.db
      .update(schema.recurrenceSeries)
      .set({ createdBy: null })
      .where(eq(schema.recurrenceSeries.id, f.schedule.series.id));
    const retained = await executeScheduleOccurrence(schema.db, {
      ...f.input,
      scheduledFor: '2026-12-10',
      externalOccurrenceKey: 'provider-archived-retained',
    });
    expect(retained.status).toBe('materialized');
    expect(retained.roots[0]?.kind).toBe(f.root.kind);
  });

  it('runs a schedule without creator attribution under its retained registered authority', async () => {
    const f = await nativeRuntimeFixture(schema);
    await schema.db
      .update(schema.recurrenceSeries)
      .set({ createdBy: null })
      .where(eq(schema.recurrenceSeries.id, f.schedule.series.id));
    const run = await executeScheduleOccurrence(schema.db, {
      ...f.input,
      scheduledFor: '2026-11-12',
      externalOccurrenceKey: 'provider-event-44',
    });
    expect(run).toMatchObject({ status: 'materialized', failureCode: null });
  });
});
