import '@testing-library/jest-dom/vitest';

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  search: new URLSearchParams(),
  workspace: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => mocks.search,
}));

vi.mock('../../src/components/athena/athena-workspace', () => ({
  AthenaWorkspace: (props: unknown) => {
    mocks.workspace(props);
    return <div>Athena workspace</div>;
  },
}));

import AthenaPage from '../../src/app/(app)/athena/page';

describe('AthenaPage', () => {
  beforeEach(() => {
    mocks.search = new URLSearchParams();
    mocks.workspace.mockClear();
  });

  it('parses an explicit new-work marker independently from workspace context', () => {
    mocks.search = new URLSearchParams('workspace=workspace_1&new=1');

    render(<AthenaPage />);

    expect(screen.getByText('Athena workspace')).toBeVisible();
    expect(mocks.workspace).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceFilter: 'workspace_1',
        invocationContext: { workspaceId: 'workspace_1' },
        startNewWork: true,
      }),
    );
  });
});
