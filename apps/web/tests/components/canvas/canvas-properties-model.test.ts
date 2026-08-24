/** `@docket/web` — pure bulk canvas property model contract. */
import { describe, expect, it } from 'vitest';

import type { CanvasPropertySnapshot } from '@/lib/actions';
import {
  aggregateAssociation,
  aggregateScalar,
  buildAssociationCommand,
  buildScalarCommand,
  commonNonNullValue,
  compatibleLabels,
  guardCanvasPropertySelection,
  intersectTaskStatusKeys,
} from '@/components/canvas/canvas-properties-model';

const task = (
  id: string,
  overrides: Partial<Extract<CanvasPropertySnapshot, { kind: 'task' }>> = {},
): Extract<CanvasPropertySnapshot, { kind: 'task' }> => ({
  kind: 'task',
  id,
  organizationId: 'org-1',
  state: 'todo',
  priority: 'medium',
  assigneeId: null,
  projectId: 'project-1',
  programId: null,
  milestoneId: null,
  cycleId: null,
  labelIds: [],
  teamId: 'team-1',
  startDate: null,
  dueDate: null,
  estimate: null,
  ...overrides,
});

describe('canvas bulk property model', () => {
  it('aggregates equal and mixed scalar values without conflating null with mixed', () => {
    expect(aggregateScalar([task('a'), task('b')], (item) => item.assigneeId)).toEqual({
      state: 'same',
      value: null,
    });
    expect(
      aggregateScalar([task('a'), task('b', { priority: 'urgent' })], (item) => item.priority),
    ).toEqual({ state: 'mixed' });
    expect(
      aggregateScalar(
        [{ date: { day: '2026-08-01' } }, { date: { day: '2026-08-01' } }],
        (item) => item.date,
        (left, right) => left.day === right.day,
      ),
    ).toEqual({ state: 'same', value: { day: '2026-08-01' } });
  });

  it('aggregates every association as all, some, or none', () => {
    const snapshots = [task('a', { labelIds: ['label-1'] }), task('b')];
    expect(aggregateAssociation(snapshots, 'label-1', (item) => item.labelIds)).toBe('some');
    expect(aggregateAssociation(snapshots, 'label-2', (item) => item.labelIds)).toBe('none');
    expect(
      aggregateAssociation(
        [task('a', { labelIds: ['label-1'] }), task('b', { labelIds: ['label-1'] })],
        'label-1',
        (item) => item.labelIds,
      ),
    ).toBe('all');
  });

  it('builds one scalar command over every selected object', () => {
    expect(buildScalarCommand([task('a'), task('b')], 'priority', 'high', 'command-1')).toEqual({
      commandId: 'command-1',
      objectKind: 'task',
      objectIds: ['a', 'b'],
      operation: { type: 'replace_property', property: 'priority', value: 'high' },
    });
  });

  it('adds a partial or absent association to all and removes a universal association from all', () => {
    const some = [task('a', { labelIds: ['label-1'] }), task('b')];
    expect(buildAssociationCommand(some, 'label', 'label-1', 'command-2').operation).toEqual({
      type: 'add_association',
      association: 'label',
      associationIds: ['label-1'],
    });
    const all = [task('a', { labelIds: ['label-1'] }), task('b', { labelIds: ['label-1'] })];
    expect(buildAssociationCommand(all, 'label', 'label-1', 'command-3').operation).toEqual({
      type: 'remove_association',
      association: 'label',
      associationIds: ['label-1'],
    });
  });

  it('rejects empty, mixed-kind, duplicate, cross-workspace, and over-500 selections', () => {
    expect(guardCanvasPropertySelection([])).toMatchObject({ ok: false });
    expect(
      guardCanvasPropertySelection([
        task('a'),
        {
          kind: 'project',
          id: 'p',
          organizationId: 'org-1',
          status: 'planned',
          health: null,
          priority: 'none',
          leadId: null,
          teamId: null,
          programId: null,
          labelIds: [],
          initiativeIds: [],
          startTimeframe: null,
          targetTimeframe: null,
        },
      ]),
    ).toMatchObject({ ok: false });
    expect(guardCanvasPropertySelection([task('a'), task('a')])).toMatchObject({ ok: false });
    expect(
      guardCanvasPropertySelection([task('a'), task('b', { organizationId: 'org-2' })]),
    ).toMatchObject({ ok: false });
    expect(
      guardCanvasPropertySelection(Array.from({ length: 501 }, (_, i) => task(String(i)))),
    ).toEqual({
      ok: false,
      reason: 'Properties supports at most 500 selected objects.',
    });
  });

  it('intersects task statuses and resolves common non-null references', () => {
    const snapshots = [task('a', { teamId: 'team-a' }), task('b', { teamId: 'team-b' })];
    expect(
      intersectTaskStatusKeys(snapshots, (teamId) =>
        teamId === 'team-a' ? ['backlog', 'started', 'done'] : ['backlog', 'done'],
      ),
    ).toEqual(['backlog', 'done']);
    expect(commonNonNullValue(snapshots, (item) => item.projectId)).toBe('project-1');
    expect(commonNonNullValue(snapshots, (item) => item.teamId)).toBeNull();
  });

  it('offers global labels and only team labels valid for every selected team', () => {
    const snapshots = [task('a', { teamId: 'team-a' }), task('b', { teamId: 'team-b' })];
    const labels = [
      { id: 'global', teamId: null },
      { id: 'a', teamId: 'team-a' },
      { id: 'b', teamId: 'team-b' },
    ];
    expect(compatibleLabels(snapshots, labels).map(({ id }) => id)).toEqual(['global']);
  });
});
