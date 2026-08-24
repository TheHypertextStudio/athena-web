/** `@docket/web` — retained canvas selection and shared Properties controller integration. */
import '@testing-library/jest-dom/vitest';

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Xyflow from '@xyflow/react';

import type { CanvasPropertySnapshot, ObjectRef } from '@/lib/actions';

vi.mock('@xyflow/react', async (importOriginal) => {
  const actual = await importOriginal<typeof Xyflow>();
  return {
    ...actual,
    Panel: ({ children }: { children: ReactNode }) => <>{children}</>,
    useReactFlow: () => ({
      fitView: vi.fn(),
      getNode: () => undefined,
      getNodes: () => [],
    }),
  };
});
vi.mock('@/components/canvas/canvas-actions-context', () => ({ useCanvasActions: () => null }));
vi.mock('@/components/pickers/use-composer-options', () => ({
  useComposerOptions: () => ({
    actorOptions: [],
    memberOptions: [],
    projectOptions: [],
    programOptions: [],
    initiativeOptions: [],
    labels: [],
    labelOptions: [],
    teams: [],
    teamOptions: [],
    cycles: [],
    milestones: [],
    loading: false,
  }),
}));
vi.mock('@/components/statuses/status-registry', () => ({
  useStatusRegistry: () => ({
    loaded: true,
    statusesFor: () => [
      { key: 'planned', name: 'Planned', category: 'backlog', description: null },
      { key: 'active', name: 'Active', category: 'started', description: null },
    ],
  }),
}));
vi.mock('@/lib/use-estimation-scale', () => ({
  useEstimationScale: () => ({ scale: 'none', loading: false }),
}));
vi.mock('@/lib/use-fiscal-year-start-month', () => ({
  useFiscalYearStartMonth: () => ({ fiscalYearStartMonth: 0, loading: false, error: null }),
}));

import BulkActionsBar from '@/components/canvas/bulk-actions-bar';
import {
  CanvasCommandProviderWithHistory,
  useCanvasCommandContext,
} from '@/components/canvas/canvas-command-context';
import { useCanvasMenus } from '@/components/canvas/canvas-menus';
import {
  CanvasSelectionRetentionProvider,
  useCanvasPropertySnapshots,
} from '@/components/canvas/canvas-selection-retention';
import { useSelection } from '@/components/selection';
import { objectKey } from '@/lib/actions';

const projectRef: ObjectRef = {
  kind: 'project',
  id: 'project-1',
  title: 'Apollo',
  organizationId: 'org-1',
};
const projectSnapshot: Extract<CanvasPropertySnapshot, { kind: 'project' }> = {
  kind: 'project',
  id: 'project-1',
  organizationId: 'org-1',
  status: 'planned',
  health: null,
  priority: 'medium',
  leadId: null,
  teamId: null,
  programId: null,
  labelIds: [],
  initiativeIds: [],
  startTimeframe: null,
  targetTimeframe: null,
};

const execute = vi.fn();
const history = {
  execute,
  undo: vi.fn(),
  redo: vi.fn(),
  canUndo: false,
  canRedo: false,
  undoLabel: null,
  redoLabel: null,
  pending: false,
  notice: null,
  clearNotice: vi.fn(),
};

function Controls(): React.JSX.Element {
  const selection = useSelection();
  const snapshots = useCanvasPropertySnapshots();
  return (
    <>
      <button
        type="button"
        onClick={() => {
          selection.dispatch({ type: 'replace', key: objectKey(projectRef) });
        }}
      >
        Select Project
      </button>
      <button type="button" onClick={selection.clear}>
        Clear selection
      </button>
      <div role="grid" aria-label="Project canvas" {...selection.containerProps} />
      <output aria-label="Retained snapshots">{snapshots.map(({ id }) => id).join(',')}</output>
      <BulkActionsBar />
    </>
  );
}

function MenuControls(): React.JSX.Element {
  const selection = useSelection();
  const commands = useCanvasCommandContext();
  const menus = useCanvasMenus({ onSelectArea: vi.fn(), onRelayout: vi.fn() });
  return (
    <>
      <button
        type="button"
        onClick={() => {
          selection.dispatch({ type: 'replace', key: objectKey(projectRef) });
        }}
      >
        Select Project
      </button>
      <button
        type="button"
        onContextMenu={(event) => {
          menus.onNodeContextMenu(event, {
            id: projectRef.id,
            type: 'project',
            selected: true,
            position: { x: 0, y: 0 },
            data: { name: projectRef.title },
          });
        }}
      >
        Project node
      </button>
      <output aria-label="Properties state">{commands?.propertiesOpen ? 'open' : 'closed'}</output>
      {menus.menu}
      <BulkActionsBar />
    </>
  );
}

