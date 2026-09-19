import { describe, expect, it } from 'vitest';

import type { PlanDraftOut, PlanNode } from '@docket/work/plan-draft-contract';

import { EMPTY_PLAN_DIFF, planDiff } from '../../src/components/plan-canvas/plan-diff';
import {
  PLAN_DEPENDENCY_STROKE,
  PLAN_EDGE_TYPE,
  PLAN_NODE_TYPE,
  projectPlan,
  type PlanActor,
  type PlanProjectNodeData,
  type PlanTaskNodeData,
} from '../../src/components/plan-canvas/plan-nodes';

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

const PLAN: PlanDraftOut = {
  id: 'plan_1',
  organizationId: 'org_1' as PlanDraftOut['organizationId'],
  sessionId: null,
  rootInitiativeId: null,
  title: 'Spring',
  status: 'active',
  revision: 3,
  document: {
    nodes: [
      node('init', {
        kind: 'initiative',
        fields: { title: 'Spring campaign', ownerId: 'a1' as never },
      }),
      node('init2', { kind: 'initiative', fields: { title: 'Brand refresh' } }),
      node('p1', {
        kind: 'project',
        parentRef: 'init',
        fields: { title: 'Outreach', leadId: 'a2' as never },
        status: 'confirmed',
        objectId: 'prj_1',
      }),
      node('p2', {
        kind: 'project',
        parentRef: 'init',
        initiativeRefs: ['init2'],
        initiativeIds: ['ini_existing' as never],
        fields: { title: 'Push' },
      }),
      node('t1', { kind: 'task', parentRef: 'p1', fields: { title: 'Segment donors' } }),
      node('t2', { kind: 'task', parentRef: 'p2', fields: { title: 'Daily posts' } }),
      node('orphan', { kind: 'task', parentRef: 'missing', fields: { title: 'Lost' } }),
    ],
    edges: [
      { fromRef: 'p1', toRef: 'p2', kind: 'blocks' },
      { fromRef: 't1', toRef: 't2', kind: 'blocks' },
      { fromRef: 'nope', toRef: 't2', kind: 'blocks' },
    ],
  },
  objects: {
    p1: {
      name: 'Outreach (live)',
      statusName: 'Planned',
      health: null,
      href: '/orgs/org_1/projects/prj_1',
      archived: false,
    },
  },
  createdAt: '2026-09-05T00:00:00.000Z',
  updatedAt: '2026-09-05T00:00:00.000Z',
};

const options = {
  orgId: 'org_1',
  diff: EMPTY_PLAN_DIFF,
  canEdit: true,
  resolveActor: (id: string): PlanActor | null => {
    if (id === 'a1') return { kind: 'human', name: 'Priya', avatarUrl: null };
    if (id === 'a2')
      return { kind: 'human', name: 'Sam', avatarUrl: 'https://cdn.example/sam.png' };
    return null;
  },
  initiativeName: (id: string) => (id === 'ini_existing' ? 'Existing initiative' : null),
  expandedRefs: new Set(['p1']),
  resolveTeam: (id: string) => (id === 'team_eng' ? 'Engineering' : null),
  collapsedTaskRefs: new Set<string>(),
};

/** A feature task in `p1` with two subtasks, one assigned on the engineering team. */
const SUBTASK_PLAN: PlanDraftOut = {
  ...PLAN,
  document: {
    ...PLAN.document,
    nodes: [
      ...PLAN.document.nodes,
      node('s1', {
        kind: 'task',
        parentRef: 't1',
        fields: {
          title: 'Build the endpoint',
          assigneeId: 'a2' as never,
          teamId: 'team_eng' as never,
        },
      }),
      node('t3', { kind: 'task', parentRef: 'p1', fields: { title: 'Write the copy' } }),
      node('s2', { kind: 'task', parentRef: 't1', fields: { title: 'Wire the form' } }),
    ],
  },
};

describe('projectPlan subtasks', () => {
  it('lists each subtask directly under its feature task, one level in, in the same container', () => {
    const { nodes } = projectPlan(SUBTASK_PLAN, options);
    const rows = nodes.filter((n) => n.type === PLAN_NODE_TYPE.task && n.parentId === 'p1');
    expect(rows.map((n) => n.id)).toEqual(['t1', 's1', 's2', 't3']);
    const feature = rows[0]?.data as PlanTaskNodeData;
    expect(feature.depth).toBe(0);
    expect(feature.subtaskCount).toBe(2);
    expect(feature.canAddSubtask).toBe(true);
    const subtask = rows[1]?.data as PlanTaskNodeData;
    expect(subtask.depth).toBe(1);
    expect(subtask.parentTaskRef).toBe('t1');
    expect(subtask.canAddSubtask).toBe(false);
    expect(subtask.assignee?.name).toBe('Sam');
    expect(subtask.team).toBe('Engineering');
  });

  it('hides the subtasks of a folded feature task and names only feature tasks in miniature', () => {
    const { nodes } = projectPlan(SUBTASK_PLAN, { ...options, collapsedTaskRefs: new Set(['t1']) });
    expect(nodes.find((n) => n.id === 't1')?.hidden).toBe(false);
    expect(nodes.find((n) => n.id === 's1')?.hidden).toBe(true);
    expect((nodes.find((n) => n.id === 't1')?.data as PlanTaskNodeData).subtasksShown).toBe(false);
    const p1 = nodes.find((n) => n.id === 'p1')?.data as PlanProjectNodeData;
    expect(p1.tasks.map((task) => task.ref)).toEqual(['t1', 't3']);
  });

  it('hides subtasks with their container', () => {
    const { nodes } = projectPlan(SUBTASK_PLAN, { ...options, expandedRefs: new Set<string>() });
    expect(nodes.find((n) => n.id === 's1')?.hidden).toBe(true);
    expect(nodes.find((n) => n.id === 's2')?.hidden).toBe(true);
  });
});

