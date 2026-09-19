import { describe, expect, it } from 'vitest';

import type { PlanDocument } from '../src/contracts/plan-draft';
import type { TemplateId } from '../src/ids';
import {
  EMPTY_PLAN_DOCUMENT,
  PlanOpError,
  applyPlanOps,
  planCommitCounts,
  planCounts,
  planNodeClosure,
} from '../src/plan-draft';

const env = { templatePayload: () => undefined };

function seeded(): PlanDocument {
  return applyPlanOps(
    EMPTY_PLAN_DOCUMENT,
    [
      {
        op: 'upsert_node',
        node: { ref: 'init', kind: 'initiative', fields: { title: 'Spring campaign' } },
      },
      {
        op: 'upsert_node',
        node: { ref: 'p1', kind: 'project', parentRef: 'init', fields: { title: 'Outreach' } },
      },
      {
        op: 'upsert_node',
        node: { ref: 't1', kind: 'task', parentRef: 'p1', fields: { title: 'Segment donors' } },
      },
    ],
    env,
  );
}

function confirmed(doc: PlanDocument, ref: string, objectId: string): PlanDocument {
  return {
    ...doc,
    nodes: doc.nodes.map((node) =>
      node.ref === ref ? { ...node, status: 'confirmed', objectId } : node,
    ),
  };
}

