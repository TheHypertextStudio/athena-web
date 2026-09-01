import type * as UiComponents from '@docket/ui/components';
import '@testing-library/jest-dom/vitest';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { type ReactNode, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

const execute = vi.hoisted(() => vi.fn());

vi.mock('../../../src/components/canvas/use-canvas-command-history', () => ({
  canvasCommandId: () => 'trash-command',
  useCanvasCommandHistory: () => {
    const [notice, setNotice] = useState<{
      title: string;
      detail: string;
      offerUndo: boolean;
      tone: 'error';
    } | null>(null);
    return {
      execute: async () => {
        execute();
        setNotice({
          title: 'Change failed',
          detail: 'Your selection was kept',
          offerUndo: false,
          tone: 'error',
        });
        return null;
      },
      undo: vi.fn(),
      redo: vi.fn(),
      canUndo: false,
      canRedo: false,
      undoLabel: null,
      redoLabel: null,
      pending: false,
      notice,
      clearNotice: vi.fn(),
    };
  },
}));

// The dialog moved into `@docket/ui`. Mocking the whole module would drop every other
// component these tests render, so the real module is spread and one export replaced.
vi.mock('@docket/ui/components', async (importOriginal) => ({
  ...(await importOriginal<typeof UiComponents>()),
  ConfirmDestructiveDialog: ({
    open,
    error,
    onConfirm,
  }: {
    open: boolean;
    error: string | null;
    onConfirm: () => void;
  }) =>
    open ? (
      <div role="dialog" aria-label="Confirm trash">
        {error ? <p role="alert">{error}</p> : null}
        <button type="button" onClick={onConfirm}>
          Confirm move to trash
        </button>
      </div>
    ) : null,
}));

import {
  CanvasCommandProvider,
  useCanvasCommandContext,
} from '../../../src/components/canvas/canvas-command-context';
import { SelectionProvider, useSelection } from '../../../src/components/selection';
import { objectKey, type ObjectRef } from '../../../src/lib/actions';

const project: ObjectRef = {
  kind: 'project',
  id: 'project-with-tasks',
  title: 'Project with Tasks',
  organizationId: 'org-1',
  meta: { taskCount: 3 },
};

function Controls(): React.JSX.Element {
  const selection = useSelection();
  const commands = useCanvasCommandContext();
  return (
    <>
      <button
        type="button"
        onClick={() => {
          selection.dispatch({ type: 'set', keys: [objectKey(project)] });
        }}
      >
        Select Project
      </button>
      <button type="button" onClick={commands?.trashSelection}>
        Move to trash
      </button>
    </>
  );
}

function Wrapper({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <SelectionProvider items={[project]} organizationId="org-1" actionScope="all">
      <CanvasCommandProvider
        orgId="org-1"
        scopeKey="project:retry"
        objectKind="project"
        canEdit
        invalidateKeys={[]}
        onCreateObject={vi.fn()}
        onOpenObject={vi.fn()}
      >
        {children}
      </CanvasCommandProvider>
    </SelectionProvider>
  );
}

function ContributorWrapper({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <SelectionProvider items={[project]} organizationId="org-1" actionScope="all">
      <CanvasCommandProvider
        orgId="org-1"
        scopeKey="project:contributor"
        objectKind="project"
        canEdit
        canTrash={false}
        invalidateKeys={[]}
        onCreateObject={vi.fn()}
        onOpenObject={vi.fn()}
      >
        {children}
      </CanvasCommandProvider>
    </SelectionProvider>
  );
}

describe('confirmed canvas trash retry', () => {
  it('keeps the dialog open with application-owned error copy after failure', async () => {
    render(<Controls />, { wrapper: Wrapper });
    fireEvent.click(screen.getByRole('button', { name: 'Select Project' }));
    fireEvent.click(screen.getByRole('button', { name: 'Move to trash' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm move to trash' }));

    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: 'Confirm trash' })).toBeInTheDocument();
      expect(screen.getByRole('alert')).toHaveTextContent('Your selection was kept');
    });
    expect(execute).toHaveBeenCalledOnce();
  });

  it('does not open Project trash confirmation for a contributor without manage', () => {
    render(<Controls />, { wrapper: ContributorWrapper });
    fireEvent.click(screen.getByRole('button', { name: 'Select Project' }));
    fireEvent.click(screen.getByRole('button', { name: 'Move to trash' }));

    expect(screen.queryByRole('dialog', { name: 'Confirm trash' })).toBeNull();
  });
});
