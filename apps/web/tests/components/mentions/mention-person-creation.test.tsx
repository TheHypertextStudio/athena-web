import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useMentionPersonCreation } from '@/components/mentions/use-mention-person-creation';
import MentionMenu from '@/components/mentions/mention-menu';
import type { MentionItem } from '@/lib/contracts/mention';
import type { MentionChoice } from '@/components/mentions/mention-choice';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  canContribute: true,
  items: [] as MentionItem[],
}));
vi.mock('@/components/active-org', () => ({
  useActiveOrg: () => ({ orgName: () => 'Community' }),
}));
vi.mock('@/components/settings/use-can-manage-org', () => ({
  useCanManageOrg: () => ({ canContribute: mocks.canContribute }),
}));
vi.mock('@/components/people/people-queries', () => ({
  useAddPerson: () => ({ mutateAsync: mocks.create, isPending: false }),
}));
vi.mock('@/components/mentions/use-mention-search', () => ({
  useMentionSearch: () => ({
    groups: [],
    items: mocks.items,
    localPending: false,
    externalPending: false,
    localFailed: false,
    externalFailed: false,
  }),
}));

function setup() {
  const select = vi.fn();
  let choices: readonly MentionChoice[] = [];
  const rendered = render(
    <MentionMenu
      open
      orgId="org_1"
      query="Sam Rivera"
      activeKey={undefined}
      hasArrowed={false}
      anchorRef={{ current: { getBoundingClientRect: () => new DOMRect(40, 40, 1, 20) } }}
      listboxId="mentions"
      onSelect={(choice) => {
        if (choice.origin === 'create-person') choice.select();
        else select(choice);
      }}
      onOpenChange={vi.fn()}
      onRows={(rows) => {
        choices = rows;
      }}
    />,
  );
  return { ...rendered, select, choices: () => choices };
}
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.canContribute = true;
  mocks.items = [];
});

describe('person creation from a mention', () => {
  it('requires explicit confirmation and selects a stable actor reference', async () => {
    mocks.create.mockResolvedValue({ actorId: 'person_1', displayName: 'Sam Rivera' });
    const view = setup();
    expect(mocks.create).not.toHaveBeenCalled();
    const choice = view.choices().find((row) => row.origin === 'create-person');
    expect(choice?.origin).toBe('create-person');
    act(() => {
      if (choice?.origin === 'create-person') choice.select();
    });
    expect(screen.getByText('Creates a person record. No invitation will be sent.')).toBeVisible();
    expect(mocks.create).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Add and select' }));
    await waitFor(() => {
      expect(view.select).toHaveBeenCalledWith(
        expect.objectContaining({
          ref: { kind: 'entity', entityKind: 'actor', entityId: 'person_1' },
          title: 'Sam Rivera',
        }),
      );
    });
  });

  it('retains the name and idempotency key after a failed request', async () => {
    mocks.create
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ actorId: 'person_1', displayName: 'Sam Rivera' });
    setup();
    fireEvent.click(screen.getByRole('option', { name: 'Add “Sam Rivera”' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add and select' }));
    await screen.findByRole('alert');
    expect(screen.getByText('Add “Sam Rivera” to Community?')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Add and select' }));
    await waitFor(() => {
      expect(mocks.create).toHaveBeenCalledTimes(2);
    });
    expect(mocks.create.mock.calls[0]?.[0]).toEqual(mocks.create.mock.calls[1]?.[0]);
  });

  it('cancels without creating or inserting and hides creation from readers', () => {
    const view = setup();
    fireEvent.click(screen.getByRole('option', { name: 'Add “Sam Rivera”' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(mocks.create).not.toHaveBeenCalled();
    expect(view.select).not.toHaveBeenCalled();
    view.unmount();
    mocks.canContribute = false;
    setup();
    expect(screen.queryByRole('option', { name: 'Add “Sam Rivera”' })).toBeNull();
  });
  it('explicitly labels creation of a second person with the same name', () => {
    mocks.items = [
      {
        origin: 'local',
        id: 'entity:actor:person_1',
        entityKind: 'actor',
        ref: { kind: 'entity', entityKind: 'actor', entityId: 'person_1' },
        title: 'Sam Rivera',
        subtitle: null,
        href: '/orgs/org_1/people/person_1',
        score: 1,
      },
    ];
    setup();
    expect(
      screen.getByRole('option', { name: 'Add another person named “Sam Rivera”' }),
    ).toBeVisible();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('does not insert an old result after leaving and returning to its workspace', async () => {
    let complete!: (person: { actorId: string; displayName: string }) => void;
    mocks.create.mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const select = vi.fn();
    const view = renderHook(({ orgId }) => useMentionPersonCreation(orgId, 'Sam Rivera', select), {
      initialProps: { orgId: 'one' },
    });
    act(() => {
      view.result.current.choice?.select();
    });
    const confirmation = render(view.result.current.confirmation);
    fireEvent.click(screen.getByRole('button', { name: 'Add and select' }));
    view.rerender({ orgId: 'two' });
    view.rerender({ orgId: 'one' });
    await act(async () => {
      complete({ actorId: 'person_1', displayName: 'Sam Rivera' });
      await Promise.resolve();
    });
    expect(select).not.toHaveBeenCalled();
    confirmation.unmount();
  });
});
