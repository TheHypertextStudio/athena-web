/** `@docket/web` — canvas-owned selection overflow commands. */
import '@testing-library/jest-dom/vitest';

import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  globalOpen: vi.fn(),
  undo: vi.fn(),
  redo: vi.fn(),
  setComplete: vi.fn(),
  commands: {
    selectedObjects: [
      { kind: 'task' as const, id: 'task-a', title: 'Task Alpha', organizationId: 'org-1' },
    ],
    objectKind: 'task' as const,
    canEdit: true,
    canTrash: true,
    canUndo: true,
    canRedo: true,
    undoLabel: 'Move Task branch',
    redoLabel: 'Change status',
    pending: false,
    openSelection: vi.fn(),
    openProperties: vi.fn(),
    trashSelection: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
  },
}));

vi.mock('@xyflow/react', () => ({
  Panel: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/canvas/canvas-command-context', () => ({
  useCanvasCommandContext: () => ({
    ...state.commands,
    undo: state.undo,
    redo: state.redo,
  }),
}));
vi.mock('@/components/canvas/canvas-actions-context', () => ({
  useCanvasActions: () => ({ setComplete: state.setComplete }),
}));
vi.mock('@/components/context-menu', () => ({
  useObjectContextMenu: () => ({ openFor: state.globalOpen }),
}));

import BulkActionsBar from '@/components/canvas/bulk-actions-bar';

describe('canvas selection overflow', () => {
  beforeEach(() => {
    state.commands.canEdit = true;
    state.commands.canUndo = true;
    state.commands.canRedo = true;
    state.commands.pending = false;
    state.undo.mockReset();
    state.redo.mockReset();
  });

  it('keeps global Task mutations unreachable and exposes canvas history instead', async () => {
    render(<BulkActionsBar />);

    fireEvent.pointerDown(screen.getByRole('button', { name: 'More selection actions' }));

    expect(state.globalOpen).not.toHaveBeenCalled();
    expect(await screen.findByRole('menuitem', { name: 'Undo Move Task branch' })).toBeEnabled();
    expect(screen.getByRole('menuitem', { name: 'Redo Change status' })).toBeEnabled();
    expect(screen.queryByRole('menuitem', { name: 'Make subtask of…' })).toBeNull();

    fireEvent.click(screen.getByRole('menuitem', { name: 'Undo Move Task branch' }));
    expect(state.undo).toHaveBeenCalledOnce();
    expect(state.setComplete).not.toHaveBeenCalled();
  });

  it('keeps server-approved history available when selection editing is read-only', async () => {
    state.commands.canEdit = false;
    render(<BulkActionsBar />);

    fireEvent.pointerDown(screen.getByRole('button', { name: 'More selection actions' }));

    fireEvent.click(await screen.findByRole('menuitem', { name: 'Undo Move Task branch' }));
    expect(state.undo).toHaveBeenCalledOnce();

    fireEvent.pointerDown(screen.getByRole('button', { name: 'More selection actions' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Redo Change status' }));
    expect(state.redo).toHaveBeenCalledOnce();
  });
});
