import '@testing-library/jest-dom/vitest';

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { JSX, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { InitiativeHierarchyPickerOverlay } from '@/components/initiatives/initiative-hierarchy-picker-overlay';
import * as initiativeMutations from '@/components/initiatives/initiative-hierarchy-mutations';
import {
  InitiativeHierarchyWriteCoordinator,
  InitiativeHierarchyWriteCoordinatorProvider,
} from '@/components/initiatives/initiative-hierarchy-write-coordinator';
import {
  type InitiativeHierarchyPickerRequest,
  PickerOverlayProvider,
  usePickerOverlay,
} from '@/components/pickers/picker-overlay';
import { queryKeys } from '@/lib/query';
import { makeQueryWrapper, okResponse } from '../../support/query';

const { candidateGet, invalidateWorkTargetQueries, overviewGet } = vi.hoisted(() => ({
  candidateGet: vi.fn(),
  invalidateWorkTargetQueries: vi.fn(() => Promise.resolve()),
  overviewGet: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  api: {
    v1: {
      orgs: {
        ':orgId': {
          initiatives: {
            overview: { $get: overviewGet },
            'hierarchy-candidates': { $get: candidateGet },
          },
        },
      },
    },
  },
}));

vi.mock('@/components/initiatives/initiative-hierarchy-mutations', async () => {
  const actual = await vi.importActual<typeof initiativeMutations>(
    '@/components/initiatives/initiative-hierarchy-mutations',
  );
  return { ...actual, writeInitiativeHierarchyMutation: vi.fn().mockResolvedValue(undefined) };
});

vi.mock('@/lib/work-target-invalidation', () => ({ invalidateWorkTargetQueries }));

const ORG = 'org-a';
const SUBJECT: InitiativeHierarchyPickerRequest['subject'] = {
  kind: 'initiative' as const,
  id: 'child',
  organizationId: ORG,
  title: 'Child',
  meta: { parentInitiativeId: 'root', parentLinkId: 'link-child' },
};

const FOREIGN = {
  id: 'foreign-child',
  organizationId: 'org-b',
  name: 'Foreign initiative',
  summary: 'Shared from another workspace',
  parentInitiativeId: 'root',
  parentLinkId: 'link-foreign',
};

const DETACHED_FOREIGN = {
  id: 'detached-foreign-child',
  organizationId: 'org-b',
  organizationName: 'Partner workspace',
  name: 'Detached foreign initiative',
  summary: 'Available after its route hierarchy link was removed',
  status: 'active',
  health: null,
  crossWorkspace: true,
  appearsInContext: false,
  parentInitiativeId: null,
  parentLinkId: null,
};

interface OverviewFixture {
  readonly id: string;
  readonly organizationId: string;
  readonly name: string;
  readonly summary: string | null;
  readonly parentInitiativeId: string | null;
  readonly parentLinkId: string | null;
}

function overviewItems(): OverviewFixture[] {
  return [
    {
      id: 'root',
      organizationId: ORG,
      name: 'Current parent',
      summary: null,
      parentInitiativeId: null,
      parentLinkId: null,
    },
    {
      id: 'child',
      organizationId: ORG,
      name: 'Child',
      summary: null,
      parentInitiativeId: 'root',
      parentLinkId: 'link-child',
    },
    {
      id: 'new-parent',
      organizationId: ORG,
      name: 'New parent',
      summary: null,
      parentInitiativeId: null,
      parentLinkId: null,
    },
    FOREIGN,
  ];
}

let authoritativeItems: OverviewFixture[];

function applyAuthoritativeMutation(
  mutation: Exclude<initiativeMutations.InitiativeHierarchyMutation, { readonly kind: 'noop' }>,
): void {
  if (mutation.kind === 'detach') {
    const child = authoritativeItems.find((item) => item.id === mutation.childInitiativeId);
    authoritativeItems =
      child?.organizationId !== ORG
        ? authoritativeItems.filter((item) => item.id !== mutation.childInitiativeId)
        : authoritativeItems.map((item) =>
            item.id === mutation.childInitiativeId
              ? { ...item, parentInitiativeId: null, parentLinkId: null }
              : item,
          );
    return;
  }

  const existing = authoritativeItems.find((item) => item.id === mutation.childInitiativeId);
  const parentLinkId =
    mutation.kind === 'move' ? mutation.linkId : `server-link-${mutation.childInitiativeId}`;
  if (existing !== undefined) {
    authoritativeItems = authoritativeItems.map((item) =>
      item.id === mutation.childInitiativeId
        ? { ...item, parentInitiativeId: mutation.parentInitiativeId, parentLinkId }
        : item,
    );
    return;
  }
  if (mutation.childInitiativeId === DETACHED_FOREIGN.id) {
    authoritativeItems = [
      ...authoritativeItems,
      { ...DETACHED_FOREIGN, parentInitiativeId: mutation.parentInitiativeId, parentLinkId },
    ];
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  authoritativeItems = overviewItems();
  overviewGet.mockImplementation(() =>
    Promise.resolve(
      okResponse({
        items: authoritativeItems,
      }),
    ),
  );
  candidateGet.mockImplementation(({ query }: { query: { mode: 'parent' | 'child' } }) =>
    Promise.resolve(
      okResponse({
        items:
          query.mode === 'child'
            ? [
                ...authoritativeItems,
                ...(authoritativeItems.some((item) => item.id === DETACHED_FOREIGN.id)
                  ? []
                  : [DETACHED_FOREIGN]),
              ]
            : authoritativeItems,
      }),
    ),
  );
  vi.mocked(initiativeMutations.writeInitiativeHierarchyMutation)
    .mockReset()
    .mockImplementation(async (_organizationId, mutation) => {
      if (mutation.kind !== 'noop') applyAuthoritativeMutation(mutation);
    });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function renderPicker(
  subject: InitiativeHierarchyPickerRequest['subject'] = SUBJECT,
  mode: 'parent' | 'child' = 'parent',
) {
  const onClose = vi.fn();
  const { client, wrapper } = makeQueryWrapper();
  const coordinator = new InitiativeHierarchyWriteCoordinator();
  const QueryWrapper = wrapper;
  const TestWrapper = ({ children }: { readonly children: ReactNode }): JSX.Element => (
    <QueryWrapper>
      <InitiativeHierarchyWriteCoordinatorProvider coordinator={coordinator}>
        {children}
      </InitiativeHierarchyWriteCoordinatorProvider>
    </QueryWrapper>
  );
  const rendered = render(
    <InitiativeHierarchyPickerOverlay
      request={{
        kind: 'initiative-hierarchy',
        mode,
        organizationId: ORG,
        subject,
      }}
      onClose={onClose}
    />,
    { wrapper: TestWrapper },
  );
  return { ...rendered, client, coordinator, onClose };
}

function PickerProviderRaceHarness(): JSX.Element {
  const picker = usePickerOverlay();
  return (
    <>
      <button
        type="button"
        onClick={() => {
          picker.open({
            kind: 'initiative-hierarchy',
            mode: 'parent',
            organizationId: ORG,
            subject: SUBJECT,
          });
        }}
      >
        Open picker A
      </button>
      <button
        type="button"
        onClick={() => {
          picker.open({
            kind: 'initiative-hierarchy',
            mode: 'parent',
            organizationId: ORG,
            subject: { ...SUBJECT, id: 'new-parent', title: 'Second picker' },
          });
        }}
      >
        Open picker B
      </button>
    </>
  );
}

describe('InitiativeHierarchyPickerOverlay', () => {
  it('keeps a foreign Initiative hierarchy write and refresh in the route workspace', async () => {
    const { client, onClose } = renderPicker({ ...SUBJECT, organizationId: 'org-b' });
    const invalidate = vi.spyOn(client, 'invalidateQueries');

    fireEvent.click(
      within(await screen.findByRole('option', { name: /New parent/ })).getByRole('button'),
    );

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledOnce();
    });
    expect(initiativeMutations.writeInitiativeHierarchyMutation).toHaveBeenCalledWith(ORG, {
      kind: 'move',
      linkId: 'link-child',
      parentInitiativeId: 'new-parent',
      childInitiativeId: 'child',
    });
    expect(invalidate).toHaveBeenCalledOnce();
    expect(invalidate).toHaveBeenCalledWith(
      { queryKey: queryKeys.initiatives(ORG) },
      { throwOnError: true },
    );
    expect(invalidateWorkTargetQueries).not.toHaveBeenCalled();
  });

  it('allows a local Initiative to choose an accessible foreign parent in the route hierarchy', async () => {
    const { onClose } = renderPicker();

    fireEvent.click(
      within(await screen.findByRole('option', { name: /Foreign initiative/ })).getByRole('button'),
    );

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledOnce();
    });
    expect(initiativeMutations.writeInitiativeHierarchyMutation).toHaveBeenCalledWith(ORG, {
      kind: 'move',
      linkId: 'link-child',
      parentInitiativeId: FOREIGN.id,
      childInitiativeId: SUBJECT.id,
    });
  });

  it('allows a local Initiative to adopt an accessible foreign child in the route hierarchy', async () => {
    const subject = {
      ...SUBJECT,
      id: 'new-parent',
      title: 'New parent',
      meta: { parentInitiativeId: null, parentLinkId: null },
    };
    const { onClose } = renderPicker(subject, 'child');

    fireEvent.click(
      within(await screen.findByRole('option', { name: /Foreign initiative/ })).getByRole('button'),
    );

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledOnce();
    });
    expect(initiativeMutations.writeInitiativeHierarchyMutation).toHaveBeenCalledWith(ORG, {
      kind: 'move',
      linkId: FOREIGN.parentLinkId,
      parentInitiativeId: subject.id,
      childInitiativeId: FOREIGN.id,
    });
  });

  it('can reattach an accessible foreign child that is absent from the route overview', async () => {
    const subject = {
      ...SUBJECT,
      id: 'new-parent',
      title: 'New parent',
      meta: { parentInitiativeId: null, parentLinkId: null },
    };
    const { onClose } = renderPicker(subject, 'child');

    fireEvent.click(
      within(await screen.findByRole('option', { name: /Detached foreign initiative/ })).getByRole(
        'button',
      ),
    );

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledOnce();
    });
    expect(initiativeMutations.writeInitiativeHierarchyMutation).toHaveBeenCalledWith(ORG, {
      kind: 'create',
      parentInitiativeId: subject.id,
      childInitiativeId: DETACHED_FOREIGN.id,
    });
  });

  it('repairs the route hierarchy when a write has an indeterminate failure', async () => {
    vi.mocked(initiativeMutations.writeInitiativeHierarchyMutation).mockRejectedValueOnce(
      new Error('response lost after commit'),
    );
    const { client, onClose } = renderPicker();
    const invalidate = vi.spyOn(client, 'invalidateQueries').mockResolvedValue(undefined);

    fireEvent.click(
      within(await screen.findByRole('option', { name: /New parent/ })).getByRole('button'),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not change this initiative hierarchy.',
    );
    await waitFor(() => {
      expect(invalidate).toHaveBeenCalledWith(
        { queryKey: queryKeys.initiatives(ORG) },
        { throwOnError: true },
      );
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('keeps the picker usable so a failed hierarchy write can be retried', async () => {
    vi.mocked(initiativeMutations.writeInitiativeHierarchyMutation).mockRejectedValueOnce(
      new Error('response lost after commit'),
    );
    const { onClose } = renderPicker();

    fireEvent.click(
      within(await screen.findByRole('option', { name: /New parent/ })).getByRole('button'),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not change this initiative hierarchy.',
    );
    const retry = within(screen.getByRole('option', { name: /New parent/ })).getByRole('button');
    expect(retry).toBeEnabled();
    fireEvent.click(retry);

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledOnce();
    });
    expect(initiativeMutations.writeInitiativeHierarchyMutation).toHaveBeenCalledTimes(2);
  });

  it('closes after reconciliation proves that a lost create response was applied', async () => {
    const topLevelSubject = {
      ...SUBJECT,
      meta: { parentInitiativeId: null, parentLinkId: null },
    };
    const appliedItems = overviewItems().map((item) =>
      item.id === topLevelSubject.id
        ? { ...item, parentInitiativeId: 'new-parent', parentLinkId: 'server-link' }
        : item,
    );
    const reconciledResponse = okResponse({ items: appliedItems });
    let resolveReconciliation: ((response: typeof reconciledResponse) => void) | undefined;
    const reconciliation = new Promise<typeof reconciledResponse>((resolve) => {
      resolveReconciliation = resolve;
    });
    overviewGet
      .mockReset()
      .mockResolvedValueOnce(okResponse({ items: overviewItems() }))
      .mockReturnValueOnce(reconciliation)
      .mockResolvedValue(reconciledResponse);
    vi.mocked(initiativeMutations.writeInitiativeHierarchyMutation).mockRejectedValueOnce(
      new Error('response lost after create'),
    );
    const { onClose } = renderPicker(topLevelSubject);

    fireEvent.click(
      within(await screen.findByRole('option', { name: /New parent/ })).getByRole('button'),
    );

    const immediateRetry = within(screen.getByRole('option', { name: /New parent/ })).getByRole(
      'button',
    );
    expect(immediateRetry).toBeDisabled();
    fireEvent.click(immediateRetry);
    expect(initiativeMutations.writeInitiativeHierarchyMutation).toHaveBeenCalledOnce();

    resolveReconciliation?.(reconciledResponse);
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledOnce();
    });
    expect(initiativeMutations.writeInitiativeHierarchyMutation).toHaveBeenCalledOnce();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('treats a foreign subject missing after detach reconciliation as detached', async () => {
    const foreignSubject: InitiativeHierarchyPickerRequest['subject'] = {
      kind: 'initiative',
      id: FOREIGN.id,
      organizationId: FOREIGN.organizationId,
      title: FOREIGN.name,
      meta: {
        parentInitiativeId: FOREIGN.parentInitiativeId,
        parentLinkId: FOREIGN.parentLinkId,
      },
    };
    const detachedItems = overviewItems().filter((item) => item.id !== FOREIGN.id);
    overviewGet
      .mockReset()
      .mockResolvedValueOnce(okResponse({ items: overviewItems() }))
      .mockResolvedValue(okResponse({ items: detachedItems }));
    vi.mocked(initiativeMutations.writeInitiativeHierarchyMutation).mockRejectedValueOnce(
      new Error('response lost after detach'),
    );
    const { onClose } = renderPicker(foreignSubject);

    fireEvent.click(
      within(await screen.findByRole('option', { name: 'Top level' })).getByRole('button'),
    );

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledOnce();
    });
    expect(initiativeMutations.writeInitiativeHierarchyMutation).toHaveBeenCalledOnce();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows progress and disables every picker control while a hierarchy write is pending', async () => {
    let resolveWrite: (() => void) | undefined;
    vi.mocked(initiativeMutations.writeInitiativeHierarchyMutation).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveWrite = () => {
            applyAuthoritativeMutation({
              kind: 'move',
              linkId: SUBJECT.meta?.['parentLinkId'] as string,
              parentInitiativeId: 'new-parent',
              childInitiativeId: SUBJECT.id,
            });
            resolve();
          };
        }),
    );
    const { onClose } = renderPicker();
    const option = within(await screen.findByRole('option', { name: /New parent/ })).getByRole(
      'button',
    );

    fireEvent.click(option);

    const progress = await screen.findByRole('status');
    expect(progress).toBeVisible();
    expect(progress).not.toHaveClass('sr-only');
    expect(progress).toHaveTextContent('Updating hierarchy');
    expect(screen.getByRole('textbox', { name: 'Search Parent initiative' })).toBeDisabled();
    for (const button of screen.getAllByRole('button')) expect(button).toBeDisabled();
    fireEvent.click(option);
    expect(initiativeMutations.writeInitiativeHierarchyMutation).toHaveBeenCalledOnce();

    resolveWrite?.();
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledOnce();
    });
  });

  it('prevents replacement and dismissal while the active provider picker is busy', async () => {
    let resolveWrite: (() => void) | undefined;
    vi.mocked(initiativeMutations.writeInitiativeHierarchyMutation).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveWrite = () => {
            applyAuthoritativeMutation({
              kind: 'move',
              linkId: SUBJECT.meta?.['parentLinkId'] as string,
              parentInitiativeId: 'new-parent',
              childInitiativeId: SUBJECT.id,
            });
            resolve();
          };
        }),
    );
    const { wrapper } = makeQueryWrapper();
    render(
      <PickerOverlayProvider>
        <PickerProviderRaceHarness />
      </PickerOverlayProvider>,
      { wrapper },
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open picker A' }));

    fireEvent.click(
      within(await screen.findByRole('option', { name: /New parent/ })).getByRole('button'),
    );
    await screen.findByText('Updating hierarchy…');
    fireEvent.click(screen.getByRole('button', { name: 'Open picker B' }));
    expect(screen.getByRole('option', { name: /New parent/ })).toBeVisible();
    expect(screen.queryByRole('option', { name: /^Child/ })).toBeNull();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.getByRole('dialog')).toBeVisible();

    resolveWrite?.();
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('retains the child lock and completes an authoritative refresh after picker unmount', async () => {
    let resolveWrite: (() => void) | undefined;
    vi.mocked(initiativeMutations.writeInitiativeHierarchyMutation).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveWrite = () => {
            applyAuthoritativeMutation({
              kind: 'move',
              linkId: SUBJECT.meta?.['parentLinkId'] as string,
              parentInitiativeId: 'new-parent',
              childInitiativeId: SUBJECT.id,
            });
            resolve();
          };
        }),
    );
    const { client, coordinator, unmount } = renderPicker();

    fireEvent.click(
      within(await screen.findByRole('option', { name: /New parent/ })).getByRole('button'),
    );
    await screen.findByText('Updating hierarchy…');
    unmount();

    expect(coordinator.isBusy(ORG, SUBJECT.id)).toBe(true);
    expect(
      coordinator.claim({
        organizationId: ORG,
        childInitiativeId: SUBJECT.id,
        ownerId: 'replacement-picker',
        mutation: {
          kind: 'move',
          linkId: 'link-child',
          parentInitiativeId: 'new-parent',
          childInitiativeId: SUBJECT.id,
        },
      }),
    ).toBeNull();

    resolveWrite?.();
    await waitFor(() => {
      expect(coordinator.isBusy(ORG, SUBJECT.id)).toBe(false);
    });
    expect(
      client
        .getQueryData<{ items: OverviewFixture[] }>(queryKeys.initiatives(ORG))
        ?.items.find((item) => item.id === SUBJECT.id),
    ).toMatchObject({ parentInitiativeId: 'new-parent', parentLinkId: 'link-child' });
  });

  it('releases an unmounted picker child lock when its authoritative refresh fails', async () => {
    let resolveWrite: (() => void) | undefined;
    vi.mocked(initiativeMutations.writeInitiativeHierarchyMutation).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveWrite = resolve;
        }),
    );
    const { client, coordinator, unmount } = renderPicker();
    vi.spyOn(client, 'invalidateQueries').mockRejectedValueOnce(
      new Error('route refresh failed after unmount'),
    );

    fireEvent.click(
      within(await screen.findByRole('option', { name: /New parent/ })).getByRole('button'),
    );
    await screen.findByText('Updating hierarchy…');
    unmount();
    expect(coordinator.isBusy(ORG, SUBJECT.id)).toBe(true);

    resolveWrite?.();

    await waitFor(() => {
      expect(coordinator.isBusy(ORG, SUBJECT.id)).toBe(false);
    });
  });

  it('disables a child locked by another picker without blocking different children', async () => {
    const subject = {
      ...SUBJECT,
      id: 'new-parent',
      title: 'New parent',
      meta: { parentInitiativeId: null, parentLinkId: null },
    };
    const { coordinator, onClose } = renderPicker(subject, 'child');
    await screen.findByRole('option', { name: /Foreign initiative/ });

    act(() => {
      coordinator.claim({
        organizationId: ORG,
        childInitiativeId: FOREIGN.id,
        ownerId: 'other-picker',
        mutation: {
          kind: 'move',
          linkId: FOREIGN.parentLinkId,
          parentInitiativeId: subject.id,
          childInitiativeId: FOREIGN.id,
        },
      });
    });

    const locked = within(screen.getByRole('option', { name: /Foreign initiative/ })).getByRole(
      'button',
    );
    const available = within(
      screen.getByRole('option', { name: /Detached foreign initiative/ }),
    ).getByRole('button');
    expect(locked).toBeDisabled();
    expect(available).toBeEnabled();

    fireEvent.click(available);
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledOnce();
    });
    expect(initiativeMutations.writeInitiativeHierarchyMutation).toHaveBeenCalledWith(ORG, {
      kind: 'create',
      parentInitiativeId: subject.id,
      childInitiativeId: DETACHED_FOREIGN.id,
    });
  });

  it('shows refresh recovery and retries only the refresh after reconciliation fails', async () => {
    const { client, onClose } = renderPicker();
    const invalidate = vi
      .spyOn(client, 'invalidateQueries')
      .mockRejectedValueOnce(new Error('route refresh failed'));

    fireEvent.click(
      within(await screen.findByRole('option', { name: /New parent/ })).getByRole('button'),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not refresh the initiative hierarchy.',
    );
    expect(screen.getByRole('button', { name: 'Retry refresh' })).toBeEnabled();
    expect(screen.getByRole('textbox', { name: 'Search Parent initiative' })).toBeDisabled();
    expect(initiativeMutations.writeInitiativeHierarchyMutation).toHaveBeenCalledOnce();

    client.setQueryData(queryKeys.initiatives(ORG), {
      items: overviewItems().map((item) =>
        item.id === SUBJECT.id
          ? { ...item, parentInitiativeId: 'new-parent', parentLinkId: 'server-link' }
          : item,
      ),
    });
    invalidate.mockResolvedValueOnce(undefined);
    fireEvent.click(screen.getByRole('button', { name: 'Retry refresh' }));

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledOnce();
    });
    expect(initiativeMutations.writeInitiativeHierarchyMutation).toHaveBeenCalledOnce();
  });

  it('keeps request link facts when initial route data omits a foreign subject', async () => {
    const foreignSubject: InitiativeHierarchyPickerRequest['subject'] = {
      kind: 'initiative',
      id: FOREIGN.id,
      organizationId: FOREIGN.organizationId,
      title: FOREIGN.name,
      meta: {
        parentInitiativeId: FOREIGN.parentInitiativeId,
        parentLinkId: FOREIGN.parentLinkId,
      },
    };
    overviewGet.mockResolvedValue(
      okResponse({ items: overviewItems().filter((item) => item.id !== FOREIGN.id) }),
    );
    const { onClose } = renderPicker(foreignSubject);

    fireEvent.click(
      within(await screen.findByRole('option', { name: 'Top level' })).getByRole('button'),
    );

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledOnce();
    });
    expect(initiativeMutations.writeInitiativeHierarchyMutation).toHaveBeenCalledWith(ORG, {
      kind: 'detach',
      linkId: FOREIGN.parentLinkId,
      childInitiativeId: FOREIGN.id,
    });
  });

  it('shows a distinct refreshing state after the write settles', async () => {
    let finishWrite: (() => void) | undefined;
    let finishRefresh: (() => void) | undefined;
    vi.mocked(initiativeMutations.writeInitiativeHierarchyMutation).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishWrite = resolve;
        }),
    );
    const { client } = renderPicker();
    vi.spyOn(client, 'invalidateQueries').mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishRefresh = resolve;
        }),
    );

    fireEvent.click(
      within(await screen.findByRole('option', { name: /New parent/ })).getByRole('button'),
    );
    expect(await screen.findByRole('status')).toHaveTextContent('Updating hierarchy');
    finishWrite?.();

    expect(await screen.findByRole('status')).toHaveTextContent('Refreshing hierarchy');
    expect(screen.getByRole('textbox', { name: 'Search Parent initiative' })).toBeDisabled();
    finishRefresh?.();
  });

  it('skips both the write and refresh when the chosen parent is unchanged', async () => {
    const { client, onClose } = renderPicker();
    const invalidate = vi.spyOn(client, 'invalidateQueries').mockResolvedValue(undefined);

    fireEvent.click(
      within(await screen.findByRole('option', { name: /Current parent/ })).getByRole('button'),
    );

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledOnce();
    });
    expect(initiativeMutations.writeInitiativeHierarchyMutation).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
  });
});
