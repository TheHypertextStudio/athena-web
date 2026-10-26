import { describe, expect, it } from 'vitest';
import { projectWorkGraph } from '../../src/work-graph/projection';
import type { GraphWork, GraphRelation } from '../../src/work-graph/contract';

const work = (
  id: string,
  kind: GraphWork['kind'] = 'task',
  category: GraphWork['category'] = 'unstarted',
): GraphWork => ({
  key: `${kind}:${id}`,
  id,
  kind,
  title: id,
  status: category,
  category,
  priority: 'none',
  href: `/work/${id}`,
});
const edge = (
  source: string,
  target: string,
  kind: GraphRelation['kind'] = 'task_dependency',
): GraphRelation => ({ source, target, kind });
const input = {
  orgId: 'org',
  scope: { kind: 'project' as const, id: 'p' },
  display: 'fullscreen' as const,
  completion: 'collapsed' as const,
  viewport: 'landscape' as const,
  expanded: [],
  page: 0,
};

describe('work graph projection', () => {
  it('counts each scoped task once and excludes external dependency context', () => {
    const result = projectWorkGraph(
      {
        nodes: [work('p', 'project'), work('a'), work('b', 'task', 'completed'), work('outside')],
        relations: [
          edge('project:p', 'task:a', 'contains'),
          edge('project:p', 'task:b', 'contains'),
          edge('task:outside', 'task:a'),
        ],
      },
      input,
    );
    expect(result.totals).toMatchObject({ total: 2, remaining: 1, completed: 1, canceled: 0 });
    expect(result.nodes.find((n) => n.key === 'task:outside')?.external).toBe(true);
    expect(result.completedGroups[0]?.count).toBe(1);
  });

  it('separates project dependencies from aggregated task dependencies', () => {
    const result = projectWorkGraph(
      {
        nodes: [
          work('root', 'program'),
          work('p', 'project'),
          work('q', 'project'),
          work('a'),
          work('b'),
        ],
        relations: [
          edge('program:root', 'project:p', 'contains'),
          edge('program:root', 'project:q', 'contains'),
          edge('project:p', 'task:a', 'contains'),
          edge('project:q', 'task:b', 'contains'),
          edge('task:a', 'task:b'),
          edge('project:p', 'project:q', 'project_dependency'),
        ],
      },
      { ...input, scope: { kind: 'program', id: 'root' } },
    );
    expect(result.edges.map((e) => e.kind)).toContain('project_dependency');
    expect(result.edges.map((e) => e.kind)).toContain('task_dependency');
    expect(result.edges.find((e) => e.kind === 'task_dependency')).toMatchObject({
      source: 'project:p',
      target: 'project:q',
      count: 1,
    });
  });

  it('limits inline work to six without losing scope totals or independent work', () => {
    const nodes = Array.from({ length: 12 }, (_, i) => work(`a${i}`));
    const result = projectWorkGraph(
      {
        nodes: [work('p', 'project'), ...nodes],
        relations: nodes.map((n) => edge('project:p', n.key, 'contains')),
      },
      { ...input, display: 'inline' },
    );
    expect(result.nodes).toHaveLength(6);
    expect(result.totals.total).toBe(12);
    expect(result.omitted).toBe(6);
  });

  it('keeps canceled separate and totals stable when completed work is hidden', () => {
    const result = projectWorkGraph(
      {
        nodes: [
          work('p', 'project'),
          work('a', 'task', 'canceled'),
          work('b', 'task', 'completed'),
        ],
        relations: [
          edge('project:p', 'task:a', 'contains'),
          edge('project:p', 'task:b', 'contains'),
        ],
      },
      { ...input, completion: 'remaining' },
    );
    expect(result.totals).toMatchObject({ completed: 1, canceled: 1, remaining: 0 });
    expect(result.nodes).toHaveLength(0);
  });
});

