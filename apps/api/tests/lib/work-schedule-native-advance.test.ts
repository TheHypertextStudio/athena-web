import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '@docket/db';
import { ConflictError } from '../../src/error';
import {
  advanceNativeScheduleOccurrence,
  advanceNativeScheduleWork,
} from '../../src/lib/recurrence/schedule-native-completion';
import type { NativeScheduleFacts } from '../../src/lib/recurrence/schedule-native-facts';

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  find: vi.fn(),
  status: vi.fn(),
  execute: vi.fn(),
}));
vi.mock('../../src/lib/recurrence/schedule-native-facts', () => ({
  authorizeNativeScheduleOccurrence: mocks.authorize,
  findNativeScheduleOccurrence: mocks.find,
}));
vi.mock('../../src/lib/recurrence/schedule-native-status', () => ({
  readNativeScheduleStatus: mocks.status,
}));
vi.mock('../../src/lib/recurrence/schedule-runtime', () => ({
  executeScheduleOccurrence: mocks.execute,
}));

/** Rows the fake database answers, in the order the advance reads them. */
interface FakeRows {
  /** Successor occurrences found by each continuation lookup. */
  readonly continuations: string[][];
  /** Effective revisions found for the next scheduled date. */
  readonly revisions: string[];
}

/** Writes recorded by the fake database. */
interface FakeDatabase {
  readonly database: Database;
  readonly writes: Record<string, unknown>[];
}

function fakeDatabase(rows: FakeRows): FakeDatabase {
  const writes: Record<string, unknown>[] = [];
  const select = () => {
    let ordered = false;
    const builder = {
      from: () => builder,
      where: () => builder,
      orderBy: () => {
        ordered = true;
        return builder;
      },
      limit: async () =>
        ordered
          ? rows.revisions.map((id) => ({ id }))
          : (rows.continuations.shift() ?? []).map((id) => ({ id })),
    };
    return builder;
  };
  const tx = {
    select,
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          writes.push(values);
        },
      }),
    }),
  };
  const database = {
    select,
    transaction: async (run: (value: typeof tx) => Promise<unknown>) => run(tx),
  } as unknown as Database;
  return { database, writes };
}

/** Occurrence, cadence and document facts a test varies. */
interface FactsSeed {
  readonly status?: string;
  readonly completedAt?: Date | null;
  readonly document?: Record<string, unknown>;
  readonly roots?: readonly { readonly kind: string; readonly id: string }[];
  readonly seriesStatus?: string;
  readonly triggerKind?: string;
}

function facts(seed: FactsSeed = {}): NativeScheduleFacts {
  return {
    occurrence: {
      id: 'occurrence-1',
      status: seed.status ?? 'pending',
      completedAt: seed.completedAt ?? null,
    },
    document: seed.document ?? { kind: 'schedule', revision: 1 },
    roots: seed.roots ?? [{ kind: 'task', id: 'task-1' }],
    series: { id: 'series-1', status: seed.seriesStatus ?? 'active', archivedAt: null },
    revision: {
      triggerKind: seed.triggerKind ?? 'after_completion',
      interval: 1,
      intervalUnit: 'week',
    },
    timezone: 'UTC',
  } as unknown as NativeScheduleFacts;
}

const request = { organizationId: 'org-1', actorId: 'actor-1', occurrenceId: 'occurrence-1' };

beforeEach(() => {
  mocks.authorize.mockReset();
  mocks.find.mockReset();
  mocks.status.mockReset();
  mocks.execute.mockReset();
});

