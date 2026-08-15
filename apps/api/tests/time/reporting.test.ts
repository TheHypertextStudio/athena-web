/**
 * `time/reporting` branch coverage: personal (unscoped) submissions, workspace-scoped filtering,
 * both explicit "no reportable allocation" refusals, the empty-selection edge, every `measure`
 * variant, and the not-found paths.
 *
 * @remarks
 * `tests/routes/time.test.ts` already exercises the common HTTP path (organization-scoped,
 * `human_effort`, one allocation). This file calls `src/time/reporting.ts` directly so it can
 * seed exact intervals/allocations and hit the branches that path never reaches.
 */
import type * as DbModule from '@docket/db';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type {
  createTimeSubmission as CreateTimeSubmission,
  getTimeSubmission as GetTimeSubmission,
  listOrganizationTimeSubmissions as ListOrganizationTimeSubmissions,
} from '../../src/time/reporting';
import { addMember, getDb, one, seedBaseOrg, seedUserWithHub } from '../support/routes-harness';
import { assertDefined } from '@docket/test-utils';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let createTimeSubmission!: typeof CreateTimeSubmission;
let getTimeSubmission!: typeof GetTimeSubmission;
let listOrganizationTimeSubmissions!: typeof ListOrganizationTimeSubmissions;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  ({ createTimeSubmission, getTimeSubmission, listOrganizationTimeSubmissions } =
    await import('../../src/time/reporting'));
});

/** A user with a Hub, one workspace, one team, and one task anchor to track time against. */
interface Fixture {
  readonly userId: string;
  readonly hubId: string;
  readonly orgId: string;
  readonly taskId: string;
}

async function resolveHubId(userId: string): Promise<string> {
  const rows = await db
    .select({ id: schema.hub.id })
    .from(schema.hub)
    .where(eq(schema.hub.userId, userId))
    .limit(1);
  return one(rows).id;
}

async function seedFixture(label: string): Promise<Fixture> {
  const userId = await seedUserWithHub(db, schema, `Report-${label}`);
  const hubId = await resolveHubId(userId);
  const { orgId, teamId, statusId } = await seedBaseOrg(db, schema);
  await addMember(db, schema, orgId, userId);
  const taskId = one(
    await db
      .insert(schema.task)
      .values({
        organizationId: orgId,
        teamId,
        title: `Task ${label}`,
        state: 'todo',
        statusId: statusId('task', 'todo'),
      })
      .returning({ id: schema.task.id }),
  ).id;
  return { userId, hubId, orgId, taskId };
}

/** One interval spec, offsets in minutes from a fixed anchor instant. */
interface IntervalSpec {
  readonly mode: 'human_active' | 'agent_active';
  readonly startMin: number;
  readonly endMin: number;
}

/** One allocation spec. */
interface AllocationSpec {
  readonly targetKind: 'task' | 'workspace';
  readonly targetId: string;
  readonly organizationId?: string | null;
}

const ANCHOR = new Date('2026-07-01T09:00:00.000Z').getTime();

/** Seed a closed time record with explicit intervals and allocations. */
async function seedRecord(
  fixture: Fixture,
  intervals: readonly IntervalSpec[],
  allocations: readonly AllocationSpec[],
): Promise<string> {
  const start = new Date(ANCHOR + assertDefined(intervals[0]).startMin * 60_000);
  const end = new Date(ANCHOR + assertDefined(intervals[intervals.length - 1]).endMin * 60_000);
  const recordId = one(
    await db
      .insert(schema.timeRecord)
      .values({
        hubId: fixture.hubId,
        createdByUserId: fixture.userId,
        taskId: fixture.taskId,
        title: 'Reported work',
        status: 'closed',
        startedAt: start,
        endedAt: end,
        closedAt: end,
      })
      .returning({ id: schema.timeRecord.id }),
  ).id;
  for (const interval of intervals) {
    await db.insert(schema.timeInterval).values({
      timeRecordId: recordId,
      hubId: fixture.hubId,
      taskId: fixture.taskId,
      actorKind: interval.mode === 'agent_active' ? 'agent' : 'human',
      mode: interval.mode,
      source: 'user_timer',
      startedAt: new Date(ANCHOR + interval.startMin * 60_000),
      endedAt: new Date(ANCHOR + interval.endMin * 60_000),
    });
  }
  for (const allocation of allocations) {
    await db.insert(schema.timeAllocation).values({
      timeRecordId: recordId,
      targetKind: allocation.targetKind,
      targetId: allocation.targetId,
      organizationId: allocation.organizationId ?? null,
      basisPoints: 10_000,
    });
  }
  return recordId;
}