describe('projectPlan', () => {
  it('emits parents before children with the right types and containment', () => {
    const { nodes } = projectPlan(PLAN, options);
    expect(nodes.map((n) => n.id)).toEqual(['init', 'init2', 'p1', 'p2', 't1', 't2']);
    expect(nodes.find((n) => n.id === 'init')?.type).toBe(PLAN_NODE_TYPE.initiative);
    expect(nodes.find((n) => n.id === 'p1')?.type).toBe(PLAN_NODE_TYPE.project);
    const t1 = nodes.find((n) => n.id === 't1');
    expect(t1?.type).toBe(PLAN_NODE_TYPE.task);
    expect(t1?.parentId).toBe('p1');
    expect(t1?.extent).toBeUndefined();
  });

  it('draws initiative membership as link edges and dependencies as dependency edges', () => {
    const { edges } = projectPlan(PLAN, options);
    expect(edges.map((e) => e.id).sort()).toEqual(
      ['link:init>p1', 'link:init>p2', 'link:init2>p2', 'dep:p1>p2', 'dep:t1>t2'].sort(),
    );
    const link = edges.find((e) => e.id === 'link:init>p2');
    expect(link?.type).toBe(PLAN_EDGE_TYPE.link);
    expect(link?.selectable).toBe(false);
    expect(link?.focusable).toBe(false);
    const dep = edges.find((e) => e.id === 'dep:p1>p2');
    expect(dep?.type).toBe(PLAN_EDGE_TYPE.dependency);
    expect(dep?.data).toEqual({ kind: 'dependency' });
    expect(dep?.markerEnd).toMatchObject({ type: 'arrowclosed', color: PLAN_DEPENDENCY_STROKE });
    expect(dep?.style).toMatchObject({ stroke: PLAN_DEPENDENCY_STROKE });
    expect(link?.markerEnd).toBeUndefined();
  });

  it('hydrates a confirmed node from its live record and resolves names', () => {
    const { nodes } = projectPlan(PLAN, options);
    const p1 = nodes.find((n) => n.id === 'p1')?.data as PlanProjectNodeData;
    expect(p1.title).toBe('Outreach (live)');
    expect(p1.href).toBe('/orgs/org_1/projects/prj_1');
    expect(p1.status).toBe('confirmed');
    expect(p1.lead).toEqual({
      kind: 'human',
      name: 'Sam',
      avatarUrl: 'https://cdn.example/sam.png',
    });
    expect(p1.taskCount).toBe(1);
    expect(p1.canAddTask).toBe(false);
    expect(p1.expanded).toBe(true);
    expect(p1.tasks.map((task) => task.ref)).toEqual(['t1']);
    const p2 = nodes.find((n) => n.id === 'p2')?.data as PlanProjectNodeData;
    expect(p2.alsoIn).toEqual(['Brand refresh', 'Existing initiative']);
    expect(p2.canAddTask).toBe(true);
  });

  it("keeps a collapsed container's rows out of the graph and names them in miniature", () => {
    const { nodes } = projectPlan(PLAN, options);
    expect(nodes.find((n) => n.id === 't1')?.hidden).toBe(false);
    expect(nodes.find((n) => n.id === 't2')?.hidden).toBe(true);
    const p2 = nodes.find((n) => n.id === 'p2')?.data as PlanProjectNodeData;
    expect(p2.expanded).toBe(false);
    expect(p2.tasks).toEqual([{ ref: 't2', title: 'Daily posts', status: 'draft' }]);
  });

  it('marks entered nodes and changed fields from the diff', () => {
    const previous = { ...PLAN.document, nodes: PLAN.document.nodes.filter((n) => n.ref !== 't2') };
    const diff = planDiff(previous, PLAN.document);
    const { nodes } = projectPlan(PLAN, { ...options, diff });
    const t2 = nodes.find((n) => n.id === 't2')?.data as PlanTaskNodeData;
    expect(t2.entered).toBe(true);
    expect(nodes.find((n) => n.id === 't1')?.data['entered']).toBe(false);
  });

  it('keeps a draft task draggable and a confirmed task pinned', () => {
    const confirmed = {
      ...PLAN,
      document: {
        ...PLAN.document,
        nodes: PLAN.document.nodes.map((n) =>
          n.ref === 't1' ? { ...n, status: 'confirmed' as const, objectId: 'tsk_1' } : n,
        ),
      },
    };
    const { nodes } = projectPlan(confirmed, options);
    expect(nodes.find((n) => n.id === 't1')?.draggable).toBe(false);
    expect(nodes.find((n) => n.id === 't2')?.draggable).toBe(true);
  });
});
