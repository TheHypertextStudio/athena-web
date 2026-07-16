import '@testing-library/jest-dom/vitest';

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const openAthena = vi.fn();
vi.mock('../../src/components/athena/athena-panel-provider', () => ({
  useAthenaPanel: () => ({ openAthena }),
}));

import { AthenaContextAction } from '../../src/components/athena/athena-context-action';

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
});
