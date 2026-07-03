import { describe, expect, it } from 'vitest';

import { LINEAR_WORK_GRAPH } from '../../src/fixtures';
import { MockConnector } from '../../src/mock/connector';
import type { ExternalPriority, WorkGraphConnector } from '../../src/ports/work-graph';

/** Get a linear-bound mock's work-graph capability, failing loudly if it's somehow absent. */
function linearWorkGraph(): WorkGraphConnector {
  const graph = new MockConnector({ provider: 'linear' }).asWorkGraph();
  if (!graph) throw new Error('expected a work-graph connector');
  return graph;
}

describe('MockConnector work-graph capability', () => {
  it('exposes asWorkGraph for linear and undefined for every other provider', () => {
    expect(new MockConnector({ provider: 'linear' }).asWorkGraph()).toBeDefined();
    expect(new MockConnector({ provider: 'github' }).asWorkGraph()).toBeUndefined();
    expect(new MockConnector({ provider: 'gtasks' }).asWorkGraph()).toBeUndefined();
    expect(new MockConnector().asWorkGraph()).toBeUndefined();
  });

  describe('pullWorkGraph', () => {
    it('is deterministic: two identical calls return equal snapshots', async () => {
      const graph = linearWorkGraph();
      const first = await graph.pullWorkGraph({ externalTeamIds: [] });
      const second = await graph.pullWorkGraph({ externalTeamIds: [] });
      expect(first).toEqual(second);
    });

    it('returns fresh array copies, not the shared fixture references', async () => {
      const graph = linearWorkGraph();
      const snapshot = await graph.pullWorkGraph({ externalTeamIds: [] });
      expect(snapshot.users).not.toBe(LINEAR_WORK_GRAPH.users);
      expect(snapshot.labels).not.toBe(LINEAR_WORK_GRAPH.labels);
      expect(snapshot.projects).not.toBe(LINEAR_WORK_GRAPH.projects);
      expect(snapshot.cycles).not.toBe(LINEAR_WORK_GRAPH.cycles);
      expect(snapshot.items).not.toBe(LINEAR_WORK_GRAPH.items);
    });

    it('an unscoped pull returns the full fixture', async () => {
      const graph = linearWorkGraph();
      const snapshot = await graph.pullWorkGraph({ externalTeamIds: [] });
      expect(snapshot).toEqual(LINEAR_WORK_GRAPH);
    });

    it('scopes items/cycles by externalTeamId and projects by intersection, keeping all users/labels', async () => {
      const graph = linearWorkGraph();
      const snapshot = await graph.pullWorkGraph({ externalTeamIds: ['lin-team-eng'] });

      expect(snapshot.items.every((item) => item.externalTeamId === 'lin-team-eng')).toBe(true);
      expect(snapshot.items.map((i) => i.externalId)).toEqual(
        LINEAR_WORK_GRAPH.items
          .filter((i) => i.externalTeamId === 'lin-team-eng')
          .map((i) => i.externalId),
      );
      expect(snapshot.cycles.every((cycle) => cycle.externalTeamId === 'lin-team-eng')).toBe(true);
      // Both projects intersect lin-team-eng (one is shared with lin-team-ops), so both stay.
      expect(snapshot.projects.map((p) => p.externalId).sort()).toEqual(
        ['lin-project-active', 'lin-project-done'].sort(),
      );

      // Users/labels are never filtered by team.
      expect(snapshot.users).toEqual(LINEAR_WORK_GRAPH.users);
      expect(snapshot.labels).toEqual(LINEAR_WORK_GRAPH.labels);
    });

    it('a team scope with no shared project excludes it, keeping only intersecting projects', async () => {
      const graph = linearWorkGraph();
      const snapshot = await graph.pullWorkGraph({ externalTeamIds: ['lin-team-ops'] });

      expect(snapshot.items.every((item) => item.externalTeamId === 'lin-team-ops')).toBe(true);
      expect(snapshot.cycles.map((c) => c.externalId)).toEqual(['lin-cycle-done']);
      // lin-project-done is eng-only, so it drops out; lin-project-active is shared, so it stays.
      expect(snapshot.projects.map((p) => p.externalId)).toEqual(['lin-project-active']);
    });

    it('filters items only by updatedAfter (strictly greater than), leaving cycles/projects untouched', async () => {
      const graph = linearWorkGraph();
      // Between lin-issue-4 (2026-01-10) and lin-issue-5 (2026-01-15): excludes issues at or
      // before the cutoff, keeps everything strictly after it.
      const cutoff = '2026-01-10T00:00:00.000Z';
      const snapshot = await graph.pullWorkGraph({ externalTeamIds: [], updatedAfter: cutoff });

      expect(snapshot.items.map((i) => i.externalId)).toEqual([
        'lin-issue-5',
        'lin-issue-6',
        'lin-issue-7',
      ]);
      expect(snapshot.items.every((i) => i.updatedAt > cutoff)).toBe(true);
      // updatedAfter narrows items only.
      expect(snapshot.cycles).toEqual(LINEAR_WORK_GRAPH.cycles);
      expect(snapshot.projects).toEqual(LINEAR_WORK_GRAPH.projects);
    });

    it('composes team scope AND updatedAfter together', async () => {
      const graph = linearWorkGraph();
      const snapshot = await graph.pullWorkGraph({
        externalTeamIds: ['lin-team-eng'],
        updatedAfter: '2026-01-10T00:00:00.000Z',
      });
      expect(snapshot.items.map((i) => i.externalId)).toEqual(['lin-issue-7']);
    });
  });

  describe('listTeamStates', () => {
    it('returns the fixture states for a known team, ordered by position', async () => {
      const graph = linearWorkGraph();
      const states = await graph.listTeamStates('lin-team-eng');
      expect(states.map((s) => s.type)).toEqual([
        'backlog',
        'unstarted',
        'started',
        'completed',
        'canceled',
      ]);
      expect(states).toEqual([...states].sort((a, b) => a.position - b.position));
    });

    it('returns an empty array for an unknown team (no throw), matching the real client', async () => {
      const graph = linearWorkGraph();
      await expect(graph.listTeamStates('lin-team-nonexistent')).resolves.toEqual([]);
    });
  });

  describe('pushWorkItem', () => {
    it('logs ops in call order and returns advancing stamps', async () => {
      const mock = new MockConnector({ provider: 'linear' });
      const graph = mock.asWorkGraph()!;

      const first = await graph.pushWorkItem({
        kind: 'update',
        externalId: 'lin-issue-1',
        fields: { title: 'Renamed' },
      });
      const second = await graph.pushWorkItem({
        kind: 'update',
        externalId: 'lin-issue-2',
        fields: { priority: 'urgent' },
      });

      expect(mock.workItemPushLog).toEqual([
        { kind: 'update', externalId: 'lin-issue-1', fields: { title: 'Renamed' } },
        { kind: 'update', externalId: 'lin-issue-2', fields: { priority: 'urgent' } },
      ]);
      expect(new Date(second.externalUpdatedAt).getTime()).toBeGreaterThan(
        new Date(first.externalUpdatedAt).getTime(),
      );
    });

    it('echoes the externalId back on update, and assigns a fresh deterministic id on create', async () => {
      const mock = new MockConnector({ provider: 'linear' });
      const graph = mock.asWorkGraph()!;

      const updated = await graph.pushWorkItem({
        kind: 'update',
        externalId: 'lin-issue-1',
        fields: { title: 'x' },
      });
      expect(updated.externalId).toBe('lin-issue-1');

      const created = await graph.pushWorkItem({
        kind: 'create',
        externalTeamId: 'lin-team-eng',
        fields: { title: 'New issue' },
      });
      expect(created.externalId).toMatch(/^lin-issue-created_/);
    });
  });

  describe('fixture integrity (pins the contract downstream tasks rely on)', () => {
    it('carries a matched user (with email) and an unmatched user (without one)', () => {
      const withEmail = LINEAR_WORK_GRAPH.users.filter((u) => u.email !== undefined);
      const withoutEmail = LINEAR_WORK_GRAPH.users.filter((u) => u.email === undefined);
      expect(withEmail).toHaveLength(1);
      expect(withoutEmail).toHaveLength(1);
      expect(withEmail[0]?.email).toBe('member@example.com');
    });

    it('carries two workspace-level labels and one team-scoped label', () => {
      const teamScoped = LINEAR_WORK_GRAPH.labels.filter((l) => l.externalTeamId !== undefined);
      const workspaceLevel = LINEAR_WORK_GRAPH.labels.filter((l) => l.externalTeamId === undefined);
      expect(teamScoped).toHaveLength(1);
      expect(workspaceLevel).toHaveLength(2);
    });

    it('exercises all five ExternalPriority values across the issue set', () => {
      const priorities = new Set(LINEAR_WORK_GRAPH.items.map((i) => i.priority));
      const expected: readonly ExternalPriority[] = ['none', 'urgent', 'high', 'medium', 'low'];
      expect([...priorities].sort()).toEqual([...expected].sort());
    });

    it('has at least one tombstoned item', () => {
      expect(LINEAR_WORK_GRAPH.items.some((i) => i.removed === true)).toBe(true);
    });

    it('has exactly one parent/child pair', () => {
      const children = LINEAR_WORK_GRAPH.items.filter((i) => i.parentExternalId !== undefined);
      expect(children).toHaveLength(1);
      const [child] = children;
      expect(LINEAR_WORK_GRAPH.items.some((i) => i.externalId === child?.parentExternalId)).toBe(
        true,
      );
    });

    it('has at least one item carrying both an estimate and a due date', () => {
      expect(
        LINEAR_WORK_GRAPH.items.some((i) => i.estimate !== undefined && i.dueDate !== undefined),
      ).toBe(true);
    });

    it('has at least one canceled item with canceledAt set', () => {
      expect(
        LINEAR_WORK_GRAPH.items.some(
          (i) => i.stateType === 'canceled' && i.canceledAt !== undefined,
        ),
      ).toBe(true);
    });

    it('has at least one item assigned to the matched user and at least one unassigned item', () => {
      expect(LINEAR_WORK_GRAPH.items.some((i) => i.assigneeExternalId === 'lin-user-member')).toBe(
        true,
      );
      expect(LINEAR_WORK_GRAPH.items.some((i) => i.assigneeExternalId === undefined)).toBe(true);
    });

    it('has at least one item linking both a project and a cycle', () => {
      expect(
        LINEAR_WORK_GRAPH.items.some(
          (i) => i.projectExternalId !== undefined && i.cycleExternalId !== undefined,
        ),
      ).toBe(true);
    });
  });
});
