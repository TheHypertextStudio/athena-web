/**
 * What an open tab is called, and what it is never called.
 *
 * @remarks
 * A tab is opened the instant a route resolves, before anything has read the document behind it.
 * The stand-in for that moment used to be a slice of the document's primary key — "Project
 * 01HZX5" — and because unresolved titles were persisted like any other, a tab that failed to
 * resolve kept one for the rest of the session. These tests pin the replacement: an unnamed tab
 * says what kind of document it is, a cached name is used without a request at all, and a rename
 * on the detail page reaches the tab.
 */
import { ProjectNavigationSnapshot } from '../../../src/lib/contracts/entity-navigation';
import { type ProjectOut } from '../../../src/lib/contracts/project';
import type * as ResolveTitleModule from '../../../src/components/tabs/resolve-title';
import { tabLabel, type OpenTab } from '@docket/ui/components';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { assertDefined } from '@docket/test-utils';

const resolveTabTitle = vi.fn<(ref: unknown) => Promise<string | null>>();

vi.mock('../../../src/components/tabs/resolve-title', async (importOriginal) => {
  const actual = await importOriginal<typeof ResolveTitleModule>();
  return {
    ...actual,
    resolveTabTitle: (ref: unknown) => resolveTabTitle(ref),
  };
});

let pathname = '/orgs/01JAAAAAAAAAAAAAAAAAAAAAAA/projects/01JBBBBBBBBBBBBBBBBBBBBBBB';
vi.mock('../../../src/lib/app-location', () => ({
  useAppPathname: () => pathname,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const { OpenDocumentsProvider, useOpenDocuments } =
  await import('../../../src/components/tabs/open-documents');
const { projectRecordDef } = await import('../../../src/lib/entity-records');
const { purgeAllNavigationSnapshots, seedNavigationSnapshot } =
  await import('../../../src/lib/navigation-snapshot-runtime');
const { useRegisterTabTitle } = await import('../../../src/components/tabs/use-register-tab-title');

const ORG = '01JAAAAAAAAAAAAAAAAAAAAAAA';
const PROJECT = '01JBBBBBBBBBBBBBBBBBBBBBBB';

/** Mount the store over a client the test controls. */
function harness(client: QueryClient) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <OpenDocumentsProvider userId="user_1">{children}</OpenDocumentsProvider>
    </QueryClientProvider>
  );
  return renderHook(() => useOpenDocuments(), { wrapper });
}

beforeEach(async () => {
  await purgeAllNavigationSnapshots();
  sessionStorage.clear();
  resolveTabTitle.mockReset();
  resolveTabTitle.mockResolvedValue(null);
  pathname = `/orgs/${ORG}/projects/${PROJECT}`;
});

describe('an unnamed tab', () => {
  it('never puts the document id in its label', async () => {
    const client = new QueryClient();
    const { result } = harness(client);

    await waitFor(() => {
      expect(result.current.tabs).toHaveLength(1);
    });
    const tab = assertDefined(result.current.tabs[0]);

    expect(tab.title).toBeNull();
    expect(tabLabel(tab)).toBe('Project');
    // The specific regression: an id is not a name, and a reader learns nothing from six
    // characters of one.
    expect(tabLabel(tab)).not.toContain(PROJECT.slice(0, 6));
  });

  it('is not remembered as named, so the next visit tries again', async () => {
    const client = new QueryClient();
    const { result } = harness(client);
    await waitFor(() => {
      expect(result.current.tabs).toHaveLength(1);
    });

    const stored: unknown = JSON.parse(sessionStorage.getItem('docket:open-tabs:user_1') ?? '[]');
    // A failed resolve used to be persisted as a title like any other, so an id-shaped label
    // outlived the request that produced it and survived every reload for the session.
    expect((stored as OpenTab[])[0]?.title).toBeNull();
    expect((stored as OpenTab[])[0]).not.toHaveProperty('href');
    expect((stored as OpenTab[])[0]).not.toHaveProperty('key');
  });
});

describe('a tab whose document is already cached', () => {
  it('is named without issuing a request', async () => {
    const client = new QueryClient();
    client.setQueryData(projectRecordDef(ORG, PROJECT).queryKey, {
      id: PROJECT,
      name: 'Rewrite onboarding',
    } as unknown as ProjectOut);

    const { result } = harness(client);

    await waitFor(() => {
      expect(result.current.tabs[0]?.title).toBe('Rewrite onboarding');
    });
    // Arriving from a list, from search, or from the composer that just created the document
    // means the answer is already on the client. Fetching it again is a round trip spent showing
    // the reader something other than the name.
    expect(resolveTabTitle).not.toHaveBeenCalled();
  });

  it('uses the typed navigation snapshot without a title request', async () => {
    const client = new QueryClient();
    seedNavigationSnapshot(
      ProjectNavigationSnapshot.parse({
        target: 'project',
        organizationId: ORG,
        id: PROJECT,
        name: 'Rewrite onboarding',
        status: 'planned',
        priority: 'none',
        health: null,
        updatedAt: '2026-08-24T00:00:00.000Z',
      }),
    );

    const { result } = harness(client);

    await waitFor(() => {
      expect(result.current.tabs[0]?.title).toBe('Rewrite onboarding');
    });
    expect(resolveTabTitle).not.toHaveBeenCalled();
  });
});

describe('a tab whose document is renamed', () => {
  it('follows the name its detail page reports', async () => {
    const client = new QueryClient();
    let tabs: readonly OpenTab[] = [];

    /** Stands in for a detail page: publishes whatever name it is currently showing. */
    function Detail({ name }: { name: string }): null {
      useRegisterTabTitle('project', ORG, PROJECT, name);
      tabs = useOpenDocuments().tabs;
      return null;
    }

    const view = render(
      <QueryClientProvider client={client}>
        <OpenDocumentsProvider userId="user_1">
          <Detail name="Rewrite onboarding" />
        </OpenDocumentsProvider>
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(tabs[0]?.title).toBe('Rewrite onboarding');
    });

    view.rerender(
      <QueryClientProvider client={client}>
        <OpenDocumentsProvider userId="user_1">
          <Detail name="Onboarding, rewritten" />
        </OpenDocumentsProvider>
      </QueryClientProvider>,
    );

    // Nothing previously told the store a document had been renamed, so every open tab kept the
    // title it was first given for as long as it stayed open.
    await waitFor(() => {
      expect(tabs[0]?.title).toBe('Onboarding, rewritten');
    });
  });
});
