/** Refusal and fallback paths of recurrence series authoring, reads, and future edits. */
import {
  processRevision,
  recurrenceSeries,
  recurrenceSeriesRevision,
  recurrenceSeriesWeekday,
} from '@docket/db';
import { getTableName } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RecurrenceSeriesCreate } from '../../src/contracts/recurrence';
import { ConflictError, NotFoundError } from '../../src/error';
import type * as LegacyDefinitionAccess from '../../src/lib/recurrence/legacy-definition-access';
import {
  createRecurrenceSeriesInTransaction,
  editRecurrenceSeries,
  loadGeneratedWorkRecurrence,
  loadRecurrenceSeries,
  loadRecurrenceSeriesDetail,
  type RecurrenceTransaction,
} from '../../src/lib/recurrence/series';
import {
  queryFake,
  routedQueryFake,
  type QueryFake,
  type RecordedQuery,
} from './recurrence-query-fake';

const mocks = vi.hoisted(() => ({
  occurrences: vi.fn(),
  candidates: vi.fn(),
  retire: vi.fn(),
  lock: vi.fn(),
  registeredRevision: vi.fn(),
  binding: vi.fn(),
  definitionAccess: vi.fn(),
  scheduleAccess: vi.fn(),
  visible: vi.fn(),
  native: vi.fn(),
  hasPrivate: vi.fn(),
  createPrivate: vi.fn(),
  appendPrivate: vi.fn(),
  finish: vi.fn(),
}));
vi.mock('../../src/lib/recurrence/series-occurrence-output', () => ({
  occurrenceOutputs: mocks.occurrences,
}));
vi.mock('../../src/lib/recurrence/series-retirement', () => ({
  loadOccurrenceRetirementCandidates: mocks.candidates,
  retireGeneratedOccurrenceWork: mocks.retire,
}));
vi.mock('../../src/lib/recurrence/registered-series-definition', () => ({
  lockRegisteredSeriesDefinition: mocks.lock,
  insertCanonicalCompatibilitySeries: (write: () => PromiseLike<unknown>) => write(),
  registeredPublishedRevisionId: mocks.registeredRevision,
}));
vi.mock('../../src/lib/recurrence/work-template-series-binding', () => ({
  recurrenceBlueprintBinding: mocks.binding,
}));
vi.mock('../../src/lib/recurrence/legacy-definition-access', async (importOriginal) => ({
  ...(await importOriginal<typeof LegacyDefinitionAccess>()),
  requireLegacyDefinitionAccess: mocks.definitionAccess,
}));
vi.mock('../../src/lib/recurrence/schedule-access', () => ({
  requireScheduleAccess: mocks.scheduleAccess,
}));
vi.mock('../../src/lib/recurrence/legacy-work-visibility', () => ({
  visibleLegacyWorkReference: mocks.visible,
}));
vi.mock('../../src/lib/recurrence/schedule-native-backlinks', () => ({
  loadNativeGeneratedWorkRecurrence: mocks.native,
}));
vi.mock('../../src/lib/recurrence/private-definition-schedule', () => ({
  hasAuthoredPrivatePublication: mocks.hasPrivate,
  createCanonicalPrivateScheduleInTransaction: mocks.createPrivate,
  appendCanonicalPrivateScheduleInTransaction: mocks.appendPrivate,
}));
vi.mock('../../src/lib/task-state', () => ({ finishTaskStateTransition: mocks.finish }));

const organizationId = '01BX5ZZKBKACTAV9WEVGEMMV00';
const actorId = '01BX5ZZKBKACTAV9WEVGEMMV01';
const definitionId = '01BX5ZZKBKACTAV9WEVGEMMV02';
const seriesId = '01BX5ZZKBKACTAV9WEVGEMMV03';
const revisionId = '01BX5ZZKBKACTAV9WEVGEMMV04';
const processRevisionId = '01BX5ZZKBKACTAV9WEVGEMMV05';
const taskId = '01BX5ZZKBKACTAV9WEVGEMMV06';
const projectId = '01BX5ZZKBKACTAV9WEVGEMMV07';
const instanceId = '01BX5ZZKBKACTAV9WEVGEMMV08';
const occurrenceId = '01BX5ZZKBKACTAV9WEVGEMMV09';
const createdAt = new Date('2026-08-01T00:00:00.000Z');

