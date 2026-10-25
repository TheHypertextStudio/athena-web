import { describe, expect, it } from 'vitest';
import { BlueprintError, type ExistingBlueprintNode } from '@docket/work/blueprints';
import type { NativeScheduleDateOwnership } from '@docket/db';
import { assertNativeScheduleFieldGraph } from '../../src/lib/recurrence/schedule-native-field-graph';
import { NO_OFFSET, dateBinding, existingNode } from './existing-blueprint-node-fixture';

const parentAnchor = { kind: 'anchor', anchor: { kind: 'parent' }, offset: NO_OFFSET };

/** The planner refusal code for a graph, or null when the graph is accepted. */
function refusal(
  nodes: readonly ExistingBlueprintNode[],
  ownership: readonly NativeScheduleDateOwnership[],
): string | null {
  try {
    assertNativeScheduleFieldGraph(nodes, ownership);
    return null;
  } catch (error) {
    if (error instanceof BlueprintError) return error.code;
    throw error;
  }
}
function milestoneAnchor(stepKey: string) {
  return { kind: 'anchor', anchor: { kind: 'milestone', stepKey }, offset: NO_OFFSET };
}

function workDateOwnership(
  id: string,
  field: NativeScheduleDateOwnership['field'],
  source: { readonly id: string; readonly field: NativeScheduleDateOwnership['field'] },
): NativeScheduleDateOwnership {
  return {
    rootKey: 'root',
    path: [],
    kind: 'task',
    id,
    field,
    anchor: {
      kind: 'field',
      source: { kind: 'work_date', work: { kind: 'task', id: source.id }, field: source.field },
      offset: NO_OFFSET,
    },
    manual: false,
    lastDerivedDate: null,
  };
}

describe('native schedule field graph', () => {
  it('accepts parent, Task, referenced and path-matched milestone derivations', () => {
    const nodes = [
      existingNode({ id: 'event', kind: 'project', path: [] }),
      existingNode({ id: 'kickoff', kind: 'milestone', path: ['kickoff'], parentId: 'event' }),
      existingNode({
        id: 'plan',
        kind: 'task',
        path: ['plan'],
        parentId: 'event',
        dateBindings: { dueDate: dateBinding(parentAnchor) },
      }),
      existingNode({
        id: 'draft',
        kind: 'task',
        path: ['plan', 'draft'],
        parentId: 'plan',
        dateBindings: {
          dueDate: dateBinding(parentAnchor),
          startDate: dateBinding({ kind: 'none' }),
        },
      }),
      existingNode({
        id: 'invite',
        kind: 'task',
        path: ['invite'],
        parentId: 'event',
        dateBindings: { dueDate: dateBinding(milestoneAnchor('kickoff')) },
      }),
      existingNode({
        id: 'remind',
        kind: 'task',
        path: ['remind'],
        parentId: 'event',
        dateBindings: { dueDate: dateBinding(milestoneAnchor('renamed')) },
        dateReferences: {
          dueDate: { parentId: null, milestoneIds: { renamed: 'kickoff' }, completionIds: {} },
        },
      }),
    ];
    expect(refusal(nodes, [])).toBeNull();
  });

  it('ignores pinned fields and Program or Initiative anchors', () => {
    const nodes = [
      existingNode({ id: 'program', kind: 'program', path: [] }),
      existingNode({
        id: 'pinned',
        kind: 'task',
        path: ['pinned'],
        parentId: 'program',
        dateBindings: { dueDate: dateBinding(parentAnchor, true) },
      }),
      existingNode({
        id: 'loose',
        kind: 'task',
        path: ['loose'],
        parentId: 'program',
        dateBindings: { dueDate: dateBinding(parentAnchor) },
      }),
    ];
    expect(refusal(nodes, [])).toBeNull();
  });

  it('refuses private and public date fields that derive from each other', () => {
    const nodes = [
      existingNode({ id: 'venue', kind: 'task', path: [] }),
      existingNode({
        id: 'deposit',
        kind: 'task',
        path: ['deposit'],
        parentId: 'venue',
        dateBindings: { dueDate: dateBinding(parentAnchor) },
      }),
    ];
    const ownership = [workDateOwnership('venue', 'dueDate', { id: 'deposit', field: 'dueDate' })];
    expect(refusal(nodes, ownership)).toBe('blueprint_loop');
  });

  it('refuses mutually derived private fields and accepts a one-way private chain', () => {
    const nodes = [
      existingNode({ id: 'venue', kind: 'task', path: [] }),
      existingNode({
        id: 'deposit',
        kind: 'task',
        path: ['deposit'],
        parentId: 'venue',
        dateBindings: { dueDate: dateBinding(parentAnchor) },
      }),
    ];
    const ownership: NativeScheduleDateOwnership[] = [
      workDateOwnership('venue', 'startDate', { id: 'deposit', field: 'dueDate' }),
      workDateOwnership('deposit', 'dueDate', { id: 'venue', field: 'startDate' }),
      {
        ...workDateOwnership('venue', 'targetDate', { id: 'x', field: 'dueDate' }),
        anchor: { kind: 'run' },
      },
    ];
    expect(refusal(nodes, ownership)).toBe('blueprint_loop');
    expect(refusal(nodes, ownership.slice(1))).toBeNull();
  });
});
