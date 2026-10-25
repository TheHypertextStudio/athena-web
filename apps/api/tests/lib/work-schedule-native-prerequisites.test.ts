import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BlueprintError } from '@docket/work/blueprints';
import type { NativeScheduleDateOwnership } from '@docket/db';
import { NotFoundError } from '../../src/error';
import { loadNativeSchedulePrerequisites } from '../../src/lib/recurrence/schedule-native-prerequisites';
import type { NativeScheduleFacts } from '../../src/lib/recurrence/schedule-native-facts';
import type { TemplateTransaction } from '../../src/lib/templates/persistence';
import type { AuthorizedBlueprintSnapshot } from '../../src/lib/work-template-blueprints/snapshot-types';

const mocks = vi.hoisted(() => ({ snapshot: vi.fn() }));
vi.mock('../../src/lib/work-template-blueprints/snapshot', () => ({
  loadBlueprintSnapshot: mocks.snapshot,
}));

const tx = {} as TemplateTransaction;
const reference = { kind: 'project' as const, id: 'event' };

/** Document identity, accepted roots and private ownership for one occurrence. */
interface FactsSeed {
  readonly revision?: 1 | 2;
  readonly ownership?: readonly NativeScheduleDateOwnership[] | null;
  readonly roots?: readonly unknown[];
}

function facts(seed: FactsSeed = {}): NativeScheduleFacts {
  return {
    authority: { proof: {} },
    document: { kind: 'forest', revision: seed.revision ?? 1 },
    roots: seed.roots ?? [
      {
        key: 'event',
        kind: 'project',
        id: 'event',
        selectedWork: [
          { path: ['venue'], kind: 'task', id: 'venue' },
          { path: ['menu'], kind: 'task', id: 'menu' },
        ],
      },
      { key: 'party', kind: 'project', id: 'party' },
    ],
    occurrence: { scheduleDateOwnership: seed.ownership === undefined ? [] : seed.ownership },
  } as unknown as NativeScheduleFacts;
}

function owned(
  id: string,
  anchor: NativeScheduleDateOwnership['anchor'],
  extra: Partial<NativeScheduleDateOwnership> = {},
): NativeScheduleDateOwnership {
  return {
    rootKey: 'event',
    path: [],
    kind: 'task',
    id,
    field: 'dueDate',
    anchor,
    manual: false,
    lastDerivedDate: null,
    ...extra,
  };
}

function snapshotOf(...ids: string[]): AuthorizedBlueprintSnapshot {
  return { nodes: ids.map((id) => ({ id })) } as unknown as AuthorizedBlueprintSnapshot;
}

function workDate(id: string): NativeScheduleDateOwnership['anchor'] {
  return {
    kind: 'field',
    source: { kind: 'work_date', work: { kind: 'task', id }, field: 'dueDate' },
    offset: { days: 0, unit: 'calendar' },
  };
}

beforeEach(() => {
  mocks.snapshot.mockReset();
  mocks.snapshot.mockImplementation(async (_tx, _authority, source: { id: string }) =>
    snapshotOf(source.id),
  );
});

describe('native schedule planned-date prerequisites', () => {
  it('reads nothing when the occurrence has no private date ownership', async () => {
    const snapshots = new Map<string, AuthorizedBlueprintSnapshot>();
    await loadNativeSchedulePrerequisites(tx, {
      facts: facts({ ownership: null }),
      reference,
      explicitDates: [],
      affected: new Set(['event']),
      snapshots,
    });
    expect(snapshots.size).toBe(0);
    expect(mocks.snapshot).not.toHaveBeenCalled();
  });

  it('loads only unread work and work-date sources of affected managed fields', async () => {
    const snapshots = new Map([['root', snapshotOf('event', 'menu')]]);
    await loadNativeSchedulePrerequisites(tx, {
      facts: facts({
        ownership: [
          owned('a', { kind: 'work', id: 'party', offsetDays: 1 }),
          owned('b', workDate('venue')),
          owned('c', { kind: 'work', id: 'menu', offsetDays: 0 }),
          owned('d', { kind: 'run' }),
          owned('e', { kind: 'absent' }),
          owned('f', { kind: 'work', id: 'venue', offsetDays: 0 }, { manual: true }),
          owned('outside', { kind: 'work', id: 'venue', offsetDays: 0 }),
          owned('event', { kind: 'work', id: 'venue', offsetDays: 0 }),
        ],
      }),
      reference,
      explicitDates: ['dueDate'],
      affected: new Set(['a', 'b', 'c', 'd', 'e', 'f', 'event']),
      snapshots,
    });
    expect([...snapshots.keys()].sort()).toEqual([
      'prerequisite:party',
      'prerequisite:venue',
      'root',
    ]);
    expect(mocks.snapshot).toHaveBeenCalledTimes(2);
    expect(mocks.snapshot).toHaveBeenCalledWith(
      tx,
      expect.anything(),
      expect.objectContaining({ id: 'party' }),
      { scope: 'reference', forUpdate: true, access: 'view' },
    );
  });

  it('refuses a private source that the occurrence never accepted', async () => {
    const run = loadNativeSchedulePrerequisites(tx, {
      facts: facts({ ownership: [owned('a', { kind: 'work', id: 'stranger', offsetDays: 0 })] }),
      reference,
      explicitDates: [],
      affected: new Set(['a']),
      snapshots: new Map(),
    });
    await expect(run).rejects.toBeInstanceOf(BlueprintError);
    await expect(run).rejects.toMatchObject({ code: 'blueprint_invalid' });
  });

  it('skips a deleted prerequisite only for revision 2 forests', async () => {
    mocks.snapshot.mockRejectedValue(new NotFoundError());
    const ownership = [owned('a', { kind: 'work', id: 'venue', offsetDays: 0 })];
    const snapshots = new Map<string, AuthorizedBlueprintSnapshot>();
    await loadNativeSchedulePrerequisites(tx, {
      facts: facts({ revision: 2, ownership }),
      reference,
      explicitDates: [],
      affected: new Set(['a']),
      snapshots,
    });
    expect(snapshots.size).toBe(0);
    await expect(
      loadNativeSchedulePrerequisites(tx, {
        facts: facts({ revision: 1, ownership }),
        reference,
        explicitDates: [],
        affected: new Set(['a']),
        snapshots,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('propagates a capability failure from a revision 2 prerequisite', async () => {
    mocks.snapshot.mockRejectedValue(new Error('denied'));
    await expect(
      loadNativeSchedulePrerequisites(tx, {
        facts: facts({
          revision: 2,
          ownership: [owned('a', { kind: 'work', id: 'venue', offsetDays: 0 })],
        }),
        reference,
        explicitDates: [],
        affected: new Set(['a']),
        snapshots: new Map(),
      }),
    ).rejects.toThrow('denied');
  });
});
