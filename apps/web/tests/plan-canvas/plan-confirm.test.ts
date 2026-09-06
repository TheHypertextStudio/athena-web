import { describe, expect, it } from 'vitest';

import type { PlanDocument, PlanNode } from '@docket/work/plan-draft-contract';

import { describeConfirmation, subtreeRefs } from '../../src/components/plan-canvas/plan-confirm';

function node(ref: string, overrides: Partial<PlanNode>): PlanNode {
  return {
    ref,
    kind: 'task',
    parentRef: null,
    initiativeRefs: [],
    initiativeIds: [],
    fields: { title: ref },
    templateId: null,
    status: 'draft',
    objectId: null,
    ...overrides,
  };
}

const DOC: PlanDocument = {
  nodes: [
    node('init', { kind: 'initiative' }),
    node('p1', { kind: 'project', parentRef: 'init' }),
    node('p2', { kind: 'project', parentRef: 'init', status: 'confirmed', objectId: 'prj_2' }),
    node('t1', { kind: 'task', parentRef: 'p1' }),
    node('t2', { kind: 'task', parentRef: 'p1' }),
    node('t3', { kind: 'task', parentRef: 'p2' }),
  ],
  edges: [],
};

describe('subtreeRefs', () => {
  it('includes every descendant in document order', () => {
    expect(subtreeRefs(DOC, ['p1'])).toEqual(['p1', 't1', 't2']);
    expect(subtreeRefs(DOC, ['init'])).toEqual(['init', 'p1', 'p2', 't1', 't2', 't3']);
  });
});

describe('describeConfirmation', () => {
  it('names a project and its tasks', () => {
    const plan = describeConfirmation(DOC, ['p1']);
    expect(plan.refs).toEqual(['init', 'p1', 't1', 't2']);
    expect(plan.label).toBe('Confirm initiative, project, and 2 tasks');
  });

  it('names a lone task with its draft ancestors, skipping confirmed ones', () => {
    expect(describeConfirmation(DOC, ['t3'])).toMatchObject({
      refs: ['t3'],
      count: 1,
      label: 'Confirm task',
    });
    expect(describeConfirmation(DOC, ['t1']).label).toBe('Confirm initiative, project, and task');
  });

  it('reports nothing to confirm for a confirmed selection', () => {
    expect(describeConfirmation(DOC, ['p2'])).toMatchObject({ count: 1, refs: ['t3'] });
    const allConfirmed: PlanDocument = {
      nodes: DOC.nodes.map((n) => ({ ...n, status: 'confirmed', objectId: 'x' })),
      edges: [],
    };
    expect(describeConfirmation(allConfirmed, ['p1'])).toMatchObject({
      count: 0,
      label: 'Nothing to confirm',
    });
  });
});