describe('applyPlanOps', () => {
  it('upserts nodes parents-first regardless of op order', () => {
    const doc = applyPlanOps(
      EMPTY_PLAN_DOCUMENT,
      [
        {
          op: 'upsert_node',
          node: { ref: 't1', kind: 'task', parentRef: 'p1', fields: { title: 'T' } },
        },
        {
          op: 'upsert_node',
          node: { ref: 'p1', kind: 'project', parentRef: 'init', fields: { title: 'P' } },
        },
        { op: 'upsert_node', node: { ref: 'init', kind: 'initiative', fields: { title: 'I' } } },
      ],
      env,
    );
    expect(doc.nodes.map((node) => node.ref)).toEqual(['init', 'p1', 't1']);
  });

  it('rejects a new node without a title but lets an existing one keep its own', () => {
    expect(() =>
      applyPlanOps(
        EMPTY_PLAN_DOCUMENT,
        [{ op: 'upsert_node', node: { ref: 'init', kind: 'initiative', fields: {} } }],
        env,
      ),
    ).toThrow(PlanOpError);
    const doc = applyPlanOps(
      EMPTY_PLAN_DOCUMENT,
      [
        { op: 'upsert_node', node: { ref: 'init', kind: 'initiative', fields: { title: 'I' } } },
        { op: 'upsert_node', node: { ref: 'init', kind: 'initiative', fields: { summary: 'S' } } },
      ],
      env,
    );
    expect(doc.nodes[0]?.fields).toMatchObject({ title: 'I', summary: 'S' });
  });

  it('rejects a task under an initiative', () => {
    expect(() =>
      applyPlanOps(
        EMPTY_PLAN_DOCUMENT,
        [
          { op: 'upsert_node', node: { ref: 'init', kind: 'initiative', fields: { title: 'I' } } },
          {
            op: 'upsert_node',
            node: { ref: 't', kind: 'task', parentRef: 'init', fields: { title: 'T' } },
          },
        ],
        env,
      ),
    ).toThrow(PlanOpError);
  });

  it('rejects a parentless project and an unknown parent', () => {
    expect(() =>
      applyPlanOps(
        EMPTY_PLAN_DOCUMENT,
        [{ op: 'upsert_node', node: { ref: 'p', kind: 'project', fields: { title: 'P' } } }],
        env,
      ),
    ).toThrow(PlanOpError);
    expect(() =>
      applyPlanOps(
        EMPTY_PLAN_DOCUMENT,
        [
          {
            op: 'upsert_node',
            node: { ref: 'p', kind: 'project', parentRef: 'nope', fields: { title: 'P' } },
          },
        ],
        env,
      ),
    ).toThrow(PlanOpError);
  });

  it('is atomic: a failing op leaves the document untouched', () => {
    const doc = seeded();
    expect(() =>
      applyPlanOps(
        doc,
        [
          { op: 'set_fields', ref: 'p1', fields: { summary: 'ok' } },
          { op: 'set_fields', ref: 'missing', fields: { summary: 'x' } },
        ],
        env,
      ),
    ).toThrow(PlanOpError);
    expect(doc.nodes.find((node) => node.ref === 'p1')?.fields.summary).toBeUndefined();
  });

  it('upserting an existing node merges fields and keeps its kind', () => {
    const doc = applyPlanOps(
      seeded(),
      [
        {
          op: 'upsert_node',
          node: { ref: 'p1', kind: 'project', fields: { title: 'Outreach v2', summary: 'S' } },
        },
      ],
      env,
    );
    const p1 = doc.nodes.find((node) => node.ref === 'p1');
    expect(p1?.fields).toEqual({ title: 'Outreach v2', summary: 'S' });
    expect(p1?.parentRef).toBe('init');
    expect(() =>
      applyPlanOps(
        doc,
        [{ op: 'upsert_node', node: { ref: 'p1', kind: 'task', fields: { title: 'x' } } }],
        env,
      ),
    ).toThrow(PlanOpError);
  });

  it('merges a template without overwriting set fields', () => {
    const doc = applyPlanOps(
      seeded(),
      [
        { op: 'set_fields', ref: 'p1', fields: { description: 'mine' } },
        { op: 'apply_template', ref: 'p1', templateId: 'tpl_1' as TemplateId },
      ],
      {
        templatePayload: () => ({
          targetType: 'project',
          description: 'theirs',
          summary: 'from template',
        }),
      },
    );
    const p1 = doc.nodes.find((node) => node.ref === 'p1');
    expect(p1?.fields.description).toBe('mine');
    expect(p1?.fields.summary).toBe('from template');
    expect(p1?.templateId).toBe('tpl_1');
  });

  it('rejects a template of another kind or an unknown template', () => {
    expect(() =>
      applyPlanOps(
        seeded(),
        [{ op: 'apply_template', ref: 'p1', templateId: 'tpl_x' as TemplateId }],
        env,
      ),
    ).toThrow(PlanOpError);
    expect(() =>
      applyPlanOps(
        seeded(),
        [{ op: 'apply_template', ref: 'p1', templateId: 'tpl_task' as TemplateId }],
        {
          templatePayload: () => ({ targetType: 'task', description: 'x' }),
        },
      ),
    ).toThrow(PlanOpError);
  });

  it('rejects field edits, moves, and removal on a confirmed node', () => {
    const doc = confirmed(seeded(), 'p1', 'prj_1');
    expect(() =>
      applyPlanOps(doc, [{ op: 'set_fields', ref: 'p1', fields: { summary: 'x' } }], env),
    ).toThrow(PlanOpError);
    expect(() => applyPlanOps(doc, [{ op: 'remove_node', ref: 'p1' }], env)).toThrow(PlanOpError);
    expect(() =>
      applyPlanOps(doc, [{ op: 'move_node', ref: 'p1', parentRef: 'init' }], env),
    ).toThrow(PlanOpError);
    expect(() =>
      applyPlanOps(
        doc,
        [{ op: 'upsert_node', node: { ref: 'p1', kind: 'project', fields: { title: 'x' } } }],
        env,
      ),
    ).toThrow(PlanOpError);
  });

  it('allows an edge from a confirmed node to a draft neighbour and rejects two confirmed ends', () => {
    const withP2 = applyPlanOps(
      seeded(),
      [
        {
          op: 'upsert_node',
          node: { ref: 'p2', kind: 'project', parentRef: 'init', fields: { title: 'Push' } },
        },
      ],
      env,
    );
    const doc = confirmed(withP2, 'p1', 'prj_1');
    const next = applyPlanOps(doc, [{ op: 'add_edge', fromRef: 'p1', toRef: 'p2' }], env);
    expect(next.edges).toEqual([{ fromRef: 'p1', toRef: 'p2', kind: 'blocks' }]);
    expect(
      applyPlanOps(next, [{ op: 'add_edge', fromRef: 'p1', toRef: 'p2' }], env).edges,
    ).toHaveLength(1);
    expect(() =>
      applyPlanOps(
        confirmed(next, 'p2', 'prj_2'),
        [{ op: 'add_edge', fromRef: 'p2', toRef: 'p1' }],
        env,
      ),
    ).toThrow(PlanOpError);
  });

  it('rejects an edge between different kinds, a self edge, and an unknown end', () => {
    expect(() =>
      applyPlanOps(seeded(), [{ op: 'add_edge', fromRef: 'p1', toRef: 't1' }], env),
    ).toThrow(PlanOpError);
    expect(() =>
      applyPlanOps(seeded(), [{ op: 'add_edge', fromRef: 'p1', toRef: 'p1' }], env),
    ).toThrow(PlanOpError);
    expect(() =>
      applyPlanOps(seeded(), [{ op: 'add_edge', fromRef: 'p1', toRef: 'nope' }], env),
    ).toThrow(PlanOpError);
    expect(() =>
      applyPlanOps(seeded(), [{ op: 'add_edge', fromRef: 'nope', toRef: 'p1' }], env),
    ).toThrow(PlanOpError);
  });

  it('removes an edge, and ignores removing one that is not there', () => {
    const withEdge = applyPlanOps(
      seeded(),
      [
        {
          op: 'upsert_node',
          node: { ref: 'p2', kind: 'project', parentRef: 'init', fields: { title: 'P2' } },
        },
        { op: 'add_edge', fromRef: 'p1', toRef: 'p2' },
      ],
      env,
    );
    expect(
      applyPlanOps(withEdge, [{ op: 'remove_edge', fromRef: 'p1', toRef: 'p2' }], env).edges,
    ).toEqual([]);
    expect(
      applyPlanOps(withEdge, [{ op: 'remove_edge', fromRef: 'p2', toRef: 'p1' }], env).edges,
    ).toHaveLength(1);
  });

  it('removing a node removes its subtree, its edges, and references to it', () => {
    const doc = applyPlanOps(
      seeded(),
      [
        {
          op: 'upsert_node',
          node: { ref: 'init2', kind: 'initiative', fields: { title: 'Other' } },
        },
        {
          op: 'upsert_node',
          node: {
            ref: 'p2',
            kind: 'project',
            parentRef: 'init',
            initiativeRefs: ['init2'],
            fields: { title: 'P2' },
          },
        },
        { op: 'add_edge', fromRef: 'p1', toRef: 'p2' },
        { op: 'remove_node', ref: 'init2' },
        { op: 'remove_node', ref: 'p1' },
      ],
      env,
    );
    expect(doc.nodes.map((node) => node.ref)).toEqual(['init', 'p2']);
    expect(doc.edges).toEqual([]);
    expect(doc.nodes.find((node) => node.ref === 'p2')?.initiativeRefs).toEqual([]);
  });

  it('refuses to remove a subtree holding a created node', () => {
    const doc = confirmed(seeded(), 't1', 'tsk_1');
    expect(() => applyPlanOps(doc, [{ op: 'remove_node', ref: 'p1' }], env)).toThrow(PlanOpError);
  });

  it('moves a task between projects and rejects moving under a task or into a cycle', () => {
    const doc = applyPlanOps(
      seeded(),
      [
        {
          op: 'upsert_node',
          node: { ref: 'p2', kind: 'project', parentRef: 'init', fields: { title: 'P2' } },
        },
        { op: 'move_node', ref: 't1', parentRef: 'p2' },
      ],
      env,
    );
    expect(doc.nodes.find((node) => node.ref === 't1')?.parentRef).toBe('p2');
    expect(() => applyPlanOps(doc, [{ op: 'move_node', ref: 'p2', parentRef: 't1' }], env)).toThrow(
      PlanOpError,
    );
    expect(() => applyPlanOps(doc, [{ op: 'move_node', ref: 'p2', parentRef: 'p2' }], env)).toThrow(
      PlanOpError,
    );
    expect(() => applyPlanOps(doc, [{ op: 'move_node', ref: 'p2', parentRef: null }], env)).toThrow(
      PlanOpError,
    );
  });

  it('rejects fields a kind does not carry and a blank title', () => {
    expect(() =>
      applyPlanOps(
        seeded(),
        [{ op: 'set_fields', ref: 'init', fields: { dueDate: '2026-05-01' } }],
        env,
      ),
    ).toThrow(PlanOpError);
    expect(() =>
      applyPlanOps(seeded(), [{ op: 'set_fields', ref: 't1', fields: { title: '  ' } }], env),
    ).toThrow(PlanOpError);
  });

  it('accepts set_title as a document no-op', () => {
    const doc = seeded();
    expect(applyPlanOps(doc, [{ op: 'set_title', title: 'Renamed' }], env)).toEqual(doc);
  });

  it('names the failing op in the error', () => {
    try {
      applyPlanOps(seeded(), [{ op: 'set_fields', ref: 'nope', fields: { summary: 'x' } }], env);
      throw new Error('expected a rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(PlanOpError);
      expect((error as PlanOpError).index).toBe(0);
      expect((error as PlanOpError).path).toBe('ops.0.ref');
    }
  });
});

/** The seed plus one engineering subtask under the feature task `t1`. */
function withSubtask(): PlanDocument {
  return applyPlanOps(
    seeded(),
    [
      {
        op: 'upsert_node',
        node: { ref: 's1', kind: 'task', parentRef: 't1', fields: { title: 'Add the endpoint' } },
      },
    ],
    env,
  );
}

describe('subtasks', () => {
  it('accepts a task whose parent is a task, keeping the document parents-first', () => {
    const doc = withSubtask();
    expect(doc.nodes.map((node) => node.ref)).toEqual(['init', 'p1', 't1', 's1']);
    expect(doc.nodes.find((node) => node.ref === 's1')?.parentRef).toBe('t1');
  });

  it('places a feature task and its subtasks in one batch, in any order', () => {
    const doc = applyPlanOps(
      seeded(),
      [
        {
          op: 'upsert_node',
          node: { ref: 's2', kind: 'task', parentRef: 'f1', fields: { title: 'Write the schema' } },
        },
        {
          op: 'upsert_node',
          node: { ref: 'f1', kind: 'task', parentRef: 'p1', fields: { title: 'Mood entry' } },
        },
      ],
      env,
    );
    expect(doc.nodes.map((node) => node.ref)).toEqual(['init', 'p1', 't1', 'f1', 's2']);
  });

  it('refuses a subtask under a subtask', () => {
    expect(() =>
      applyPlanOps(
        withSubtask(),
        [
          {
            op: 'upsert_node',
            node: { ref: 's1a', kind: 'task', parentRef: 's1', fields: { title: 'Too deep' } },
          },
        ],
        env,
      ),
    ).toThrow(PlanOpError);
  });

  it('refuses a move that would push existing subtasks too deep', () => {
    const doc = applyPlanOps(
      withSubtask(),
      [
        {
          op: 'upsert_node',
          node: { ref: 't2', kind: 'task', parentRef: 'p1', fields: { title: 'Other feature' } },
        },
      ],
      env,
    );
    expect(() => applyPlanOps(doc, [{ op: 'move_node', ref: 't1', parentRef: 't2' }], env)).toThrow(
      PlanOpError,
    );
  });

  it('carries the assignee and team a subtask is given', () => {
    const doc = applyPlanOps(
      withSubtask(),
      [
        {
          op: 'set_fields',
          ref: 's1',
          fields: {
            assigneeId: '01J0000000000000000000000A' as never,
            teamId: '01J0000000000000000000000B' as never,
          },
        },
      ],
      env,
    );
    const subtask = doc.nodes.find((node) => node.ref === 's1');
    expect(subtask?.fields.assigneeId).toBe('01J0000000000000000000000A');
    expect(subtask?.fields.teamId).toBe('01J0000000000000000000000B');
  });

  it('pulls the feature task along when a subtask is committed', () => {
    expect(planNodeClosure(withSubtask(), ['s1'])).toEqual(['init', 'p1', 't1', 's1']);
  });
});

describe('planCommitCounts', () => {
  it('counts a subtask apart from a task and ignores what was matched', () => {
    const doc = withSubtask();
    expect(
      planCommitCounts(doc, [
        { ref: 'init', kind: 'initiative', id: 'i1', created: true },
        { ref: 'p1', kind: 'project', id: 'p1id', created: false },
        { ref: 't1', kind: 'task', id: 't1id', created: true },
        { ref: 's1', kind: 'task', id: 's1id', created: true },
      ]),
    ).toEqual({ initiatives: 1, projects: 0, tasks: 1, subtasks: 1 });
  });

  it('counts nothing when every node was matched', () => {
    expect(
      planCommitCounts(withSubtask(), [{ ref: 't1', kind: 'task', id: 'x', created: false }]),
    ).toEqual({ initiatives: 0, projects: 0, tasks: 0, subtasks: 0 });
  });
});

describe('planNodeClosure', () => {
  it('adds unconfirmed ancestors parents-first', () => {
    expect(planNodeClosure(seeded(), ['t1'])).toEqual(['init', 'p1', 't1']);
  });

  it('skips confirmed ancestors and unknown refs', () => {
    const doc = confirmed(seeded(), 'init', 'ini_1');
    expect(planNodeClosure(doc, ['t1', 'nope'])).toEqual(['p1', 't1']);
  });

  it('does not include a confirmed target', () => {
    expect(planNodeClosure(confirmed(seeded(), 't1', 'tsk_1'), ['t1'])).toEqual([]);
  });
});

describe('planCounts', () => {
  it('counts by kind and draft', () => {
    expect(planCounts(seeded())).toEqual({ projects: 1, tasks: 1, draft: 3 });
    expect(planCounts(confirmed(seeded(), 'init', 'x'))).toEqual({
      projects: 1,
      tasks: 1,
      draft: 2,
    });
  });
});