const PERIOD = {
  periodStartsAt: '2026-07-01T00:00:00.000Z',
  periodEndsAt: '2026-07-02T00:00:00.000Z',
  timezone: 'UTC',
  roundingPolicy: 'none',
} as const;

/**
 * Loose-input wrapper around {@link createTimeSubmission}: organization and time-record ids are
 * branded types in the real contract (enforced by the Zod schema at the route boundary), but this
 * file calls the module directly with plain seeded strings, exactly like the sibling
 * `tests/time/access.test.ts` casts do for the same reason.
 */
async function submit(
  userId: string,
  input: Omit<Parameters<typeof createTimeSubmission>[1], 'organizationId' | 'timeRecordIds'> & {
    readonly organizationId?: string;
    readonly timeRecordIds: readonly string[];
  },
): ReturnType<typeof createTimeSubmission> {
  return createTimeSubmission(userId, input as never);
}

describe('createTimeSubmission — record ownership', () => {
  it('refuses a time record id that does not exist under the caller’s Hub', async () => {
    const fixture = await seedFixture('bogus-record');
    await expect(
      submit(fixture.userId, {
        ...PERIOD,
        measure: 'human_effort',
        timeRecordIds: ['rec_does_not_exist'],
      }),
    ).rejects.toThrow('Time record not found');
  });
});

describe('createTimeSubmission — personal vs workspace scope', () => {
  it('creates an unscoped personal submission crediting every allocation regardless of workspace', async () => {
    const fixture = await seedFixture('personal');
    const other = await seedFixture('personal-other-org');
    const recordId = await seedRecord(
      fixture,
      [{ mode: 'human_active', startMin: 0, endMin: 30 }],
      [
        { targetKind: 'workspace', targetId: fixture.orgId, organizationId: fixture.orgId },
        { targetKind: 'workspace', targetId: other.orgId, organizationId: other.orgId },
      ],
    );

    const submission = await submit(fixture.userId, {
      ...PERIOD,
      measure: 'human_effort',
      timeRecordIds: [recordId],
    });

    expect(submission.organizationId).toBeNull();
    expect(submission.items).toHaveLength(2);
    expect(submission.items.map((item) => item.targetId).sort()).toEqual(
      [fixture.orgId, other.orgId].sort(),
    );
  });

  it('credits only the allocation scoped to the requested workspace, ignoring the rest', async () => {
    const fixture = await seedFixture('scoped');
    const other = await seedFixture('scoped-other-org');
    const recordId = await seedRecord(
      fixture,
      [{ mode: 'human_active', startMin: 0, endMin: 30 }],
      [
        { targetKind: 'workspace', targetId: fixture.orgId, organizationId: fixture.orgId },
        { targetKind: 'workspace', targetId: other.orgId, organizationId: other.orgId },
      ],
    );

    const submission = await submit(fixture.userId, {
      ...PERIOD,
      organizationId: fixture.orgId,
      measure: 'human_effort',
      timeRecordIds: [recordId],
    });

    expect(submission.organizationId).toBe(fixture.orgId);
    expect(submission.items).toHaveLength(1);
    expect(submission.items[0]?.targetId).toBe(fixture.orgId);
  });

  it('refuses a workspace-scoped submission when the record has no allocation in that workspace', async () => {
    const fixture = await seedFixture('mismatch');
    const other = await seedFixture('mismatch-other-org');
    const recordId = await seedRecord(
      fixture,
      [{ mode: 'human_active', startMin: 0, endMin: 30 }],
      [{ targetKind: 'workspace', targetId: other.orgId, organizationId: other.orgId }],
    );

    await expect(
      submit(fixture.userId, {
        ...PERIOD,
        organizationId: fixture.orgId,
        measure: 'human_effort',
        timeRecordIds: [recordId],
      }),
    ).rejects.toThrow('Every submitted record needs an allocation in the selected workspace');
  });

  it('refuses a personal submission when a record has no allocation at all', async () => {
    const fixture = await seedFixture('unallocated');
    const recordId = await seedRecord(
      fixture,
      [{ mode: 'human_active', startMin: 0, endMin: 30 }],
      [],
    );

    await expect(
      submit(fixture.userId, {
        ...PERIOD,
        measure: 'human_effort',
        timeRecordIds: [recordId],
      }),
    ).rejects.toThrow('Every submitted time record must have explicit allocations');
  });

  it('creates a zero-item submission for an empty record selection', async () => {
    const fixture = await seedFixture('empty-selection');

    const submission = await submit(fixture.userId, {
      ...PERIOD,
      measure: 'human_effort',
      timeRecordIds: [],
    });

    expect(submission.items).toEqual([]);
  });
});

