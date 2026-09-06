import { describe, expect, it } from 'vitest';

import type { PlanDocument, PlanNode } from '@docket/work/plan-draft-contract';

import {
  changedFieldCount,
  EMPTY_PLAN_DIFF,
  planDiff,
} from '../../src/components/plan-canvas/plan-diff';

function node(ref: string, overrides: Partial<PlanNode> = {}): PlanNode {
  return {
    ref,
    kind: 'project',
    parentRef: 'init',
    initiativeRefs: [],
    initiativeIds: [],
    fields: { title: ref },
    templateId: null,
    status: 'draft',
    objectId: null,
    ...overrides,
  };
}

function doc(nodes: PlanNode[]): PlanDocument {
  return { nodes, edges: [] };
}

describe('planDiff', () => {
  it('is empty on first render', () => {
    expect(planDiff(null, doc([node('p1')]))).toBe(EMPTY_PLAN_DIFF);
  });

  it('reports added and removed refs', () => {
    const diff = planDiff(doc([node('p1'), node('p2')]), doc([node('p2'), node('p3')]));
    expect([...diff.added]).toEqual(['p3']);
    expect(diff.removed).toEqual(['p1']);
    expect(diff.changed.size).toBe(0);
  });

  it('names the fields that changed, including structure and status', () => {
    const before = doc([node('p1', { fields: { title: 'A', summary: 'one' } })]);
    const after = doc([
      node('p1', {
        fields: { title: 'A', summary: 'two', targetDate: '2026-05-01' },
        parentRef: 'init2',
        status: 'confirmed',
        objectId: 'prj_1',
      }),
    ]);
    const diff = planDiff(before, after);
    expect([...(diff.changed.get('p1') ?? [])].sort()).toEqual(
      ['parentRef', 'status', 'summary', 'targetDate'].sort(),
    );
    expect(changedFieldCount(diff)).toBe(4);
  });

  it('treats a field set back to its previous value as unchanged', () => {
    const a = doc([node('p1', { fields: { title: 'A', summary: 'x' } })]);
    const b = doc([node('p1', { fields: { title: 'A', summary: 'x' } })]);
    expect(planDiff(a, b).changed.size).toBe(0);
  });

  it('detects a changed initiative membership', () => {
    const a = doc([node('p1')]);
    const b = doc([node('p1', { initiativeRefs: ['init2'] })]);
    expect(planDiff(a, b).changed.get('p1')).toEqual(['initiativeRefs']);
  });
});
