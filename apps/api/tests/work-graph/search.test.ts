import { describe, expect, it } from 'vitest';
import { projectWorkGraph } from '../../src/work-graph/projection';
import type { GraphData, GraphWork } from '../../src/work-graph/contract';

const node = (
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
  href: '/work/' + id,
});
const input = {
  orgId: 'org',
  scope: { kind: 'program' as const, id: 'root' },
  display: 'fullscreen' as const,
};
const grouped = (): GraphData => ({
  nodes: [
    node('root', 'program'),
    node('project', 'project'),
    node('Finished membership', 'task', 'completed'),
    node('unrelated'),
  ],
  relations: [
    { source: 'program:root', target: 'project:project', kind: 'contains' },
    { source: 'project:project', target: 'task:Finished membership', kind: 'contains' },
  ],
});

describe('searching a scoped work graph', () => {
  it('finds completed work inside a collapsed group without changing the displayed completion mode', () => {
    const result = projectWorkGraph(grouped(), { ...input, search: 'MEMBERSHIP' });
    expect(result.search.total).toBe(1);
    expect(result.search.results[0]).toMatchObject({
      key: 'task:Finished membership',
      category: 'completed',
      trail: [{ key: 'project:project', title: 'project' }],
    });
    expect(result.nodes.some((n) => n.key === 'task:Finished membership')).toBe(false);
  });
  it('searches beyond the current graph page and reveals the selected result', () => {
    const tasks = Array.from({ length: 240 }, (_, i) => node('Task ' + String(i).padStart(3, '0')));
    const data: GraphData = {
      nodes: [node('root', 'program'), ...tasks],
      relations: tasks.map((n) => ({ source: 'program:root', target: n.key, kind: 'contains' })),
    };
    const search = projectWorkGraph(data, { ...input, search: 'Task 239' });
    expect(search.search.results[0]?.key).toBe('task:Task 239');
    const revealed = projectWorkGraph(data, { ...input, focus: 'task:Task 239' });
    expect(revealed.nodes.some((n) => n.key === 'task:Task 239')).toBe(true);
  });
  it('bounds and pages results with stable counts, excluding unrelated work', () => {
    const tasks = Array.from({ length: 45 }, (_, i) => node('Match ' + String(i).padStart(2, '0')));
    const data: GraphData = {
      nodes: [node('root', 'program'), ...tasks, node('Match outside')],
      relations: tasks.map((n) => ({ source: 'program:root', target: n.key, kind: 'contains' })),
    };
    const result = projectWorkGraph(data, { ...input, search: 'match', searchOffset: 20 });
    expect(result.search.total).toBe(45);
    expect(result.search.results).toHaveLength(20);
    expect(result.search.hasMore).toBe(true);
    expect(result.search.results[0]?.key).toBe('task:Match 20');
    expect(result.search.results.some((n) => n.key === 'task:Match outside')).toBe(false);
  });
  it('describes actual completed prerequisites and named authorized connections outside the view', () => {
    const data = grouped();
    const result = projectWorkGraph(
      {
        nodes: [...data.nodes, node('Next')],
        relations: [
          ...data.relations,
          { source: 'project:project', target: 'task:Next', kind: 'contains' },
          { source: 'task:Finished membership', target: 'task:Next', kind: 'task_dependency' },
        ],
      },
      { ...input, scope: { kind: 'project', id: 'project' }, display: 'inline' },
    );
    expect(result.completedBranches[0]).toMatchObject({
      target: 'task:Next',
      count: 1,
      focus: 'task:Finished membership',
    });
    expect(result.boundaries.find((b) => b.key === 'task:Next')?.connections[0]?.work.title).toBe(
      'Finished membership',
    );
  });
});

describe('canonical inspector relationships', () => {
  it('returns an actual prerequisite once even when its displayed arrow comes from a collapsed project', async () => {
    const { graphFixture } = await import('./fixtures');
    const result = projectWorkGraph(graphFixture(), {
      orgId: 'demo',
      scope: { kind: 'program', id: 'portal' },
      display: 'fullscreen',
      focus: 'task:t12',
    });
    expect(
      result.edges.some((e) => e.source === 'project:membership' && e.target === 'task:t12'),
    ).toBe(true);
    const detail = result.details.find((d) => d.key === 'task:t12');
    expect(detail?.incoming.total).toBe(1);
    expect(detail?.incoming.items).toEqual([
      expect.objectContaining({
        kind: 'task_dependency',
        work: expect.objectContaining({ key: 'task:t11' }),
        trail: [{ key: 'project:membership', title: 'Membership' }],
      }),
    ]);
    expect(detail?.trail).toEqual([{ key: 'project:launch', title: 'Launch and adoption' }]);
  });
  it('keeps saved project dependencies distinct from relationships between contained work', async () => {
    const { graphFixture } = await import('./fixtures');
    const result = projectWorkGraph(graphFixture(), {
      orgId: 'demo',
      scope: { kind: 'program', id: 'portal' },
      display: 'fullscreen',
    });
    const incoming = result.details.find((d) => d.key === 'project:membership')?.incoming;
    expect(incoming?.items).toContainEqual(
      expect.objectContaining({
        kind: 'project_dependency',
        work: expect.objectContaining({ key: 'project:identity' }),
      }),
    );
    expect(incoming?.items).toContainEqual(
      expect.objectContaining({
        kind: 'task_dependency',
        work: expect.objectContaining({ key: 'task:t05' }),
        via: expect.objectContaining({ key: 'task:t06' }),
      }),
    );
  });
});

it('bounds deep ancestor context and discloses omitted groups', () => {
  const groups = Array.from({ length: 14 }, (_, i) => node(`Group ${i}`, 'task'));
  const data: GraphData = {
    nodes: [node('root', 'program'), ...groups, node('needle')],
    relations: [
      { source: 'program:root', target: 'task:Group 0', kind: 'contains' },
      ...groups
        .slice(1)
        .map((n, i) => ({ source: `task:Group ${i}`, target: n.key, kind: 'contains' as const })),
      { source: 'task:Group 13', target: 'task:needle', kind: 'contains' },
    ],
  };
  const result = projectWorkGraph(data, { ...input, search: 'needle', focus: 'task:needle' });
  expect(result.search.results[0]?.trail).toHaveLength(10);
  expect(result.search.results[0]?.trailTruncated).toBe(true);
  expect(result.details.find((d) => d.key === 'task:needle')?.trailTruncated).toBe(true);
});

it('keeps an explicitly selected project inspectable in a bounded inline view', async () => {
  const { graphFixture } = await import('./fixtures');
  const result = projectWorkGraph(graphFixture(), {
    orgId: 'demo',
    scope: { kind: 'program', id: 'portal' },
    display: 'inline',
    viewport: 'portrait',
    focus: 'project:identity',
  });
  expect(result.nodes.some((n) => n.key === 'project:identity')).toBe(true);
  expect(result.nodes.length).toBeLessThanOrEqual(2);
});
