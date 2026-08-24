import '@testing-library/jest-dom/vitest';

import { fireEvent, render, screen } from '@testing-library/react';
import { type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

const { history } = vi.hoisted(() => ({
  history: {
    execute: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    canUndo: true,
    canRedo: true,
    undoLabel: 'Move Project to trash',
    redoLabel: 'Change status',
    pending: false,
    notice: null,
    clearNotice: vi.fn(),
  },
}));

vi.mock('../../../src/components/canvas/use-canvas-command-history', () => ({
  canvasCommandId: () => 'command-id',
  useCanvasCommandHistory: () => history,
}));

vi.mock('../../../src/components/confirm-destructive-dialog', () => ({
  ConfirmDestructiveDialog: () => null,
}));

import {
  CanvasCommandProvider,
  useCanvasCommandContext,
} from '../../../src/components/canvas/canvas-command-context';
import { SelectionProvider } from '../../../src/components/selection';

function ReadOnlySurface(): React.JSX.Element {
  const commands = useCanvasCommandContext();
  return (
    <button type="button" onKeyDown={commands?.onCanvasKeyDown}>
      {commands?.canUndo ? 'Undo enabled' : 'Undo disabled'} /{' '}
      {commands?.canRedo ? 'Redo enabled' : 'Redo disabled'}
    </button>
  );
}

function Wrapper({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <SelectionProvider items={[]} organizationId="org-1" surfaceId="read-only-canvas">
      <CanvasCommandProvider
        orgId="org-1"
        scopeKey="projects"
        objectKind="project"
        canEdit={false}
        invalidateKeys={[]}
        onCreateObject={vi.fn()}
        onOpenObject={vi.fn()}
      >
        {children}
      </CanvasCommandProvider>
    </SelectionProvider>
  );
}

describe('read-only canvas command history', () => {
  it('disables and ignores undo and redo even when session history is populated', () => {
    render(<ReadOnlySurface />, { wrapper: Wrapper });
    const surface = screen.getByRole('button');

    expect(surface).toHaveTextContent('Undo disabled / Redo disabled');
    fireEvent.keyDown(surface, { key: 'z', ctrlKey: true });
    fireEvent.keyDown(surface, { key: 'z', ctrlKey: true, shiftKey: true });
    fireEvent.keyDown(surface, { key: 'y', ctrlKey: true });

    expect(history.undo).not.toHaveBeenCalled();
    expect(history.redo).not.toHaveBeenCalled();
  });
});
