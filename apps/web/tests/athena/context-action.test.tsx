import '@testing-library/jest-dom/vitest';

import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@docket/ui/primitives';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const openAthena = vi.fn();
vi.mock('../../src/components/athena/athena-panel-provider', () => ({
  useAthenaPanel: () => ({ openAthena }),
}));

import {
  AthenaContextAction,
  AthenaContextMenuItem,
} from '../../src/components/athena/athena-context-action';

beforeEach(() => {
  openAthena.mockReset();
});

describe('AthenaContextAction', () => {
  it('opens personal Athena with the exact workspace and source object', () => {
    render(
      <AthenaContextAction
        label="Have Athena review this project"
        context={{
          workspaceId: 'workspace_1',
          source: { type: 'project', id: 'project_1', label: 'Athena launch' },
        }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Have Athena review this project' }));

    expect(openAthena).toHaveBeenCalledWith({
      workspaceId: 'workspace_1',
      source: { type: 'project', id: 'project_1', label: 'Athena launch' },
    });
  });

  it('opens personal Athena with the same task context from an overflow menu item', async () => {
    const context = {
      workspaceId: 'workspace_1',
      source: { type: 'task' as const, id: 'task_1', label: 'Ship it' },
    };
    render(
      <DropdownMenu defaultOpen>
        <DropdownMenuTrigger>Task actions</DropdownMenuTrigger>
        <DropdownMenuContent>
          <AthenaContextMenuItem label="Have Athena handle this" context={context} />
        </DropdownMenuContent>
      </DropdownMenu>,
    );

    fireEvent.click(await screen.findByRole('menuitem', { name: 'Have Athena handle this' }));

    expect(openAthena).toHaveBeenCalledWith(context);
  });
});
