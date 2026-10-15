import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  openCreate: vi.fn(),
  session: { data: null as { user: { id: string } } | null },
}));

vi.mock('../../src/lib/auth-client', () => ({ useSession: () => mocks.session }));
vi.mock('../../src/lib/app-location', () => ({
  useTypedRoute: () => ({ params: { orgId: 'workspace' } }),
}));
vi.mock('../../src/components/create-object/create-object-provider', () => ({
  useCreateObject: () => ({ openCreate: mocks.openCreate }),
}));
vi.mock('../../src/components/statuses/status-registry', () => ({
  useStatusRegistry: () => ({ statusOf: () => ({ name: 'Backlog' }) }),
}));
vi.mock('../../src/components/entity-display/use-work-status', () => ({
  useCategoryOf: () => () => 'backlog',
}));
vi.mock('../../src/components/my-work/agent-task-row', () => ({ AgentTaskRow: () => null }));
vi.mock('../../src/components/in-page-search/in-page-search-provider', () => ({
  useInPageSearchTarget: () => ({ openSearch: vi.fn(), restoreFocus: vi.fn() }),
}));
vi.mock('../../src/components/in-page-search/use-resident-in-page-search', () => ({
  useResidentInPageSearch: () => ({
    draft: '',
    settledQuery: '',
    items: [],
    setDraft: vi.fn(),
  }),
}));
vi.mock('../../src/lib/use-my-work', () => ({
  useMyWork: () => ({
    setTasks: vi.fn(),
    loading: false,
    loadError: null,
    myActorId: 'caller',
    counts: { mine: 0, delegated: 0 },
    pendingApprovals: 0,
    visibleTasks: () => [],
    actorName: () => 'Caller',
    toRow: vi.fn(),
    groupBy: vi.fn(),
    subGroupBy: vi.fn(),
    canEdit: true,
    rename: vi.fn(),
  }),
}));

import MyWorkClient from '../../src/app/(app)/orgs/[orgId]/my-work/my-work-client';

beforeEach(() => {
  mocks.openCreate.mockClear();
  mocks.session.data = null;
});
afterEach(cleanup);

it('does not offer an inert server-rendered create action before the client session resolves', () => {
  const server = document.createElement('div');
  server.innerHTML = renderToString(<MyWorkClient />);
  const buttons = within(server).getAllByRole('button', { name: 'New task' });
  expect(buttons).toHaveLength(2);
  for (const button of buttons) expect(button).toBeDisabled();
});

it('enables both task entry points for the resolved caller and opens the actual destination', () => {
  const { rerender } = render(<MyWorkClient />);
  const buttons = screen.getAllByRole('button', { name: 'New task' });
  for (const button of buttons) {
    expect(button).toBeDisabled();
    fireEvent.click(button);
  }
  expect(mocks.openCreate).not.toHaveBeenCalled();

  mocks.session.data = { user: { id: 'user' } };
  rerender(<MyWorkClient />);
  for (const button of buttons) expect(button).toBeEnabled();
  const emptyAction = buttons[1];
  if (!emptyAction) throw new Error('The empty-state create action must remain available.');
  fireEvent.click(emptyAction);
  expect(mocks.openCreate).toHaveBeenCalledOnce();
  expect(mocks.openCreate).toHaveBeenCalledWith(
    expect.objectContaining({
      kind: 'task',
      initialWorkspaceId: 'workspace',
      defaultAssigneeId: 'caller',
      sameWorkspaceCompletion: 'stay',
    }),
  );
});
