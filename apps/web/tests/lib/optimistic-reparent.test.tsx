/**
 * Optimistic drag-and-drop reparenting, end to end (SCR-06).
 *
 * @remarks
 * Reparenting is the one mutation a person judges entirely by feel: they drag a row onto another
 * row and the tree either re-nests under their cursor or it does not. Anything that waits for a
 * round trip reads as a dropped gesture, so the write is optimistic — and therefore owes a correct
 * rollback.
 *
 * This exercises the whole path rather than the mutation in isolation: a real `dragstart` on the
 * source row writes the payload through `entity-drag`, a real `drop` on the target row reads it
 * back through `hierarchy-dnd`, `planReparent` decides the move, and the hierarchy-link mutation
 * applies the optimistic cache write. Testing the mutation alone would have proved nothing about
 * the parts that actually carry the parent edge between the two rows.
 *
 * The failure case asserts the rollback restores the original parent *and* that the message shown
 * is application-owned. The rejection deliberately carries transport-shaped text, because "shows an
 * error" is not the bar — "never shows the driver's error" is.
 */
import '@testing-library/jest-dom/vitest';

import type { InitiativeOverviewItem, InitiativeOverviewOut } from '@docket/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { JSX, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { hierarchyLinkPatch, hierarchyLinkPost, hierarchyLinkDelete, overviewGet, routerPush } =
  vi.hoisted(() => ({
    hierarchyLinkPatch: vi.fn(),
    hierarchyLinkPost: vi.fn(),
    hierarchyLinkDelete: vi.fn(),
    overviewGet: vi.fn(),
    routerPush: vi.fn(),
  }));

const ORG_ID = '01BX5ZZKBKACTAV9WEVGEMMVRZ';
const ROOT_A_ID = '01BX5ZZKBKACTAV9WEVGEMMV01';
const ROOT_B_ID = '01BX5ZZKBKACTAV9WEVGEMMV02';
const CHILD_ID = '01BX5ZZKBKACTAV9WEVGEMMV03';
const CHILD_LINK_ID = '01BX5ZZKBKACTAV9WEVGEMMV04';

/** Transport-shaped text that must never reach the screen. */
const LEAKY_REJECTION = 'ECONNRESET while writing initiative_hierarchy_links (pg driver)';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush, replace: vi.fn() }),
}));

// The URL is read through the app's own location source rather than Next's router, so that is what
// a test presents. See `src/lib/app-location.tsx`.
vi.mock('../../src/lib/app-location', () => ({
  useAppParams: () => ({ orgId: ORG_ID }),
  useAppPathname: () => `/orgs/${ORG_ID}/initiatives`,
  useAppSearchParams: () => new URLSearchParams(),
}));

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock('../../src/lib/api', () => ({
  api: {
    v1: {
      orgs: {
        ':orgId': {
          initiatives: {
            overview: { $get: overviewGet },
            'hierarchy-links': {
              $post: hierarchyLinkPost,
              ':linkId': { $patch: hierarchyLinkPatch, $delete: hierarchyLinkDelete },
            },
            ':id': { $patch: vi.fn() },
          },
          members: { $get: vi.fn() },
          roles: { $get: vi.fn() },
          display: { ':subjectType': { ':subjectId': { $put: vi.fn() } } },
        },
      },
    },
  },
}));

vi.mock('../../src/components/authentication-interlock', () => ({
  useAuthenticationInterlock: () => ({ requireAuthentication: vi.fn() }),
  useOptionalAuthenticationRecovery:
    () =>
    async <T,>(action: () => Promise<T>) =>
      action(),
}));

import InitiativesListClient from '../../src/app/(app)/orgs/[orgId]/initiatives/initiatives-client';
import { queryKeys } from '../../src/lib/query';

/** A typed mock Hono response for the `unwrap` layer. */
function okResponse<T>(body: T) {
  return { ok: true, status: 200, json: () => Promise.resolve(body) };
}

/** Build one overview row; only the fields the hierarchy and drag payload read carry meaning. */
function overviewItem(
  id: string,
  name: string,
  parentInitiativeId: string | null,
  parentLinkId: string | null,
): InitiativeOverviewItem {
  return {
    id,
    organizationId: ORG_ID,
    organizationName: 'Acme',
    name,
    status: 'active',
    health: 'on_track',
    summary: null,
    targetDate: null,
    ownerName: null,
    lastUpdateAt: null,
    parentInitiativeId,
    parentLinkId,
    depth: parentInitiativeId ? 2 : 1,
    childCount: 0,
    display: {
      subjectType: 'initiative',
      subjectId: id,
      iconKey: 'target',
      colorKey: 'neutral',
      customColor: null,
      customized: false,
    },
  } as unknown as InitiativeOverviewItem;
}

/** Two roots plus one child already nested under the first — the setup a "move" plan needs. */
function overview(): InitiativeOverviewOut {
  return {
    items: [
      overviewItem(ROOT_A_ID, 'Alpha', null, null),
      overviewItem(ROOT_B_ID, 'Bravo', null, null),
      overviewItem(CHILD_ID, 'Charlie', ROOT_A_ID, CHILD_LINK_ID),
    ],
    attention: [],
  };
}

/**
 * A minimal `DataTransfer` jsdom can carry across a drag.
 *
 * @remarks
 * jsdom implements no drag data store, so the payload written on `dragstart` would be lost before
 * `drop` reads it. One shared Map-backed object threaded through both events reproduces the real
 * browser behaviour that makes this feature work at all.
 */
