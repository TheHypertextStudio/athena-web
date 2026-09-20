import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EntityTable } from '@docket/ui/components';
import { TaskViewDefinition, TaskViewRow } from '@docket/work/work-view-contract';
import { buildWorkListColumns } from '@/components/work-views/work-list-columns';

vi.mock('@/components/people/source-person-control', () => ({
  SourcePersonControl: ({ source }: { source: { displayName: string } }) => (
    <button type="button">{source.displayName}</button>
  ),
}));
const orgId = '01ARZ3NDEKTSV4RRFFQ69G5FA0';
const taskId = '01ARZ3NDEKTSV4RRFFQ69G5FC0';
const definition = TaskViewDefinition.parse({
  version: 2,
  target: 'task',
  filter: null,
  arrangement: { groupBy: null, subGroupBy: null, orderBy: [] },
  presentation: {
    layout: 'list',
    properties: ['assignee'],
    density: 'compact',
    showEmptyGroups: false,
  },
});

describe('source people in the work roster', () => {
  it('shows every source assignee when there is no single native person', () => {
    const row = TaskViewRow.parse({
      target: 'task',
      organizationId: orgId,
      manualRank: 'a0',
      id: taskId,
      title: 'Imported work',
      status: 'todo',
      priority: 'none',
      assignee: null,
      delegate: null,
      team: orgId,
      project: null,
      program: null,
      cycle: null,
      milestone: null,
      parent: null,
      labels: [],
      creator: null,
      startDate: null,
      dueDate: null,
      createdAt: '2026-09-19T00:00:00Z',
      updatedAt: '2026-09-19T00:00:00Z',
      estimate: null,
      estimateMinutes: null,
      blocked: false,
      blocking: false,
      unfiled: true,
      archived: false,
      sourcePeople: ['Sam Rivera', 'Priya Raman'].map((displayName, index) => ({
        id: `ref-${index}`,
        externalActorId: `external-${index}`,
        integrationId: 'connection',
        provider: 'notion',
        externalId: `notion-${index}`,
        displayName,
        avatarUrl: null,
        actorId: index === 0 ? orgId : null,
        field: 'assignee',
      })),
    });
    const columns = buildWorkListColumns({
      target: 'task',
      definition,
      selectedIds: new Set(),
      selectionActive: false,
      isWritable: () => false,
      onToggleSelection: vi.fn(),
      statusOf: (key) => ({ key, name: 'To do', category: 'backlog' }),
      positions: new Map(),
      rowHeight: 44,
    });
    render(
      <EntityTable
        aria-label="Tasks"
        columns={columns}
        rows={[{ key: taskId, path: [], row }]}
        getRowKey={({ key }) => key}
        rowHref={({ row }) => `/orgs/${orgId}/tasks/${row.id}`}
        rowLinkColumnKey="__work-roster-inline-link"
      />,
    );
    expect(screen.getByRole('button', { name: 'Sam Rivera' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Priya Raman' })).toBeVisible();
  });
});
