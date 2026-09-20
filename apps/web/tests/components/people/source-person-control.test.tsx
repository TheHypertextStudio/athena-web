import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SourcePersonReferenceOut } from '@docket/connections/integration-contract';
import { SourcePersonControl } from '@/components/people/source-person-control';

const mocks = vi.hoisted(() => ({ resolve: vi.fn(), canManage: true }));
vi.mock('@/components/settings/use-can-manage-org', () => ({
  useCanManageOrg: () => ({ canManage: mocks.canManage }),
}));
vi.mock('@/components/people/people-queries', () => ({ peopleQuery: () => ({}) }));
vi.mock('@/components/people/source-person-queries', () => ({
  sourcePersonCandidatesQuery: () => ({}),
  useResolveSourcePerson: () => ({ mutateAsync: mocks.resolve, isPending: false }),
}));
vi.mock('@/lib/query', () => ({
  useApiQuery: () => ({
    data: { items: [{ actorId: '01ARZ3NDEKTSV4RRFFQ69G5FAV', displayName: 'Sam Rivera' }] },
  }),
  useApiListQuery: () => ({
    data: {
      items: [{ actorId: '01ARZ3NDEKTSV4RRFFQ69G5FAV', displayName: 'Sam Rivera', reason: 'name' }],
    },
  }),
}));
const source: SourcePersonReferenceOut = {
  id: 'ref',
  externalActorId: 'external',
  integrationId: 'integration',
  provider: 'GitHub',
  externalId: 'sam-gh',
  displayName: 'Sam R',
  avatarUrl: null,
  actorId: null,
  field: 'assigneeId',
};
afterEach(() => {
  cleanup();
  mocks.resolve.mockReset();
  mocks.canManage = true;
});

function open() {
  render(<SourcePersonControl orgId="org" source={source} />);
  fireEvent.click(screen.getByRole('button', { name: 'Identity: Sam R' }));
}
describe('contextual identity resolution', () => {
  it('shows source attribution to contributors without offering management', () => {
    mocks.canManage = false;
    open();
    expect(screen.getByText('GitHub · sam-gh')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add as a new person' })).not.toBeInTheDocument();
    expect(mocks.resolve).not.toHaveBeenCalled();
  });
  it('explains the scope before confirming a suggested match', async () => {
    mocks.resolve.mockResolvedValue({});
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Sam Rivera · Matching name' }));
    expect(screen.getByText(/Other references to this identity/)).toBeInTheDocument();
    expect(mocks.resolve).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => {
      expect(mocks.resolve).toHaveBeenCalledWith({
        requestId: expect.any(String),
        decision: { action: 'match_existing', actorId: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
      });
    });
  });
  it('can back out of person creation without recording a decision', () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Add as a new person' }));
    expect(screen.getByText(/No invitation will be sent/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByText('Same person?')).toBeInTheDocument();
    expect(mocks.resolve).not.toHaveBeenCalled();
  });
  it('closes confirmation before the identity surface on Escape', async () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Add as a new person' }));
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Person name' }), { key: 'Escape' });
    expect(screen.getByText('Same person?')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Search workspace people' })).toHaveFocus(),
    );
    expect(mocks.resolve).not.toHaveBeenCalled();
  });
  it('shows the capped imported name and requires a nonblank editable name', async () => {
    mocks.resolve.mockResolvedValue({});
    const longName = 'S'.repeat(150);
    render(<SourcePersonControl orgId="org" source={{ ...source, displayName: longName }} />);
    fireEvent.click(screen.getByRole('button', { name: `Identity: ${longName}` }));
    fireEvent.click(screen.getByRole('button', { name: 'Add as a new person' }));
    const input = screen.getByRole('textbox', { name: 'Person name' });
    expect(input).toHaveValue('S'.repeat(120));
    expect(input).toHaveAttribute('maxlength', '120');
    fireEvent.change(input, { target: { value: '   ' } });
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled();
    fireEvent.change(input, { target: { value: ' Sam Rivera ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => {
      expect(mocks.resolve).toHaveBeenCalledWith({
        requestId: expect.any(String),
        decision: { action: 'create_actor', name: 'Sam Rivera' },
      });
    });
  });
  it('shows the canonical person while retaining original source context in resolution', () => {
    render(
      <SourcePersonControl
        orgId="org"
        source={{ ...source, canonicalDisplayName: 'Sam Rivera' }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Identity: Sam Rivera' }));
    expect(screen.getByText('Sam R')).toBeInTheDocument();
    expect(screen.getByText('GitHub · sam-gh')).toBeInTheDocument();
  });
  it('uses a provider-qualified identifier when the imported name is empty', () => {
    render(<SourcePersonControl orgId="org" source={{ ...source, displayName: ' ' }} />);
    expect(
      screen.getByRole('button', { name: 'Identity: GitHub user sam-gh' }),
    ).toBeInTheDocument();
  });
});
