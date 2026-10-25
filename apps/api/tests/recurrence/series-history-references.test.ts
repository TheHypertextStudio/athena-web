/** Reference facts for compatibility history across legacy, native, and archived occurrences. */
import type * as DbModule from '@docket/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  occurrenceReferenceFacts,
  type OccurrenceReferenceRecord,
} from '../../src/lib/recurrence/series-history-references';
import { queryFake } from './recurrence-query-fake';

const mocks = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('@docket/db', async (importOriginal) => ({
  ...(await importOriginal<typeof DbModule>()),
  readScheduleHistoricalReferences: mocks.read,
}));

const organizationId = 'org-1';

function occurrence(overrides: Partial<OccurrenceReferenceRecord>): OccurrenceReferenceRecord {
  return {
    id: 'occurrence-1',
    native: false,
    historical: false,
    legacyInstanceId: null,
    blueprintAppliedAt: null,
    blueprintRootRefs: null,
    ...overrides,
  };
}

beforeEach(() => {
  mocks.read.mockReset();
});

describe('occurrenceReferenceFacts', () => {
  it('issues no queries when there are no occurrences', async () => {
    const fake = queryFake([]);
    const result = await occurrenceReferenceFacts(fake.database, organizationId, []);
    expect(result.instances.size).toBe(0);
    expect(result.references).toEqual([]);
    expect(fake.queries).toHaveLength(0);
  });

  it('resolves legacy instances and their retained task and project maps', async () => {
    const fake = queryFake([
      [
        { occurrenceId: 'legacy-1', id: 'instance-1' },
        { occurrenceId: null, id: 'instance-orphan' },
      ],
      [{ instanceId: 'instance-1', id: 'task-1' }],
      [{ instanceId: 'instance-orphan', id: 'project-1' }],
    ]);
    const result = await occurrenceReferenceFacts(fake.database, organizationId, [
      occurrence({ id: 'legacy-1' }),
    ]);
    expect([...result.instances]).toEqual([['legacy-1', 'instance-1']]);
    expect(result.references).toEqual([
      { instanceId: 'instance-1', id: 'task-1', kind: 'task' },
      { instanceId: 'instance-orphan', id: 'project-1', kind: 'project' },
    ]);
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it('skips the retained-map lookup when legacy occurrences have no instance', async () => {
    const fake = queryFake([[]]);
    const result = await occurrenceReferenceFacts(fake.database, organizationId, [
      occurrence({ id: 'legacy-1' }),
    ]);
    expect(result.instances.size).toBe(0);
    expect(result.references).toEqual([]);
    expect(fake.queries).toHaveLength(1);
  });

  it('reads native selected work and root work without consulting legacy tables', async () => {
    const appliedAt = new Date('2026-08-10T00:00:00.000Z');
    const fake = queryFake([]);
    const result = await occurrenceReferenceFacts(fake.database, organizationId, [
      occurrence({
        id: 'native-applied',
        native: true,
        blueprintAppliedAt: appliedAt,
        blueprintRootRefs: [
          { key: 'root-a', kind: 'project', id: 'project-root' },
          {
            key: 'root-b',
            kind: 'task',
            id: 'task-root',
            selectedWork: [
              { path: ['root-b'], kind: 'task', id: 'task-selected' },
              { path: ['root-b', 'program'], kind: 'program', id: 'program-selected' },
              { path: ['root-b', 'project'], kind: 'project', id: 'project-selected' },
            ],
          },
        ],
      }),
      occurrence({ id: 'native-legacy', native: true, legacyInstanceId: 'instance-legacy' }),
      occurrence({ id: 'native-unapplied', native: true }),
    ]);
    expect([...result.instances]).toEqual([
      ['native-applied', 'native-applied'],
      ['native-legacy', 'instance-legacy'],
    ]);
    expect(result.references).toEqual([
      { instanceId: 'native-applied', kind: 'project', id: 'project-root' },
      { instanceId: 'native-applied', kind: 'task', id: 'task-selected' },
      { instanceId: 'native-applied', kind: 'project', id: 'project-selected' },
    ]);
    expect(fake.queries).toHaveLength(0);
  });

  it('pages through archived history and keeps only navigable task or project links', async () => {
    mocks.read
      .mockResolvedValueOnce({
        references: [
          { kind: 'task', mapping: { task_id: 'task-mapped' } },
          { mapping: { project_id: 'project-mapped' }, selection: { kind: 'project' } },
          { selection: { kind: 'task', id: 'task-selected' } },
          { kind: 'project', workId: 'project-work' },
          { kind: 'program', workId: 'program-work' },
          { kind: 'task', mapping: 'not-an-object', selection: null },
          { kind: 'task', workId: 42 },
        ],
        nextOffset: 7,
      })
      .mockResolvedValueOnce({
        references: [{ kind: 'task', workId: 'task-last-page' }],
        nextOffset: null,
      });
    const fake = queryFake([]);
    const result = await occurrenceReferenceFacts(fake.database, organizationId, [
      occurrence({ id: 'archived', historical: true, legacyInstanceId: 'instance-archived' }),
    ]);
    expect(result.instances.get('archived')).toBe('instance-archived');
    expect(result.references).toEqual([
      { instanceId: 'instance-archived', kind: 'task', id: 'task-mapped' },
      { instanceId: 'instance-archived', kind: 'project', id: 'project-mapped' },
      { instanceId: 'instance-archived', kind: 'task', id: 'task-selected' },
      { instanceId: 'instance-archived', kind: 'project', id: 'project-work' },
      { instanceId: 'instance-archived', kind: 'task', id: 'task-last-page' },
    ]);
    expect(mocks.read.mock.calls.map(([, input]) => input)).toEqual([
      { organizationId, occurrenceId: 'archived', offset: 0 },
      { organizationId, occurrenceId: 'archived', offset: 7 },
    ]);
  });

  it('ignores archived history that has no instance identity', async () => {
    const fake = queryFake([]);
    const result = await occurrenceReferenceFacts(fake.database, organizationId, [
      occurrence({ id: 'archived', historical: true }),
    ]);
    expect(result.instances.size).toBe(0);
    expect(mocks.read).not.toHaveBeenCalled();
  });
});
