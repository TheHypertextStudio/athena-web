import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  RELATION_DEFINITIONS,
  resolveDefaultRelation,
  type RelationCommandPort,
  type RelationIntent,
} from '../src/relation-contract';

const task = {
  kind: 'task',
  id: 'task_1',
  organizationId: 'org_1',
  meta: { projectId: 'project_1' },
} as const;

describe('relation contract', () => {
  it('declares one default for every drag-enabled source and target pair', () => {
    const defaults = new Set<string>();

    for (const definition of RELATION_DEFINITIONS.filter((item) => item.isDefault)) {
      const key = `${definition.sourceKind}:${definition.targetKind}`;
      expect(defaults.has(key), `${key} has more than one default`).toBe(false);
      defaults.add(key);
    }

    expect(defaults).toContain('task:task');
    expect(defaults).toContain('task:project');
    expect(defaults).toContain('project:initiative');
    expect(defaults).toContain('initiative:initiative');
    expect(defaults).toContain('calendar_item:calendar_item');
  });

  it('defines every relation id once with a valid effect and cardinality', () => {
    const ids = RELATION_DEFINITIONS.map(({ id }) => id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(28);
    for (const definition of RELATION_DEFINITIONS) {
      expect(['move', 'link', 'copy']).toContain(definition.effect);
      expect(['one', 'many']).toContain(definition.cardinality);
    }
  });

  it('resolves the fixed default for a compatible pair', () => {
    expect(
      resolveDefaultRelation({
        subjects: [task],
        target: { kind: 'project', id: 'project_2', organizationId: 'org_1' },
      }),
    ).toEqual({
      accepted: true,
      intent: {
        relationId: 'task.project',
        subjects: [task],
        target: { kind: 'project', id: 'project_2', organizationId: 'org_1' },
        effect: 'move',
      },
    });
  });

  it('rejects cross-workspace and self relationships before dispatch', () => {
    expect(
      resolveDefaultRelation({
        subjects: [task],
        target: { kind: 'project', id: 'project_2', organizationId: 'org_2' },
      }),
    ).toEqual({ accepted: false, reason: 'cross_organization' });

    expect(resolveDefaultRelation({ subjects: [task], target: task })).toEqual({
      accepted: false,
      reason: 'self_relation',
    });
  });

  it('rejects a milestone outside the task project when both endpoints carry ownership', () => {
    expect(
      resolveDefaultRelation({
        subjects: [task],
        target: {
          kind: 'milestone',
          id: 'milestone_1',
          organizationId: 'org_1',
          meta: { projectId: 'project_2' },
        },
      }),
    ).toEqual({ accepted: false, reason: 'incompatible_parent' });
  });

  it.each([
    [
      { kind: 'project', id: 'project_2', organizationId: 'org_1', meta: { archived: true } },
      'archived_target',
    ],
    [
      { kind: 'project', id: 'project_2', organizationId: 'org_1', meta: { canRelate: false } },
      'permission_denied',
    ],
  ] as const)('rejects unavailable targets with the stable %s reason', (target, reason) => {
    expect(resolveDefaultRelation({ subjects: [task], target })).toEqual({
      accepted: false,
      reason,
    });
  });

  it('rejects hierarchy cycles reported by current hierarchy data', () => {
    expect(
      resolveDefaultRelation({
        subjects: [task],
        target: {
          kind: 'task',
          id: 'task_2',
          organizationId: 'org_1',
          meta: { wouldCreateCycle: true },
        },
      }),
    ).toEqual({ accepted: false, reason: 'hierarchy_cycle' });
  });

  it('keeps execution behind an injected command port', () => {
    expectTypeOf<RelationCommandPort['execute']>().parameter(0).toEqualTypeOf<RelationIntent>();
    expectTypeOf<RelationCommandPort['execute']>().returns.toEqualTypeOf<
      Promise<{ readonly status: 'applied' | 'unchanged' }>
    >();
  });
});