describe('native schedule occurrence advance', () => {
  it('leaves a canceled occurrence and open work unadvanced', async () => {
    const fake = fakeDatabase({ continuations: [], revisions: [] });
    mocks.authorize.mockResolvedValueOnce(facts({ status: 'canceled' }));
    expect(await advanceNativeScheduleOccurrence(fake.database, request)).toEqual({
      completed: false,
      nextOccurrenceId: null,
    });
    mocks.authorize.mockResolvedValueOnce(facts());
    mocks.status.mockResolvedValueOnce({ state: 'open', completedAt: null });
    expect(await advanceNativeScheduleOccurrence(fake.database, request)).toEqual({
      completed: false,
      nextOccurrenceId: null,
    });
    expect(fake.writes).toEqual([]);
  });

  it('records a canceled root as a canceled occurrence without a successor', async () => {
    const fake = fakeDatabase({ continuations: [], revisions: [] });
    mocks.authorize.mockResolvedValue(facts());
    mocks.status.mockResolvedValue({ state: 'canceled', completedAt: null });
    const result = await advanceNativeScheduleOccurrence(fake.database, request);
    expect(result).toEqual({ completed: false, nextOccurrenceId: null });
    expect(fake.writes).toEqual([expect.objectContaining({ status: 'canceled' })]);
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('keeps a previously stamped completion instant', async () => {
    const stamped = new Date('2026-10-05T12:00:00.000Z');
    const fake = fakeDatabase({ continuations: [[]], revisions: ['revision-2'] });
    mocks.authorize.mockResolvedValue(facts({ completedAt: stamped }));
    mocks.status.mockResolvedValue({ state: 'completed', completedAt: '2026-10-09T00:00:00.000Z' });
    mocks.execute.mockResolvedValue({ occurrenceId: 'occurrence-2' });
    const result = await advanceNativeScheduleOccurrence(fake.database, request);
    expect(result).toEqual({ completed: true, nextOccurrenceId: 'occurrence-2' });
    expect(fake.writes).toEqual([
      { status: 'completed', completedAt: stamped, resolvedAt: stamped },
    ]);
    expect(mocks.execute).toHaveBeenCalledWith(fake.database, {
      organizationId: 'org-1',
      seriesId: 'series-1',
      seriesRevisionId: 'revision-2',
      scheduledFor: '2026-10-12',
      continuedFromOccurrenceId: 'occurrence-1',
    });
  });

  it('continues an occurrence already marked completed without rewriting it', async () => {
    const fake = fakeDatabase({ continuations: [['occurrence-2']], revisions: [] });
    mocks.authorize.mockResolvedValue(facts({ status: 'completed', completedAt: null }));
    mocks.status.mockResolvedValue({ state: 'completed', completedAt: '2026-10-09T00:00:00.000Z' });
    expect(await advanceNativeScheduleOccurrence(fake.database, request)).toEqual({
      completed: true,
      nextOccurrenceId: 'occurrence-2',
    });
    expect(fake.writes).toEqual([]);
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('stamps a legacy revision 2 forest with the current time when no work recorded one', async () => {
    const fake = fakeDatabase({ continuations: [[]], revisions: [] });
    mocks.authorize.mockResolvedValue(
      facts({
        document: {
          kind: 'forest',
          revision: 2,
          completionPolicy: { kind: 'legacy_authored_tasks' },
        },
      }),
    );
    mocks.status.mockResolvedValue({ state: 'completed', completedAt: null });
    const before = Date.now();
    const result = await advanceNativeScheduleOccurrence(fake.database, request);
    expect(result).toEqual({ completed: true, nextOccurrenceId: null });
    const written = fake.writes[0]?.['completedAt'];
    expect(written).toBeInstanceOf(Date);
    expect((written as Date).getTime()).toBeGreaterThanOrEqual(before);
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('reuses a competing successor that won the continuation race', async () => {
    const fake = fakeDatabase({ continuations: [[], ['occurrence-3']], revisions: ['revision-2'] });
    mocks.authorize.mockResolvedValue(facts());
    mocks.status.mockResolvedValue({ state: 'completed', completedAt: '2026-10-09T00:00:00.000Z' });
    mocks.execute.mockRejectedValue(new ConflictError());
    expect(await advanceNativeScheduleOccurrence(fake.database, request)).toEqual({
      completed: true,
      nextOccurrenceId: 'occurrence-3',
    });
  });

  it('surfaces a conflict when no competing successor exists', async () => {
    const fake = fakeDatabase({ continuations: [[], []], revisions: ['revision-2'] });
    mocks.authorize.mockResolvedValue(facts());
    mocks.status.mockResolvedValue({ state: 'completed', completedAt: '2026-10-09T00:00:00.000Z' });
    mocks.execute.mockRejectedValue(new ConflictError());
    await expect(advanceNativeScheduleOccurrence(fake.database, request)).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it('surfaces a failure that is not a continuation conflict', async () => {
    const fake = fakeDatabase({ continuations: [[]], revisions: ['revision-2'] });
    mocks.authorize.mockResolvedValue(facts());
    mocks.status.mockResolvedValue({ state: 'completed', completedAt: '2026-10-09T00:00:00.000Z' });
    mocks.execute.mockRejectedValue(new TypeError('executor failed'));
    await expect(advanceNativeScheduleOccurrence(fake.database, request)).rejects.toBeInstanceOf(
      TypeError,
    );
  });

  it('does not continue a paused series or a calendar cadence', async () => {
    for (const seed of [{ seriesStatus: 'paused' }, { triggerKind: 'calendar' }]) {
      const fake = fakeDatabase({ continuations: [[]], revisions: ['revision-2'] });
      mocks.authorize.mockResolvedValue(facts(seed));
      mocks.status.mockResolvedValue({ state: 'completed', completedAt: null });
      expect(await advanceNativeScheduleOccurrence(fake.database, request)).toEqual({
        completed: true,
        nextOccurrenceId: null,
      });
    }
    expect(mocks.execute).not.toHaveBeenCalled();
  });
});

describe('native schedule work advance', () => {
  it('ignores work that no native occurrence produced', async () => {
    const fake = fakeDatabase({ continuations: [], revisions: [] });
    mocks.find.mockResolvedValue(null);
    expect(
      await advanceNativeScheduleWork(fake.database, {
        organizationId: 'org-1',
        work: { kind: 'task', id: 'task-1' },
      }),
    ).toBeNull();
    expect(mocks.authorize).not.toHaveBeenCalled();
  });

  it('advances without a foreground initiator when no actor is present', async () => {
    const fake = fakeDatabase({ continuations: [], revisions: [] });
    mocks.find.mockResolvedValue('occurrence-1');
    mocks.authorize.mockResolvedValue(facts({ status: 'canceled' }));
    await advanceNativeScheduleWork(fake.database, {
      organizationId: 'org-1',
      work: { kind: 'project', id: 'project-1' },
    });
    expect(mocks.authorize).toHaveBeenCalledWith(expect.anything(), {
      organizationId: 'org-1',
      actorId: undefined,
      occurrenceId: 'occurrence-1',
    });
  });
});
