import { describe, expect, it } from 'vitest';
import type { BlueprintDateField } from '@docket/work/blueprints';
import { affectedBlueprintDateFields } from '../../src/lib/work-template-blueprints/reflow-selection-fields';
import { NO_OFFSET, dateBinding, existingNode } from './existing-blueprint-node-fixture';

const parentAnchor = { kind: 'anchor', anchor: { kind: 'parent' }, offset: NO_OFFSET };
function milestoneAnchor(stepKey: string) {
  return { kind: 'anchor', anchor: { kind: 'milestone', stepKey }, offset: NO_OFFSET };
}
function afterCompletion(...stepKeys: string[]) {
  return { kind: 'after_completion', stepKeys, offset: NO_OFFSET };
}
function dateChanges(
  entries: readonly (readonly [string, readonly BlueprintDateField[]])[],
): ReadonlyMap<string, ReadonlySet<BlueprintDateField>> {
  return new Map(entries.map(([id, fields]) => [id, new Set(fields)]));
}
function affected(result: ReadonlyMap<string, ReadonlySet<BlueprintDateField>>) {
  return Object.fromEntries([...result].map(([id, fields]) => [id, [...fields].sort()]));
}

const project = existingNode({ id: 'event', kind: 'project', path: [] });
const kickoff = existingNode({
  id: 'kickoff',
  kind: 'milestone',
  path: ['kickoff'],
  parentId: 'event',
});

describe('affected blueprint date fields', () => {
  it('follows a milestone target date by reference and by sibling path', () => {
    const byReference = existingNode({
      id: 'invite',
      kind: 'task',
      path: ['invite'],
      parentId: 'event',
      dateBindings: { dueDate: dateBinding(milestoneAnchor('launch')) },
      dateReferences: {
        dueDate: { parentId: null, milestoneIds: { launch: 'kickoff' }, completionIds: {} },
      },
    });
    const byPath = existingNode({
      id: 'remind',
      kind: 'task',
      path: ['remind'],
      parentId: 'event',
      dateBindings: { startDate: dateBinding(milestoneAnchor('kickoff')) },
    });
    const missing = existingNode({
      id: 'orphan',
      kind: 'task',
      path: ['orphan'],
      parentId: 'event',
      dateBindings: { dueDate: dateBinding(milestoneAnchor('absent')) },
    });
    const result = affectedBlueprintDateFields(
      [project, kickoff, byReference, byPath, missing],
      new Set(),
      { dates: dateChanges([['kickoff', ['targetDate']]]), completions: new Set() },
    );
    expect(affected(result)).toEqual({
      kickoff: ['targetDate'],
      invite: ['dueDate'],
      remind: ['startDate'],
    });
  });

  it('ignores a milestone change that leaves its target date alone', () => {
    const dependent = existingNode({
      id: 'invite',
      kind: 'task',
      path: ['invite'],
      parentId: 'event',
      dateBindings: { dueDate: dateBinding(milestoneAnchor('kickoff')) },
    });
    const result = affectedBlueprintDateFields([project, kickoff, dependent], new Set(), {
      dates: dateChanges([['kickoff', ['startDate']]]),
      completions: new Set(),
    });
    expect(affected(result)).toEqual({ kickoff: ['startDate'] });
  });

  it('propagates a parent Task due date through descendants with fallback parents', () => {
    const parentTask = existingNode({
      id: 'plan',
      kind: 'task',
      path: ['plan'],
      parentId: 'event',
    });
    const child = existingNode({
      id: 'draft',
      kind: 'task',
      path: ['plan', 'draft'],
      parentId: 'plan',
      dateBindings: { dueDate: dateBinding(parentAnchor) },
    });
    const grandchild = existingNode({
      id: 'review',
      kind: 'task',
      path: ['plan', 'draft', 'review'],
      parentId: 'draft',
      dateBindings: { dueDate: dateBinding(parentAnchor) },
    });
    const result = affectedBlueprintDateFields(
      [project, parentTask, child, grandchild],
      new Set(),
      {
        dates: dateChanges([
          ['plan', ['dueDate']],
          ['deleted', ['dueDate']],
        ]),
        completions: new Set(),
      },
    );
    expect(affected(result)).toEqual({
      plan: ['dueDate'],
      draft: ['dueDate'],
      review: ['dueDate'],
    });
  });

  it('starts completion-gated work from a sibling path or explicit reference', () => {
    const deposit = existingNode({ id: 'deposit', kind: 'task', path: ['deposit'] });
    const byPath = existingNode({
      id: 'confirm',
      kind: 'task',
      path: ['confirm'],
      dateBindings: { startDate: dateBinding(afterCompletion('deposit')) },
    });
    const byReference = existingNode({
      id: 'thank',
      kind: 'task',
      path: ['thank'],
      dateBindings: { startDate: dateBinding(afterCompletion('paid')) },
      dateReferences: {
        startDate: { parentId: null, milestoneIds: {}, completionIds: { paid: 'deposit' } },
      },
    });
    const unrelated = existingNode({
      id: 'later',
      kind: 'task',
      path: ['later'],
      dateBindings: { startDate: dateBinding(afterCompletion('nothing')) },
    });
    const result = affectedBlueprintDateFields(
      [deposit, byPath, byReference, unrelated],
      new Set(),
      {
        dates: new Map(),
        completions: new Set(['deposit']),
      },
    );
    expect(affected(result)).toEqual({ confirm: ['startDate'], thank: ['startDate'] });
  });

  it('never selects pinned, unmanaged, seeded or terminal fields', () => {
    const parentTask = existingNode({ id: 'plan', kind: 'task', path: ['plan'] });
    const children = [
      existingNode({
        id: 'pinned',
        kind: 'task',
        path: ['plan', 'pinned'],
        parentId: 'plan',
        dateBindings: { dueDate: dateBinding(parentAnchor, true) },
      }),
      existingNode({
        id: 'unmanaged',
        kind: 'task',
        path: ['plan', 'unmanaged'],
        parentId: 'plan',
        dateBindings: { dueDate: dateBinding({ kind: 'none' }) },
      }),
      existingNode({
        id: 'seed',
        kind: 'task',
        path: ['plan', 'seed'],
        parentId: 'plan',
        dateBindings: { dueDate: dateBinding(parentAnchor) },
      }),
      existingNode({
        id: 'done',
        kind: 'task',
        path: ['plan', 'done'],
        parentId: 'plan',
        state: 'completed',
        dateBindings: { dueDate: dateBinding(parentAnchor) },
      }),
    ];
    const result = affectedBlueprintDateFields([parentTask, ...children], new Set(['seed']), {
      dates: dateChanges([['plan', ['dueDate']]]),
      completions: new Set(),
    });
    expect(affected(result)).toEqual({ plan: ['dueDate'] });
  });
});