const SERIES = getTableName(recurrenceSeries);
const REVISION = getTableName(recurrenceSeriesRevision);
const WEEKDAY = getTableName(recurrenceSeriesWeekday);
const PROCESS_REVISION = getTableName(processRevision);

interface SeriesRowOverrides {
  readonly definitionId?: string | null;
  readonly status?: 'active' | 'paused' | 'ended';
}

function seriesRow(overrides: SeriesRowOverrides = {}): Record<string, unknown> {
  return {
    id: seriesId,
    organizationId,
    definitionId,
    ownerProgramId: null,
    name: 'Weekly report',
    status: 'active',
    createdAt,
    updatedAt: createdAt,
    pausedAt: null,
    endedAt: null,
    ...overrides,
  };
}

function revisionRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: revisionId,
    seriesId,
    processRevisionId,
    number: 1,
    effectiveFrom: '2026-08-01',
    triggerKind: 'manual',
    createdAt,
    ...overrides,
  };
}

/** Latest-revision reads take one row; revision history reads are unbounded. */
function limited(query: RecordedQuery): boolean {
  return query.steps.some((step) => step.method === 'limit');
}

function tx(fake: QueryFake): RecurrenceTransaction {
  return fake.database as unknown as RecurrenceTransaction;
}

const manualSeries = RecurrenceSeriesCreate.parse({
  processDefinitionId: definitionId,
  name: 'Weekly report',
  trigger: { kind: 'manual' },
});

const calendarSeries = RecurrenceSeriesCreate.parse({
  processDefinitionId: definitionId,
  name: 'Weekly report',
  trigger: {
    kind: 'calendar',
    schedule: {
      kind: 'daily',
      interval: 1,
      startDate: '2098-09-01',
      timezone: 'UTC',
      end: { kind: 'never' },
    },
  },
});

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.occurrences.mockResolvedValue([]);
  mocks.candidates.mockResolvedValue([]);
  mocks.retire.mockResolvedValue({
    taskIds: [],
    projectIds: [],
    completedOccurrenceIds: [],
    cascades: [],
  });
  mocks.registeredRevision.mockResolvedValue(null);
  mocks.binding.mockResolvedValue({});
  mocks.hasPrivate.mockResolvedValue(false);
});