describe('createTimeSubmission — measure variants', () => {
  it.each([
    ['human_effort', 20 * 60_000],
    ['agent_effort', 30 * 60_000],
    ['combined_effort', 50 * 60_000],
    ['elapsed_delivery', 70 * 60_000],
  ] as const)('reports %s as the item duration', async (measure, expectedMs) => {
    const fixture = await seedFixture(`measure-${measure}`);
    // Non-contiguous human (0-20) and agent (40-70) intervals make all four measures distinct:
    // human=20min, agent=30min, combined=50min, elapsed (wall clock 0-70)=70min.
    const recordId = await seedRecord(
      fixture,
      [
        { mode: 'human_active', startMin: 0, endMin: 20 },
        { mode: 'agent_active', startMin: 40, endMin: 70 },
      ],
      [{ targetKind: 'workspace', targetId: fixture.orgId, organizationId: fixture.orgId }],
    );

    const submission = await submit(fixture.userId, {
      ...PERIOD,
      organizationId: fixture.orgId,
      measure,
      timeRecordIds: [recordId],
    });

    expect(submission.items).toHaveLength(1);
    expect(submission.items[0]?.durationMs).toBe(expectedMs);
  });
});

describe('getTimeSubmission', () => {
  it('throws not-found for a submission outside the caller’s Hub', async () => {
    const fixture = await seedFixture('get-missing');
    await expect(getTimeSubmission(fixture.userId, 'sub_missing')).rejects.toThrow(
      'Time submission not found',
    );
  });

  it('reads back a submission it just created', async () => {
    const fixture = await seedFixture('get-roundtrip');
    const recordId = await seedRecord(
      fixture,
      [{ mode: 'human_active', startMin: 0, endMin: 30 }],
      [{ targetKind: 'workspace', targetId: fixture.orgId, organizationId: fixture.orgId }],
    );
    const created = await submit(fixture.userId, {
      ...PERIOD,
      organizationId: fixture.orgId,
      measure: 'human_effort',
      timeRecordIds: [recordId],
    });

    const reloaded = await getTimeSubmission(fixture.userId, created.id);
    expect(reloaded.id).toBe(created.id);
    expect(reloaded.items).toHaveLength(1);
  });
});

describe('listOrganizationTimeSubmissions', () => {
  it('refuses to project a submitted report missing its submittedAt watermark', async () => {
    const fixture = await seedFixture('list-defensive');
    const recordId = await seedRecord(
      fixture,
      [{ mode: 'human_active', startMin: 0, endMin: 30 }],
      [{ targetKind: 'workspace', targetId: fixture.orgId, organizationId: fixture.orgId }],
    );
    const created = await submit(fixture.userId, {
      ...PERIOD,
      organizationId: fixture.orgId,
      measure: 'human_effort',
      timeRecordIds: [recordId],
    });
    // Bypass the command layer entirely: no code path here ever leaves `status: 'submitted'`
    // with a null `submittedAt`, so this is the only way to exercise the read model's own guard
    // against that otherwise-impossible combination.
    await db
      .update(schema.timeSubmission)
      .set({ submittedAt: null })
      .where(eq(schema.timeSubmission.id, created.id));

    await expect(listOrganizationTimeSubmissions(fixture.orgId)).rejects.toThrow(
      'Submitted time report not found',
    );

    // The personal read model has no such guard — it serializes the same row as `null`, which
    // is the only way a real caller ever sees this (a still-open draft, never a submitted one).
    const reloaded = await getTimeSubmission(fixture.userId, created.id);
    expect(reloaded.submittedAt).toBeNull();
  });
});