describe('bounded and connected scenes', () => {
  it('keeps an ended parent available when unfinished children remain', () => {
    const result = projectWorkGraph(
      {
        nodes: [work('p', 'project'), work('parent', 'task', 'completed'), work('child')],
        relations: [
          edge('project:p', 'task:parent', 'contains'),
          edge('project:p', 'task:child', 'contains'),
          edge('task:parent', 'task:child', 'contains'),
        ],
      },
      { ...input, expanded: ['task:parent'] },
    );
    expect(result.nodes.map((n) => n.id)).toContain('child');
    expect(result.nodes.map((n) => n.id)).toContain('parent');
  });
  it('bounds large scenes and marks connections that continue beyond their page', () => {
    const nodes = Array.from({ length: 250 }, (_, i) => work(String(i).padStart(3, '0')));
    const relations = [
      ...nodes.map((n) => edge('project:p', n.key, 'contains')),
      edge('task:000', 'task:249'),
    ];
    const result = projectWorkGraph({ nodes: [work('p', 'project'), ...nodes], relations }, input);
    expect(result.nodes).toHaveLength(100);
    expect(result.hasNextPage).toBe(true);
    expect(result.totals.total).toBe(250);
    expect(result.boundaries).toContainEqual({ key: 'task:000', incoming: 0, outgoing: 1 });
  });
  it('prioritizes the selected task and its blockers before unrelated work', () => {
    const nodes = Array.from({ length: 12 }, (_, i) => work(`a${i}`));
    const result = projectWorkGraph(
      {
        nodes: [work('p', 'project'), ...nodes],
        relations: [
          ...nodes.map((n) => edge('project:p', n.key, 'contains')),
          edge('task:a9', 'task:a8'),
        ],
      },
      { ...input, display: 'inline', focus: 'task:a8' },
    );
    expect(result.nodes.slice(0, 2).map((n) => n.id)).toEqual(['a8', 'a9']);
  });
});

it('shows a connected dependency slice in a narrow inline view', () => {
  const nodes = [
    work('p', 'project'),
    work('a', 'task', 'started'),
    work('b', 'task', 'started'),
    work('c'),
  ];
  const result = projectWorkGraph(
    {
      nodes,
      relations: [
        edge('project:p', 'task:a', 'contains'),
        edge('project:p', 'task:b', 'contains'),
        edge('project:p', 'task:c', 'contains'),
        edge('task:a', 'task:c'),
      ],
    },
    { ...input, display: 'inline', viewport: 'portrait' },
  );
  expect(result.nodes.map((n) => n.id)).toEqual(['a', 'c']);
  expect(result.edges).toHaveLength(1);
});

it('does not turn hidden completed prerequisites into a dependency from their expanded project', () => {
  const nodes = [
    work('root', 'program'),
    work('p', 'project'),
    work('done', 'task', 'completed'),
    work('next'),
  ];
  const result = projectWorkGraph(
    {
      nodes,
      relations: [
        edge('program:root', 'project:p', 'contains'),
        edge('project:p', 'task:done', 'contains'),
        edge('project:p', 'task:next', 'contains'),
        edge('task:done', 'task:next'),
      ],
    },
    { ...input, scope: { kind: 'program', id: 'root' }, expanded: ['project:p'] },
  );
  expect(result.edges).not.toContainEqual(
    expect.objectContaining({ source: 'project:p', target: 'task:next' }),
  );
});

it('reveals focused completed work within collapsed ancestor groups', () => {
  const nodes = [work('root', 'program'), work('p', 'project'), work('done', 'task', 'completed')];
  const result = projectWorkGraph(
    {
      nodes,
      relations: [
        edge('program:root', 'project:p', 'contains'),
        edge('project:p', 'task:done', 'contains'),
      ],
    },
    { ...input, scope: { kind: 'program', id: 'root' }, completion: 'all', focus: 'task:done' },
  );
  expect(result.nodes.map((n) => n.key)).toContain('task:done');
});

it('retains expanded ancestor containers when paging many started children', () => {
  const children = Array.from({ length: 101 }, (_, i) => work(`a${i}`, 'task', 'started'));
  const nodes = [work('root', 'program'), work('p', 'project'), ...children];
  const relations = [
    edge('program:root', 'project:p', 'contains'),
    ...children.map((n) => edge('project:p', n.key, 'contains')),
  ];
  const result = projectWorkGraph(
    { nodes, relations },
    { ...input, scope: { kind: 'program', id: 'root' }, expanded: ['project:p'] },
  );
  expect(result.nodes.find((n) => n.key === 'project:p')).toBeDefined();
  expect(result.nodes.filter((n) => n.kind === 'task')).toHaveLength(100);
  expect(
    result.nodes.filter((n) => n.kind === 'task').every((n) => n.parentKey === 'project:p'),
  ).toBe(true);
  const next = projectWorkGraph(
    { nodes, relations },
    { ...input, scope: { kind: 'program', id: 'root' }, expanded: ['project:p'], page: 1 },
  );
  expect(next.nodes.filter((n) => n.kind === 'task')).toHaveLength(1);
  expect(next.nodes.find((n) => n.key === 'project:p')).toBeDefined();
});
