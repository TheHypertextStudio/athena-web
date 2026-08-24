/** `@docket/web` — mounted pane-menu command and read-only semantics. */
import '@testing-library/jest-dom/vitest';

import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  removeDependency: vi.fn(),
  commands: {
    canEdit: false,
    canUndo: false,
    canRedo: false,
    pending: false,
    undoLabel: null as string | null,
    redoLabel: null as string | null,
    objectKind: 'project' as const,
    createObject: vi.fn(),
    openObject: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
  },
}));

vi.mock('@docket/ui/primitives', () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div role="menu">{children}</div>,
  DropdownMenuItem: ({
    children,
    disabled,
    onSelect,
  }: {
    children: ReactNode;
    disabled?: boolean;
    onSelect?: () => void;
  }) => (
    <button type="button" role="menuitem" disabled={disabled} onClick={onSelect}>
      {children}
    </button>
  ),
  DropdownMenuLabel: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  DropdownMenuSeparator: () => <hr />,
}));

vi.mock('@xyflow/react', () => ({
  useReactFlow: () => ({
    fitView: vi.fn(),
    getNode: (id: string) => {
      if (id === 'project-a') return { id, data: { name: 'Project Alpha' } };
      if (id === 'project-b') return { id, data: { name: 'Project Bravo' } };
      if (id === 'task-a') return { id, data: { title: 'Task Alpha' } };
      return { id, data: { title: 'Task Bravo' } };
    },
    getNodes: () => [],
  }),
}));

vi.mock('@/components/canvas/canvas-actions-context', () => ({ useCanvasActions: () => null }));
vi.mock('@/components/canvas/canvas-command-context', () => ({
  useCanvasCommandContext: () => state.commands,
}));

import { useCanvasMenus } from '@/components/canvas/canvas-menus';

function Harness(): React.JSX.Element {
  const menus = useCanvasMenus({
    onSelectArea: vi.fn(),
    onRelayout: vi.fn(),
    onRemoveDependency: state.removeDependency,
  });
  return (
    <>
      <button
        type="button"
        onClick={() => {
          menus.onEdgeContextMenu(
            {
              preventDefault: vi.fn(),
              clientX: 10,
              clientY: 10,
            } as unknown as React.MouseEvent,
            {
              id: 'project-a->project-b',
              source: 'project-a',
              target: 'project-b',
              data: { kind: 'dependency' },
            },
          );
        }}
      >
        Open Project edge menu
      </button>
      <button
        type="button"
        onClick={() => {
          menus.onEdgeContextMenu(
            {
              preventDefault: vi.fn(),
              clientX: 10,
              clientY: 10,
            } as unknown as React.MouseEvent,
            {
              id: 'task-a->task-b',
              source: 'task-a',
              target: 'task-b',
              data: { kind: 'dependency' },
            },
          );
        }}
      >
        Open Task edge menu
      </button>
      <div data-canvas-selection-frame="">
        <button
          type="button"
          onContextMenu={menus.onPaneContextMenu}
          onClick={() => {
            menus.onPaneContextMenu({
              preventDefault: vi.fn(),
              clientX: 10,
              clientY: 10,
            } as unknown as React.MouseEvent);
          }}
        >
          Open pane menu
        </button>
      </div>
      <button
        type="button"
        onClick={() => {
          menus.onNodeContextMenu(
            {
              preventDefault: vi.fn(),
              stopPropagation: vi.fn(),
              clientX: 10,
              clientY: 10,
            } as unknown as React.MouseEvent,
            {
              id: 'project-b',
              type: 'project',
              selected: true,
              position: { x: 0, y: 0 },
              data: { name: 'Project B' },
            },
          );
        }}
      >
        Open node menu
      </button>
      {menus.menu}
    </>
  );
}

describe('canvas pane menu', () => {
  it('keeps viewport and selection tools available while mutations stay disabled or absent', () => {
    render(<Harness />);
    act(() => {
      screen.getByRole('button', { name: 'Open pane menu' }).click();
    });

    expect(screen.queryByRole('menuitem', { name: 'New Project' })).toBeNull();
    expect(screen.getByRole('menuitem', { name: 'Select area' })).toBeEnabled();
    expect(screen.getByRole('menuitem', { name: 'Undo' })).toBeDisabled();
    expect(screen.getByRole('menuitem', { name: 'Redo' })).toBeDisabled();
    expect(screen.getByRole('menuitem', { name: 'Fit selection' })).toBeDisabled();
    expect(screen.getByRole('menuitem', { name: 'Fit all' })).toBeEnabled();
    expect(screen.getByRole('menuitem', { name: 'Re-layout' })).toBeEnabled();
  });

  it('opens the right-clicked node instead of the last object in a preserved multi-selection', () => {
    state.commands.openObject.mockReset();
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Open node menu' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Open or peek' }));

    expect(state.commands.openObject).toHaveBeenCalledWith('project-b');
  });

  it('passes the invoking canvas to creation for focus return', () => {
    state.commands.canEdit = true;
    state.commands.createObject.mockReset();
    render(<Harness />);
    const launcher = screen.getByRole('button', { name: 'Open pane menu' });

    fireEvent.contextMenu(launcher, { clientX: 10, clientY: 10 });
    fireEvent.click(screen.getByRole('menuitem', { name: 'New Project' }));

    expect(state.commands.createObject).toHaveBeenCalledWith(
      launcher.closest('[data-canvas-selection-frame]'),
    );
    state.commands.canEdit = false;
  });

  it('labels and removes a Project dependency through the accessible edge menu', () => {
    state.commands.canEdit = true;
    state.removeDependency.mockReset();
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Open Project edge menu' }));

    expect(screen.getByText('Project Alpha → Project Bravo')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove dependency' }));
    expect(state.removeDependency).toHaveBeenCalledWith('project-a', 'project-b');
    state.commands.canEdit = false;
  });

  it('offers Task dependency removal without a non-atomic reverse action', () => {
    state.commands.canEdit = true;
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Open Task edge menu' }));

    expect(screen.getByText('Task Alpha → Task Bravo')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Remove dependency' })).toBeEnabled();
    expect(screen.queryByRole('menuitem', { name: 'Reverse direction' })).toBeNull();
    state.commands.canEdit = false;
  });
});
