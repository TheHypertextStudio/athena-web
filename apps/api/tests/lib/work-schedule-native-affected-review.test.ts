import { describe, expect, it, vi } from 'vitest';
import { loadNativeScheduleAffectedSnapshot } from '../../src/lib/recurrence/schedule-native-affected';
import type { NativeScheduleFacts } from '../../src/lib/recurrence/schedule-native-facts';
import type { TemplateTransaction } from '../../src/lib/templates/persistence';
const mocks = vi.hoisted(() => ({ snapshot: vi.fn() }));
vi.mock('../../src/lib/work-template-blueprints/snapshot', () => ({
  loadBlueprintSnapshot: mocks.snapshot,
}));
vi.mock('../../src/lib/recurrence/schedule-native-facts', () => ({
  requireNativeScheduleFacts: vi.fn(),
}));
function fixture(category: string, date: string) {
  const builder = {
    from: vi.fn(),
    leftJoin: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(async () => [
      { date: new Date(date), category, completedAt: null, canceledAt: null },
    ]),
  };
  builder.from.mockReturnValue(builder);
  builder.leftJoin.mockReturnValue(builder);
  builder.where.mockReturnValue(builder);
  const tx = { select: vi.fn(() => builder) } as unknown as TemplateTransaction;
  const facts = {
    organizationId: 'org',
    authority: {},
    // This focused query fixture exercises the unchanged native v1 ownership branch.
    document: { kind: 'forest', revision: 1 },
    timezone: 'UTC',
    roots: [
      {
        key: 'one',
        kind: 'project',
        id: 'one',
        selectedWork: [{ kind: 'task', id: 'venue', path: ['venue'] }],
      },
      { key: 'two', kind: 'project', id: 'two', selectedWork: [] },
    ],
    occurrence: {
      scheduleDateOwnership: [
        {
          id: 'venue',
          kind: 'task',
          field: 'dueDate',
          anchor: { kind: 'work', id: 'two', offsetDays: -2 },
          manual: false,
          lastDerivedDate: '2026-10-06',
        },
      ],
    },
  } as unknown as NativeScheduleFacts;
  mocks.snapshot.mockImplementation(async (_tx, _authority, root, options) => {
    if (root.id === 'one' && options.access === 'edit')
      throw new Error('Unnecessary consumer edit');
    return {
      nodes: [
        { id: root.id, kind: root.kind, parentId: null, dateBindings: {}, state: 'unstarted' },
      ],
      rowsByRef: new Map(),
      context: { completions: [] },
    };
  });
  return { tx, facts };
}
describe('native private no-op write selection', () => {
  it.each(['completed', 'canceled'])(
    'keeps a %s private consumer outside the edit closure',
    async (category) => {
      const f = fixture(category, '2026-10-06');
      const result = await loadNativeScheduleAffectedSnapshot(
        f.tx,
        f.facts,
        { kind: 'project', id: 'two' },
        ['targetDate'],
      );
      expect([...result.affectedWorkIds]).toEqual(['two']);
    },
  );
  it('preserves a diverged private date as a manual fact without requiring a public work write', async () => {
    const f = fixture('not_started', '2026-10-03');
    const result = await loadNativeScheduleAffectedSnapshot(
      f.tx,
      f.facts,
      { kind: 'project', id: 'two' },
      ['targetDate'],
    );
    expect([...result.affectedWorkIds]).toEqual(['two']);
    expect(result.manualDivergences).toEqual(new Set(['venue:dueDate']));
  });
});