function makeDataTransfer(): DataTransfer {
  const store = new Map<string, string>();
  return {
    effectAllowed: 'none',
    dropEffect: 'none',
    setData: (type: string, value: string): void => {
      store.set(type, value);
    },
    getData: (type: string): string => store.get(type) ?? '',
    setDragImage: (): void => undefined,
    clearData: (): void => {
      store.clear();
    },
  } as unknown as DataTransfer;
}

/** Render the initiatives treegrid with its overview already answering. */
function renderTreegrid(): { client: QueryClient } {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }): JSX.Element => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  render(<InitiativesListClient />, { wrapper });
  return { client };
}

/** The treegrid row whose name cell reads `name`. */
async function rowNamed(name: string): Promise<HTMLElement> {
  const cell = await screen.findByText(name);
  const row = cell.closest('[role="row"]');
  if (!(row instanceof HTMLElement)) throw new Error(`No treegrid row for ${name}`);
  return row;
}

/** Drag `sourceName`'s row onto `targetName`'s row, exactly as a pointer would. */
async function dragOnto(sourceName: string, targetName: string): Promise<void> {
  const dataTransfer = makeDataTransfer();
  fireEvent.dragStart(await rowNamed(sourceName), { dataTransfer });
  const target = await rowNamed(targetName);
  fireEvent.dragOver(target, { dataTransfer });
  fireEvent.drop(target, { dataTransfer });
}

/** The parent recorded for `id` in the cached overview. */
function parentOf(client: QueryClient, id: string): string | null | undefined {
  return client
    .getQueryData<InitiativeOverviewOut>(queryKeys.initiatives(ORG_ID))
    ?.items.find((item) => item.id === id)?.parentInitiativeId;
}

beforeEach(() => {
  overviewGet.mockReset().mockImplementation(() => Promise.resolve(okResponse(overview())));
  hierarchyLinkPatch.mockReset();
  hierarchyLinkPost.mockReset();
  hierarchyLinkDelete.mockReset();
  routerPush.mockReset();
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
});

describe('drag-and-drop reparenting', () => {
  it('re-nests the row under its new parent before the request resolves', async () => {
    // Never settles: everything asserted below happens while the write is still in flight.
    hierarchyLinkPatch.mockImplementation(() => new Promise(() => undefined));
    const { client } = renderTreegrid();
    await screen.findByText('Charlie');
    expect(parentOf(client, CHILD_ID)).toBe(ROOT_A_ID);

    await dragOnto('Charlie', 'Bravo');

    await waitFor(() => {
      expect(parentOf(client, CHILD_ID)).toBe(ROOT_B_ID);
    });
    // The move went out as a move of the existing edge, not a second parent link.
    expect(hierarchyLinkPatch).toHaveBeenCalledWith({
      param: { orgId: ORG_ID, linkId: CHILD_LINK_ID },
      json: { parentInitiativeId: ROOT_B_ID },
    });
    expect(hierarchyLinkPost).not.toHaveBeenCalled();
  });

  it('restores the original parent and surfaces application-owned copy when the move fails', async () => {
    hierarchyLinkPatch.mockRejectedValue(new Error(LEAKY_REJECTION));
    const { client } = renderTreegrid();
    await screen.findByText('Charlie');

    await dragOnto('Charlie', 'Bravo');

    await waitFor(() => {
      expect(parentOf(client, CHILD_ID)).toBe(ROOT_A_ID);
    });
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText(/Could not move that initiative\./i)).toBeInTheDocument();
    expect(alert.textContent).not.toContain('ECONNRESET');
    expect(alert.textContent).not.toContain('pg driver');
  });

  it('detaches to the top level optimistically and rolls the parent back on failure', async () => {
    hierarchyLinkDelete.mockRejectedValue(new Error(LEAKY_REJECTION));
    const { client } = renderTreegrid();
    await screen.findByText('Charlie');

    const dataTransfer = makeDataTransfer();
    fireEvent.dragStart(await rowNamed('Charlie'), { dataTransfer });
    // The root drop zone only exists while a drag is in flight, which is the behaviour under test.
    const rootZone = await screen.findByText('Drop here to move to the top level');
    fireEvent.dragOver(rootZone, { dataTransfer });
    fireEvent.drop(rootZone, { dataTransfer });

    await waitFor(() => {
      expect(hierarchyLinkDelete).toHaveBeenCalledWith({
        param: { orgId: ORG_ID, linkId: CHILD_LINK_ID },
      });
    });
    await waitFor(() => {
      expect(parentOf(client, CHILD_ID)).toBe(ROOT_A_ID);
    });
    expect(screen.queryByText(new RegExp(LEAKY_REJECTION))).not.toBeInTheDocument();
  });

  it('does not write anything when the drop would not change the tree', async () => {
    const { client } = renderTreegrid();
    await screen.findByText('Charlie');

    // Dropping a row on its own current parent is a no-op, and a no-op must not fire a request or
    // disturb the cache — otherwise a stray drag would flash the tree for nothing.
    await dragOnto('Charlie', 'Alpha');

    expect(hierarchyLinkPatch).not.toHaveBeenCalled();
    expect(hierarchyLinkPost).not.toHaveBeenCalled();
    expect(hierarchyLinkDelete).not.toHaveBeenCalled();
    expect(parentOf(client, CHILD_ID)).toBe(ROOT_A_ID);
  });
});
