import '@testing-library/jest-dom/vitest';

import { fireEvent, render, screen } from '@testing-library/react';
import { type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
  CanvasCommandProviderWithHistory,
  useCanvasCommandContext,
} from '../../../src/components/canvas/canvas-command-context';
import type { CanvasCommandHistoryControls } from '../../../src/components/canvas/use-canvas-command-history';
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

function PermissionSurface(): React.JSX.Element {
  const commands = useCanvasCommandContext();
  return (
    <>
      <output aria-label="History availability">
        {commands?.canUndo ? 'Undo enabled' : 'Undo disabled'} /{' '}
        {commands?.canRedo ? 'Redo enabled' : 'Redo disabled'}
      </output>
      <button
        type="button"
        onClick={() => {
          void commands?.undo();
        }}
      >
        Run Undo
      </button>
      <button
        type="button"
        onClick={() => {
          void commands?.redo();
        }}
      >
        Run Redo
      </button>
      <button type="button" onKeyDown={commands?.onCanvasKeyDown}>
        Keyboard surface
      </button>
    </>
  );
}

function PermissionWrapper({
  objectKind,
  historyControls,
}: {
  readonly objectKind: 'task' | 'project';
  readonly historyControls: CanvasCommandHistoryControls;
}): React.JSX.Element {
  return (
    <SelectionProvider
      items={[]}
      organizationId="org-1"
      surfaceId="permission-canvas"
      actionScope="all"
    >
      <CanvasCommandProviderWithHistory
        objectKind={objectKind}
        canEdit={false}
        history={historyControls}
        onCreateObject={vi.fn()}
        onOpenObject={vi.fn()}
      >
        <PermissionSurface />
      </CanvasCommandProviderWithHistory>
    </SelectionProvider>
  );
}

function Wrapper({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <SelectionProvider
      items={[]}
      organizationId="org-1"
      surfaceId="read-only-canvas"
      actionScope="all"
    >
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
  beforeEach(() => {
    history.undo.mockReset();
    history.redo.mockReset();
    history.canUndo = true;
    history.canRedo = true;
  });

  it('disables and ignores undo and redo even when session history is populated', () => {
    history.canUndo = false;
    history.canRedo = false;
    render(<ReadOnlySurface />, { wrapper: Wrapper });
    const surface = screen.getByRole('button');

    expect(surface).toHaveTextContent('Undo disabled / Redo disabled');
    fireEvent.keyDown(surface, { key: 'z', ctrlKey: true });
    fireEvent.keyDown(surface, { key: 'z', ctrlKey: true, shiftKey: true });
    fireEvent.keyDown(surface, { key: 'y', ctrlKey: true });

    expect(history.undo).not.toHaveBeenCalled();
    expect(history.redo).not.toHaveBeenCalled();
  });

  it.each(['task', 'project'] as const)(
    'disables and ignores %s replay while server access is unavailable',
    (objectKind) => {
      const undo = vi.fn();
      const redo = vi.fn();
      const historyControls = {
        ...history,
        undo,
        redo,
        canUndo: false,
        canRedo: false,
      };
      render(<PermissionWrapper objectKind={objectKind} historyControls={historyControls} />);

      expect(screen.getByLabelText('History availability')).toHaveTextContent(
        'Undo disabled / Redo disabled',
      );
      fireEvent.click(screen.getByRole('button', { name: 'Run Undo' }));
      fireEvent.click(screen.getByRole('button', { name: 'Run Redo' }));
      const keyboardSurface = screen.getByRole('button', { name: 'Keyboard surface' });
      fireEvent.keyDown(keyboardSurface, { key: 'z', ctrlKey: true });
      fireEvent.keyDown(keyboardSurface, { key: 'z', ctrlKey: true, shiftKey: true });

      expect(undo).not.toHaveBeenCalled();
      expect(redo).not.toHaveBeenCalled();
    },
  );

  it.each(['task', 'project'] as const)(
    'allows server-approved %s replay even when broad editing is disabled',
    (objectKind) => {
      const undo = vi.fn();
      const redo = vi.fn();
      const historyControls = {
        ...history,
        undo,
        redo,
      };
      render(<PermissionWrapper objectKind={objectKind} historyControls={historyControls} />);

      expect(screen.getByLabelText('History availability')).toHaveTextContent(
        'Undo enabled / Redo enabled',
      );
      fireEvent.click(screen.getByRole('button', { name: 'Run Undo' }));
      fireEvent.click(screen.getByRole('button', { name: 'Run Redo' }));
      const keyboardSurface = screen.getByRole('button', { name: 'Keyboard surface' });
      fireEvent.keyDown(keyboardSurface, { key: 'z', ctrlKey: true });
      fireEvent.keyDown(keyboardSurface, { key: 'z', ctrlKey: true, shiftKey: true });

      expect(undo).toHaveBeenCalledTimes(2);
      expect(redo).toHaveBeenCalledTimes(2);
    },
  );
});
