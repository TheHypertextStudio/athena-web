/** Retirement of generated occurrence work for native and retained compatibility runs. */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TemplateTransaction } from '../../src/lib/templates/persistence';
import {
  loadOccurrenceRetirementCandidates,
  retireGeneratedOccurrenceWork,
  type OccurrenceRetirementCandidate,
} from '../../src/lib/recurrence/series-retirement';
import { queryFake } from './recurrence-query-fake';

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  snapshot: vi.fn(),
  cascade: vi.fn(),
}));
vi.mock('../../src/lib/recurrence/schedule-native-facts', () => ({
  authorizeNativeScheduleOccurrence: mocks.authorize,
}));
vi.mock('../../src/lib/recurrence/schedule-native-snapshot', () => ({
  loadNativeScheduleSnapshot: mocks.snapshot,
}));
vi.mock('../../src/lib/task-state', () => ({
  applySubtaskCompletionPolicyForParents: mocks.cascade,
}));

const organizationId = 'org-1';
const now = new Date('2026-08-12T12:00:00.000Z');

function candidate(
  overrides: Partial<OccurrenceRetirementCandidate>,
): OccurrenceRetirementCandidate {
  return {
    occurrenceId: 'occurrence-1',
    instanceId: null,
    native: false,
    applied: false,
    ...overrides,
  };
}

function transaction(results: readonly unknown[]): {
  readonly tx: TemplateTransaction;
  readonly fake: ReturnType<typeof queryFake>;
} {
  const fake = queryFake(results);
  return { tx: fake.database as unknown as TemplateTransaction, fake };
}

beforeEach(() => {
  mocks.authorize.mockReset();
  mocks.snapshot.mockReset();
  mocks.cascade.mockReset();
  mocks.cascade.mockResolvedValue([]);
});

describe('loadOccurrenceRetirementCandidates', () => {
  it('attaches legacy instances only to unconverted runs', async () => {
    const { tx, fake } = transaction([
      [
        { occurrenceId: 'legacy-mapped', native: false, applied: false },
        { occurrenceId: 'legacy-unmapped', native: false, applied: false },
        { occurrenceId: 'native', native: true, applied: true },
      ],
      [{ occurrenceId: 'legacy-mapped', id: 'instance-1' }],
    ]);
    const result = await loadOccurrenceRetirementCandidates(tx, {
      organizationId,
      seriesId: 'series-1',
      on: '2026-08-12',
    });
    expect(result).toEqual([
      { occurrenceId: 'legacy-mapped', native: false, applied: false, instanceId: 'instance-1' },
      { occurrenceId: 'legacy-unmapped', native: false, applied: false, instanceId: null },
      { occurrenceId: 'native', native: true, applied: true, instanceId: null },
    ]);
    expect(fake.queries).toHaveLength(2);
  });

  it('does not read legacy instances when every run is native', async () => {
    const { tx, fake } = transaction([[{ occurrenceId: 'native', native: true, applied: false }]]);
    const result = await loadOccurrenceRetirementCandidates(tx, {
      organizationId,
      seriesId: 'series-1',
      from: '2026-08-12',
    });
    expect(result).toEqual([
      { occurrenceId: 'native', native: true, applied: false, instanceId: null },
    ]);
    expect(fake.queries).toHaveLength(1);
  });
});

describe('retireGeneratedOccurrenceWork', () => {
  it('archives only selected native task and project rows of an applied run', async () => {
    const facts = {
      roots: [
        {
          key: 'root',
          kind: 'project',
          id: 'project-1',
          selectedWork: [
            { path: ['root', 'task'], kind: 'task', id: 'task-1' },
            { path: ['root', 'program'], kind: 'program', id: 'program-1' },
          ],
        },
        { key: 'root-2', kind: 'task', id: 'task-2' },
      ],
    };
    mocks.authorize.mockResolvedValue(facts);
    mocks.snapshot.mockResolvedValue({
      rowsByRef: new Map<string, unknown>([
        ['project:project-1', { kind: 'project', id: 'project-1', row: { id: 'project-1' } }],
        [
          'task:task-1',
          {
            kind: 'task',
            id: 'task-1',
            row: { id: 'task-1', completedAt: null, parentTaskId: 'parent-1' },
          },
        ],
        [
          'task:task-2',
          {
            kind: 'task',
            id: 'task-2',
            row: { id: 'task-2', completedAt: null, parentTaskId: null },
          },
        ],
        ['task:unselected', { kind: 'task', id: 'unselected', row: { id: 'unselected' } }],
        ['program:program-1', { kind: 'program', id: 'program-1', row: { id: 'program-1' } }],
      ]),
    });
    mocks.cascade.mockResolvedValue([{ taskId: 'parent-1' }]);
    const { tx, fake } = transaction([undefined, undefined]);
    const result = await retireGeneratedOccurrenceWork(tx, {
      organizationId,
      actorId: 'actor-1',
      now,
      candidates: [candidate({ occurrenceId: 'native', native: true, applied: true })],
    });
    expect(result).toEqual({
      taskIds: ['task-1', 'task-2'],
      projectIds: ['project-1'],
      completedOccurrenceIds: [],
      cascades: [{ taskId: 'parent-1' }],
    });
    expect(mocks.authorize).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ organizationId, actorId: 'actor-1', occurrenceId: 'native' }),
    );
    expect(mocks.snapshot).toHaveBeenCalledWith(tx, facts, 'edit');
    expect(fake.stepsOf('update', 'set')).toEqual([[{ archivedAt: now }], [{ archivedAt: now }]]);
    expect(mocks.cascade).toHaveBeenCalledWith(tx, organizationId, ['parent-1', null]);
  });

  it('retires nothing for unapplied native runs or unmapped retained runs', async () => {
    const { tx, fake } = transaction([]);
    const result = await retireGeneratedOccurrenceWork(tx, {
      organizationId,
      now,
      candidates: [
        candidate({ occurrenceId: 'native', native: true, applied: false }),
        candidate({ occurrenceId: 'retained' }),
      ],
    });
    expect(result).toEqual({
      taskIds: [],
      projectIds: [],
      completedOccurrenceIds: [],
      cascades: [],
    });
    expect(mocks.authorize).not.toHaveBeenCalled();
    expect(fake.queries).toHaveLength(0);
  });

  it('archives retained work and cancels its instance', async () => {
    const { tx, fake } = transaction([
      [{ id: 'task-1', completedAt: null, parentTaskId: null }],
      [],
      undefined,
      undefined,
    ]);
    const result = await retireGeneratedOccurrenceWork(tx, {
      organizationId,
      now,
      candidates: [candidate({ occurrenceId: 'retained', instanceId: 'instance-1' })],
    });
    expect(result.taskIds).toEqual(['task-1']);
    expect(result.projectIds).toEqual([]);
    expect(fake.stepsOf('update', 'set')).toEqual([
      [{ archivedAt: now }],
      [{ status: 'canceled' }],
    ]);
  });

  it('preserves runs whose generated work was already completed', async () => {
    const { tx, fake } = transaction([
      [{ id: 'task-1', completedAt: now, parentTaskId: null }],
      [{ id: 'project-1' }],
    ]);
    const result = await retireGeneratedOccurrenceWork(tx, {
      organizationId,
      now,
      candidates: [candidate({ occurrenceId: 'retained', instanceId: 'instance-1' })],
    });
    expect(result).toEqual({
      taskIds: [],
      projectIds: [],
      completedOccurrenceIds: ['retained'],
      cascades: [],
    });
    expect(fake.queries.filter((query) => query.operation === 'update')).toHaveLength(0);
  });
});