function Harness({
  scopeKey,
  items,
  snapshots,
  menu = false,
}: {
  readonly scopeKey: string;
  readonly items: readonly ObjectRef[];
  readonly snapshots: readonly CanvasPropertySnapshot[];
  readonly menu?: boolean;
}): React.JSX.Element {
  return (
    <CanvasSelectionRetentionProvider
      scopeKey={scopeKey}
      items={items}
      propertySnapshots={snapshots}
      surfaceId="project-canvas"
      organizationId="org-1"
    >
      <CanvasCommandProviderWithHistory
        objectKind="project"
        canEdit
        history={history}
        onCreateObject={vi.fn()}
        onOpenObject={vi.fn()}
      >
        {menu ? <MenuControls /> : <Controls />}
      </CanvasCommandProviderWithHistory>
    </CanvasSelectionRetentionProvider>
  );
}

beforeEach(() => {
  execute.mockReset().mockResolvedValue({ appliedIds: ['project-1'] });
});

describe('canvas retained Properties integration', () => {
  it('retains selection and snapshots after a command removes the row, then releases on clear', async () => {
    const rendered = render(
      <Harness scopeKey="projects:all" items={[projectRef]} snapshots={[projectSnapshot]} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Select Project' }));
    fireEvent.click(screen.getByRole('button', { name: 'Properties' }));
    fireEvent.click(screen.getByRole('button', { name: /Status/ }));
    fireEvent.click(
      within(await screen.findByRole('option', { name: /Active/ })).getByRole('button'),
    );
    await waitFor(() => {
      expect(execute).toHaveBeenCalledOnce();
    });
    expect(execute.mock.calls[0]?.[0]).toMatchObject({
      objectIds: ['project-1'],
      operation: { type: 'replace_property', property: 'status', value: 'active' },
    });

    rendered.rerender(<Harness scopeKey="projects:all" items={[]} snapshots={[]} />);

    expect(screen.getByText('1 selected')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Properties' })).toBeInTheDocument();
    expect(screen.getByLabelText('Retained snapshots')).toHaveTextContent('project-1');
    fireEvent.click(screen.getByRole('button', { name: /Health/ }));
    fireEvent.click(
      within(await screen.findByRole('option', { name: /On track/ })).getByRole('button'),
    );
    await waitFor(() => {
      expect(execute).toHaveBeenCalledTimes(2);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
    await waitFor(() => {
      expect(screen.queryByText('1 selected')).toBeNull();
    });
    expect(screen.getByLabelText('Retained snapshots')).toBeEmptyDOMElement();
  });

  it('releases retained selection on Escape and scope identity change', async () => {
    const rendered = render(
      <Harness scopeKey="projects:all" items={[projectRef]} snapshots={[projectSnapshot]} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Select Project' }));
    rendered.rerender(<Harness scopeKey="projects:all" items={[]} snapshots={[]} />);
    fireEvent.keyDown(screen.getByRole('grid', { name: 'Project canvas' }), { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByText('1 selected')).toBeNull();
    });

    rendered.rerender(
      <Harness scopeKey="projects:all" items={[projectRef]} snapshots={[projectSnapshot]} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Select Project' }));
    rendered.rerender(<Harness scopeKey="projects:filtered" items={[]} snapshots={[]} />);
    await waitFor(() => {
      expect(screen.queryByText('1 selected')).toBeNull();
    });
  });

  it('opens the same focused editor from the production node context-menu command', async () => {
    render(
      <Harness scopeKey="projects:all" items={[projectRef]} snapshots={[projectSnapshot]} menu />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Select Project' }));
    const node = screen.getByRole('button', { name: 'Project node' });
    fireEvent.contextMenu(node);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Properties' }));

    expect(screen.getByLabelText('Properties state')).toHaveTextContent('open');
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Properties' })).toHaveFocus();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(node).toHaveFocus());
  });
});
