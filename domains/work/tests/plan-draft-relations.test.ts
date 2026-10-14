/** How a plan document places a project among initiatives and joins nodes by dependency. */
import { describe, expect, it } from 'vitest';

import type { PlanDocument, PlanOp } from '../src/contracts/plan-draft';
import { EMPTY_PLAN_DOCUMENT, PlanOpError, applyPlanOps, planNode } from '../src/plan-draft';

const env = { templatePayload: () => undefined };

/** Two initiatives and a project under the first. */
function twoInitiatives(): PlanDocument {
  return applyPlanOps(
    EMPTY_PLAN_DOCUMENT,
    [
      { op: 'upsert_node', node: { ref: 'init', kind: 'initiative', fields: { title: 'Spring' } } },
      { op: 'upsert_node', node: { ref: 'q4', kind: 'initiative', fields: { title: 'Q4' } } },
      {
        op: 'upsert_node',
        node: { ref: 'p1', kind: 'project', parentRef: 'init', fields: { title: 'Outreach' } },
      },
    ],
    env,
  );
}

/** The rejection an op batch raises. */
function rejection(document: PlanDocument, ops: PlanOp[]): PlanOpError {
  try {
    applyPlanOps(document, ops, env);
  } catch (error) {
    if (error instanceof PlanOpError) return error;
    throw error;
  }
  throw new Error('expected a rejection');
}

describe('initiative membership', () => {
  it('places a project under the first initiative it names when it has no parent', () => {
    const doc = applyPlanOps(
      twoInitiatives(),
      [
        {
          op: 'upsert_node',
          node: {
            ref: 'p2',
            kind: 'project',
            initiativeRefs: ['q4', 'init'],
            fields: { title: 'Donors' },
          },
        },
      ],
      env,
    );

    expect(planNode(doc, 'p2')).toMatchObject({ parentRef: 'q4', initiativeRefs: ['init'] });
  });

  it('drops the parent from the extra initiatives it repeats', () => {
    const doc = applyPlanOps(
      twoInitiatives(),
      [
        {
          op: 'upsert_node',
          node: { ref: 'p1', kind: 'project', initiativeRefs: ['init', 'q4'], fields: {} },
        },
      ],
      env,
    );

    expect(planNode(doc, 'p1')).toMatchObject({ parentRef: 'init', initiativeRefs: ['q4'] });
  });

  it('refuses initiative refs on anything but a project', () => {
    const error = rejection(twoInitiatives(), [
      {
        op: 'upsert_node',
        node: {
          ref: 't1',
          kind: 'task',
          parentRef: 'p1',
          initiativeRefs: ['q4'],
          fields: { title: 'T' },
        },
      },
    ]);

    expect(error.path).toBe('ops.0.node.initiativeRefs');
  });

  it('refuses an initiative ref that names no initiative, listing the ones that exist', () => {
    const error = rejection(twoInitiatives(), [
      {
        op: 'upsert_node',
        node: { ref: 'p2', kind: 'project', initiativeRefs: ['p1'], fields: { title: 'P' } },
      },
    ]);

    expect(error.path).toBe('ops.0.node.initiativeRefs');
    expect(error.options).toEqual(['init', 'q4']);
  });

  it('lists the nodes a parentless project could sit under', () => {
    const error = rejection(twoInitiatives(), [
      { op: 'upsert_node', node: { ref: 'p2', kind: 'project', fields: { title: 'P' } } },
    ]);

    expect(error.path).toBe('ops.0.parentRef');
    expect(error.options).toEqual(['init', 'q4']);
  });

  it('lists the projects and tasks a task could sit under instead of an initiative', () => {
    const error = rejection(twoInitiatives(), [
      {
        op: 'upsert_node',
        node: { ref: 't1', kind: 'task', parentRef: 'init', fields: { title: 'T' } },
      },
    ]);

    expect(error.options).toEqual(['p1']);
  });
});

describe('dependency edges', () => {
  /** Three projects under one initiative. */
  function threeProjects(): PlanDocument {
    return applyPlanOps(
      twoInitiatives(),
      [
        {
          op: 'upsert_node',
          node: { ref: 'p2', kind: 'project', parentRef: 'init', fields: { title: 'P2' } },
        },
        {
          op: 'upsert_node',
          node: { ref: 'p3', kind: 'project', parentRef: 'init', fields: { title: 'P3' } },
        },
      ],
      env,
    );
  }

  it('refuses an edge that would close a two-node cycle', () => {
    const doc = applyPlanOps(
      threeProjects(),
      [{ op: 'add_edge', fromRef: 'p1', toRef: 'p2' }],
      env,
    );

    const error = rejection(doc, [{ op: 'add_edge', fromRef: 'p2', toRef: 'p1' }]);

    expect(error.path).toBe('ops.0.toRef');
  });

  it('refuses an edge that would close a longer cycle within one batch', () => {
    const error = rejection(threeProjects(), [
      { op: 'add_edge', fromRef: 'p1', toRef: 'p2' },
      { op: 'add_edge', fromRef: 'p2', toRef: 'p3' },
      { op: 'add_edge', fromRef: 'p3', toRef: 'p1' },
    ]);

    expect(error.index).toBe(2);
  });

  it('accepts a chain without a cycle', () => {
    const doc = applyPlanOps(
      threeProjects(),
      [
        { op: 'add_edge', fromRef: 'p1', toRef: 'p2' },
        { op: 'add_edge', fromRef: 'p1', toRef: 'p3' },
        { op: 'add_edge', fromRef: 'p2', toRef: 'p3' },
      ],
      env,
    );

    expect(doc.edges).toHaveLength(3);
  });
});