describe('createRecurrenceSeriesInTransaction', () => {
  it('delegates private publications with the calendar start as the default boundary', async () => {
    mocks.hasPrivate.mockResolvedValue(true);
    mocks.createPrivate.mockResolvedValue(seriesId);
    const fake = queryFake([]);
    await expect(
      createRecurrenceSeriesInTransaction(tx(fake), {
        organizationId,
        actorId,
        series: calendarSeries,
      }),
    ).resolves.toBe(seriesId);
    expect(mocks.createPrivate).toHaveBeenCalledWith(
      tx(fake),
      expect.objectContaining({ actorId, effectiveFrom: '2098-09-01' }),
    );
    expect(fake.queries).toHaveLength(0);
  });

  it('refuses a definition without a published revision', async () => {
    const fake = routedQueryFake({ [PROCESS_REVISION]: [] });
    await expect(
      createRecurrenceSeriesInTransaction(tx(fake), {
        organizationId,
        actorId,
        series: manualSeries,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('refuses when the series row is not returned', async () => {
    const fake = routedQueryFake({ [PROCESS_REVISION]: [{ revision: { id: processRevisionId } }] });
    await expect(
      createRecurrenceSeriesInTransaction(tx(fake), {
        organizationId,
        actorId,
        series: manualSeries,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('refuses when the first trigger revision is not returned', async () => {
    const fake = routedQueryFake({
      [PROCESS_REVISION]: [{ revision: { id: processRevisionId } }],
      [SERIES]: [{ id: seriesId }],
      [REVISION]: [],
    });
    await expect(
      createRecurrenceSeriesInTransaction(tx(fake), {
        organizationId,
        actorId,
        series: manualSeries,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(fake.queries.map((query) => [query.operation, query.table])).toEqual([
      ['select', PROCESS_REVISION],
      ['insert', SERIES],
      ['insert', REVISION],
    ]);
  });
});

describe('loadRecurrenceSeries', () => {
  it('refuses a missing series', async () => {
    const fake = routedQueryFake({ [SERIES]: [] });
    await expect(
      loadRecurrenceSeries(fake.database, organizationId, seriesId),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('refuses a series without any trigger revision', async () => {
    const fake = routedQueryFake({ [SERIES]: [seriesRow()], [REVISION]: [] });
    await expect(
      loadRecurrenceSeries(fake.database, organizationId, seriesId),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('falls back to the series and revision identities for definition-less schedules', async () => {
    const fake = routedQueryFake({
      [SERIES]: [seriesRow({ definitionId: null })],
      [REVISION]: [revisionRow({ processRevisionId: null })],
    });
    await expect(
      loadRecurrenceSeries(fake.database, organizationId, seriesId),
    ).resolves.toMatchObject({
      id: seriesId,
      processDefinitionId: seriesId,
      processRevisionId: revisionId,
    });
  });
});

describe('loadRecurrenceSeriesDetail', () => {
  it('reads revision history without a weekday lookup when there are no revisions', async () => {
    const fake = queryFake((query) => {
      if (query.table === SERIES) return [seriesRow()];
      if (query.table === REVISION) return limited(query) ? [revisionRow()] : [];
      return [];
    });
    const detail = await loadRecurrenceSeriesDetail(
      fake.database,
      organizationId,
      seriesId,
      actorId,
    );
    expect(detail.revisions).toEqual([]);
    expect(fake.queries.filter((query) => query.table === WEEKDAY)).toHaveLength(1);
  });

  it('falls back to the series revision identity in revision history', async () => {
    const fake = routedQueryFake({
      [SERIES]: [seriesRow()],
      [REVISION]: [revisionRow({ processRevisionId: null })],
    });
    const detail = await loadRecurrenceSeriesDetail(
      fake.database,
      organizationId,
      seriesId,
      actorId,
    );
    expect(detail.revisions).toEqual([
      expect.objectContaining({ id: revisionId, processRevisionId: revisionId }),
    ]);
    expect(fake.queries.filter((query) => query.table === WEEKDAY)).toHaveLength(2);
  });
});

describe('loadGeneratedWorkRecurrence', () => {
  const backlinkRow = {
    seriesId,
    seriesName: 'Weekly report',
    seriesStatus: 'active',
    processDefinitionId: definitionId,
    processInstanceId: instanceId,
    occurrenceId,
    scheduledFor: '2026-08-10',
    occurrenceStatus: 'materialized',
  };

  it('returns a native backlink before consulting legacy maps', async () => {
    const native = { kind: 'task', taskId };
    mocks.visible.mockResolvedValue(true);
    mocks.native.mockResolvedValue(native);
    const fake = queryFake([]);
    await expect(
      loadGeneratedWorkRecurrence(fake.database, { kind: 'task', organizationId, taskId }),
    ).resolves.toBe(native);
    expect(mocks.native).toHaveBeenCalledWith(fake.database, {
      organizationId,
      kind: 'task',
      id: taskId,
    });
    expect(fake.queries).toHaveLength(0);
  });

  it('returns null for a project without a legacy recurrence map', async () => {
    mocks.visible.mockResolvedValue(true);
    mocks.native.mockResolvedValue(null);
    const fake = queryFake([[]]);
    await expect(
      loadGeneratedWorkRecurrence(fake.database, {
        kind: 'project',
        organizationId,
        projectId,
        actorId,
      }),
    ).resolves.toBeNull();
    expect(mocks.scheduleAccess).not.toHaveBeenCalled();
  });

  it('propagates unexpected schedule access failures for legacy backlinks', async () => {
    const failure = new Error('connection lost');
    mocks.visible.mockResolvedValue(true);
    mocks.native.mockResolvedValue(null);
    mocks.scheduleAccess.mockRejectedValue(failure);
    const fake = queryFake([[backlinkRow]]);
    await expect(
      loadGeneratedWorkRecurrence(fake.database, { kind: 'task', organizationId, taskId, actorId }),
    ).rejects.toBe(failure);
  });

  it('hides legacy backlinks whose schedule the actor cannot read', async () => {
    mocks.visible.mockResolvedValue(true);
    mocks.native.mockResolvedValue(null);
    mocks.scheduleAccess.mockRejectedValue(new NotFoundError('Recurrence series not found'));
    const fake = queryFake([[backlinkRow]]);
    await expect(
      loadGeneratedWorkRecurrence(fake.database, { kind: 'task', organizationId, taskId, actorId }),
    ).resolves.toBeNull();
  });

  it('returns a visible legacy project backlink', async () => {
    mocks.visible.mockResolvedValue(true);
    mocks.native.mockResolvedValue(null);
    const fake = queryFake([[backlinkRow]]);
    await expect(
      loadGeneratedWorkRecurrence(fake.database, {
        kind: 'project',
        organizationId,
        projectId,
        actorId,
      }),
    ).resolves.toMatchObject({ kind: 'project', projectId, seriesId });
  });
});

describe('editRecurrenceSeries future scope', () => {
  const futureEdit = {
    scope: 'future',
    effectiveFrom: '2098-10-01',
    trigger: { kind: 'manual' },
  } as const;

  function edit(fake: QueryFake): Promise<unknown> {
    return editRecurrenceSeries(fake.database, {
      organizationId,
      actorId,
      seriesId,
      asOf: '2098-09-01',
      edit: futureEdit,
    });
  }

  it('refuses a series that cannot be found before locking', async () => {
    const fake = routedQueryFake({ [SERIES]: [] });
    await expect(edit(fake)).rejects.toBeInstanceOf(NotFoundError);
    expect(mocks.lock).not.toHaveBeenCalled();
  });

  it('refuses a series that disappears after the definition lock', async () => {
    let seriesReads = 0;
    const fake = queryFake((query) =>
      query.table === SERIES && seriesReads++ === 0 ? [{ definitionId }] : [],
    );
    await expect(edit(fake)).rejects.toBeInstanceOf(NotFoundError);
    expect(mocks.lock).toHaveBeenCalledOnce();
  });

  it('refuses when the locked definition changed underneath the edit', async () => {
    let seriesReads = 0;
    const fake = queryFake((query) =>
      query.table === SERIES
        ? [seriesReads++ === 0 ? { definitionId } : seriesRow({ definitionId: processRevisionId })]
        : [],
    );
    await expect(edit(fake)).rejects.toBeInstanceOf(ConflictError);
  });

  it('refuses template-owned schedules without a process definition', async () => {
    const fake = routedQueryFake({ [SERIES]: [seriesRow({ definitionId: null })], [REVISION]: [] });
    await expect(edit(fake)).rejects.toBeInstanceOf(ConflictError);
    expect(mocks.lock).not.toHaveBeenCalled();
    expect(mocks.definitionAccess).not.toHaveBeenCalled();
  });

  it('appends private publications after the latest schedule version', async () => {
    mocks.hasPrivate.mockResolvedValue(true);
    const fake = routedQueryFake({
      [SERIES]: [seriesRow()],
      [REVISION]: [revisionRow({ number: 2, effectiveFrom: '2098-09-15' })],
    });
    await edit(fake);
    expect(mocks.appendPrivate).toHaveBeenCalledWith(
      fake.database,
      expect.objectContaining({ actorId, definitionId, number: 3, effectiveFrom: '2098-10-01' }),
    );
    expect(fake.queries.filter((query) => query.operation === 'insert')).toHaveLength(0);
  });

  it('numbers the first private publication when no prior version exists', async () => {
    mocks.hasPrivate.mockResolvedValue(true);
    let revisionReads = 0;
    const fake = queryFake((query) => {
      if (query.table === SERIES) return [seriesRow()];
      if (query.table === REVISION) return revisionReads++ === 0 ? [] : [revisionRow()];
      return [];
    });
    await edit(fake);
    expect(mocks.appendPrivate).toHaveBeenCalledWith(
      fake.database,
      expect.objectContaining({ number: 1 }),
    );
  });

  it('numbers the first persisted revision when no prior version exists', async () => {
    let revisionReads = 0;
    const fake = queryFake((query) => {
      if (query.table === SERIES) return [seriesRow()];
      if (query.table === PROCESS_REVISION) return [{ revision: { id: processRevisionId } }];
      if (query.table === REVISION) {
        if (query.operation === 'insert') return [revisionRow()];
        return revisionReads++ === 0 ? [] : [revisionRow()];
      }
      return [];
    });
    await edit(fake);
    const values = fake.stepsOf('insert', 'values');
    expect(values).toEqual([[expect.objectContaining({ number: 1, effectiveFrom: '2098-10-01' })]]);
    expect(mocks.appendPrivate).not.toHaveBeenCalled();
  });
});
