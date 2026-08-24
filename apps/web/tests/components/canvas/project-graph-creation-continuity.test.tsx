import '@testing-library/jest-dom/vitest';

import type { ProjectOverviewItem } from '@docket/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@xyflow/react', () => ({
  Panel: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('../../../src/components/canvas/canvas', () => ({
  default: ({ children }: { children: ReactNode }) => <div data-testid="canvas">{children}</div>,
}));

vi.mock('../../../src/components/canvas/project-graph-layout', () => ({
  useProjectGraphLayout: (nodes: readonly unknown[]) => ({ nodes }),
}));

vi.mock('../../../src/components/canvas/project-node', () => ({
  default: () => null,
}));

vi.mock('../../../src/components/canvas/project-peek', () => ({
  default: ({ project }: { project: ProjectOverviewItem }) => (
    <aside aria-label="Project details">{project.name}</aside>
  ),
}));

vi.mock('../../../src/components/canvas/use-canvas-aspect-ratio', () => ({
  useCanvasAspectRatio: () => ({ containerRef: { current: null }, aspectRatio: 1, ready: true }),
}));

vi.mock('../../../src/lib/query', () => ({
  apiQueryOptions: () => ({}),
  queryKeys: {
    projects: (orgId: string) => ['orgs', orgId, 'projects'],
    members: (orgId: string) => ['orgs', orgId, 'members'],
    roles: (orgId: string) => ['orgs', orgId, 'roles'],
  },
  unwrap: vi.fn(),
  useApiListQuery: () => ({ data: { items: [] } }),
  useApiMutation: () => ({ error: null, mutate: vi.fn(), reset: vi.fn() }),
}));

vi.mock('../../../src/lib/use-org-capability', () => ({
  useOrgCapability: () => true,
}));

import { ProjectGraphPanel } from '../../../src/components/canvas/project-graph-panel';

const EXISTING_ID = '01K3CQWKHQ3GXESM7K1YS55P9A';
const CREATED_ID = '01K3CQWKHQ3GXESM7K1YS55P9B';

function project(id: string, name: string): ProjectOverviewItem {
  return {
    id,
    name,
    summary: null,
    status: 'planned',
    health: null,
    leadId: null,
    startDate: null,
    targetDate: null,
    taskCount: 0,
    completedTaskCount: 0,
    blockedByIds: [],
    blocksIds: [],
  } as unknown as ProjectOverviewItem;
}

describe('Project graph creation continuity', () => {
  it('selects a requested Project only after refreshed rows contain it', () => {
    const onRequestedSelectionResolved = vi.fn();
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const renderPanel = (rows: readonly ProjectOverviewItem[]) => (
      <QueryClientProvider client={client}>
        <ProjectGraphPanel
          rows={rows}
          orgId="org_1"
          requestedSelectionId={CREATED_ID}
          onRequestedSelectionResolved={onRequestedSelectionResolved}
        />
      </QueryClientProvider>
    );
    const rendered = render(renderPanel([project(EXISTING_ID, 'Existing Project')]));

    expect(screen.queryByRole('complementary', { name: 'Project details' })).toBeNull();
    expect(onRequestedSelectionResolved).not.toHaveBeenCalled();

    rendered.rerender(
      renderPanel([
        project(EXISTING_ID, 'Existing Project'),
        project(CREATED_ID, 'Created Project'),
      ]),
    );

    expect(screen.getByRole('complementary', { name: 'Project details' })).toHaveTextContent(
      'Created Project',
    );
    expect(onRequestedSelectionResolved).toHaveBeenCalledWith(CREATED_ID);
  });

  it('reports a requested Project that a settled refresh still excludes', () => {
    const onRequestedSelectionMissing = vi.fn();
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const renderPanel = (requestedSelectionSettled: boolean) => (
      <QueryClientProvider client={client}>
        <ProjectGraphPanel
          rows={[project(EXISTING_ID, 'Existing Project')]}
          orgId="org_1"
          requestedSelectionId={CREATED_ID}
          requestedSelectionSettled={requestedSelectionSettled}
          onRequestedSelectionMissing={onRequestedSelectionMissing}
        />
      </QueryClientProvider>
    );
    const rendered = render(renderPanel(false));

    expect(onRequestedSelectionMissing).not.toHaveBeenCalled();

    rendered.rerender(renderPanel(true));

    expect(onRequestedSelectionMissing).toHaveBeenCalledWith(CREATED_ID);
  });
});
