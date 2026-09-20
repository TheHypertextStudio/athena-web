import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceActorPicker } from '@/components/people/workspace-actor-picker';

const state = vi.hoisted(() => ({ create: vi.fn(), canContribute: true }));
vi.mock('@/components/active-org', () => ({
  useOptionalActiveOrg: () => ({ activeOrgId: 'workspace-one', orgName: () => 'Workshop' }),
}));
vi.mock('@/components/settings/use-can-manage-org', () => ({
  useCanManageOrg: () => ({ canContribute: state.canContribute }),
}));
vi.mock('@/components/people/people-queries', () => ({
  useAddPerson: () => ({ mutateAsync: state.create, isPending: false }),
}));

function openCreate() {
  fireEvent.click(screen.getByRole('button', { name: /Assignee/ }));
  fireEvent.change(screen.getByPlaceholderText('Search people…'), {
    target: { value: 'Sam Rivera' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Add “Sam Rivera”' }));
}

beforeEach(() => {
  state.canContribute = true;
  state.create.mockReset();
});
describe('workspace person creation', () => {
  it('creates a name-only person after confirmation and selects the result', async () => {
    state.create.mockResolvedValue({ actorId: 'sam', displayName: 'Sam Rivera' });
    const select = vi.fn();
    render(<WorkspaceActorPicker options={[]} value={null} onChange={select} />);
    openCreate();
    expect(
      screen.getByText('Creates a person record. No invitation will be sent.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Add “Sam Rivera” to Workshop?')).toBeInTheDocument();
    expect(state.create).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Add and select' }));
    await waitFor(() => {
      expect(select).toHaveBeenCalledWith('sam');
    });
    expect(state.create).toHaveBeenCalledWith({
      displayName: 'Sam Rivera',
      requestId: expect.any(String),
    });
  });

  it('retains the request identity after failure so retry cannot duplicate the person', async () => {
    state.create
      .mockRejectedValueOnce(new Error('private error'))
      .mockResolvedValue({ actorId: 'sam', displayName: 'Sam Rivera' });
    render(<WorkspaceActorPicker options={[]} value={null} onChange={vi.fn()} />);
    openCreate();
    fireEvent.click(screen.getByRole('button', { name: 'Add and select' }));
    await screen.findByRole('alert');
    expect(screen.queryByText('private error')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add and select' }));
    await waitFor(() => {
      expect(state.create).toHaveBeenCalledTimes(2);
    });
    expect(state.create.mock.calls[0]).toEqual(state.create.mock.calls[1]);
  });

  it('offers an explicit duplicate-name action and hides creation from readers', () => {
    const view = render(
      <WorkspaceActorPicker
        options={[{ value: 'other', label: 'Sam Rivera' }]}
        value={null}
        onChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Assignee/ }));
    fireEvent.change(screen.getByPlaceholderText('Search people…'), {
      target: { value: 'Sam Rivera' },
    });
    expect(
      screen.getByRole('button', { name: 'Add another person named “Sam Rivera”' }),
    ).toBeInTheDocument();
    state.canContribute = false;
    view.rerender(
      <WorkspaceActorPicker
        options={[{ value: 'other', label: 'Sam Rivera' }]}
        value={null}
        onChange={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: /Add another/ })).not.toBeInTheDocument();
  });

  it('does not apply an old request to a newly selected workspace', async () => {
    let complete!: (person: { actorId: string; displayName: string }) => void;
    state.create.mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const select = vi.fn();
    const view = render(
      <WorkspaceActorPicker orgId="one" options={[]} value={null} onChange={select} />,
    );
    openCreate();
    fireEvent.click(screen.getByRole('button', { name: 'Add and select' }));
    view.rerender(<WorkspaceActorPicker orgId="two" options={[]} value={null} onChange={select} />);
    complete({ actorId: 'sam', displayName: 'Sam Rivera' });
    await waitFor(() => expect(screen.queryByText('Adding…')).not.toBeInTheDocument());
    expect(select).not.toHaveBeenCalled();
  });
});
