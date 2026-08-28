import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as ResolveTitleModule from '../../../src/components/tabs/resolve-title';

const push = vi.fn();
const ORG = '01JAAAAAAAAAAAAAAAAAAAAAAA';
const PROJECT = '01JBBBBBBBBBBBBBBBBBBBBBBB';
const TASK = '01JCCCCCCCCCCCCCCCCCCCCCCC';
const INITIATIVE = '01JDDDDDDDDDDDDDDDDDDDDDDD';
const CYCLE = '01JEEEEEEEEEEEEEEEEEEEEEEE';

let pathname = `/orgs/${ORG}/projects/${PROJECT}`;

vi.mock('../../../src/components/tabs/resolve-title', async (importOriginal) => {
  const actual = await importOriginal<typeof ResolveTitleModule>();
  return { ...actual, resolveTabTitle: vi.fn().mockResolvedValue(null) };
});
vi.mock('../../../src/lib/app-location', () => ({ useAppPathname: () => pathname }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

const { OpenDocumentsProvider, useOpenDocuments } =
  await import('../../../src/components/tabs/open-documents');
const { parseTabRef, tabKey } = await import('../../../src/components/tabs/types');

function href(type: 'projects' | 'tasks' | 'initiatives' | 'cycles', id: string): string {
  return `/orgs/${ORG}/${type}/${id}`;
}

function harness() {
  const client = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <OpenDocumentsProvider userId="user_1">{children}</OpenDocumentsProvider>
    </QueryClientProvider>
  );
  return renderHook(() => useOpenDocuments(), { wrapper });
}

beforeEach(() => {
  sessionStorage.clear();
  push.mockReset();
  pathname = href('projects', PROJECT);
});

describe('recent document navigation', () => {
  it('keeps the three newest unique documents in navigation order', async () => {
    const view = harness();
    await waitFor(() => {
      expect(view.result.current.recentDocuments.map(({ id }) => id)).toEqual([PROJECT]);
    });

    for (const next of [
      href('tasks', TASK),
      href('initiatives', INITIATIVE),
      href('cycles', CYCLE),
    ]) {
      pathname = next;
      view.rerender();
    }
    await waitFor(() => {
      expect(view.result.current.recentDocuments.map(({ id }) => id)).toEqual([
        CYCLE,
        INITIATIVE,
        TASK,
      ]);
    });

    pathname = href('tasks', TASK);
    view.rerender();
    await waitFor(() => {
      expect(view.result.current.recentDocuments.map(({ id }) => id)).toEqual([
        TASK,
        CYCLE,
        INITIATIVE,
      ]);
    });
  });

  it('persists recents separately and keeps them after closing a tab', async () => {
    pathname = href('tasks', TASK);
    const { result } = harness();
    await waitFor(() => {
      expect(result.current.recentDocuments[0]?.id).toBe(TASK);
    });

    act(() => {
      result.current.registerTitle(parseTabRef('task', ORG, TASK), 'Write launch notes');
    });
    await waitFor(() => {
      expect(result.current.recentDocuments[0]?.title).toBe('Write launch notes');
    });

    act(() => {
      result.current.closeTab(tabKey(parseTabRef('task', ORG, TASK)));
    });
    expect(result.current.recentDocuments[0]).toMatchObject({
      id: TASK,
      title: 'Write launch notes',
    });

    const stored: unknown = JSON.parse(
      sessionStorage.getItem('docket:recent-documents:user_1') ?? '[]',
    );
    expect(stored).toEqual([
      expect.objectContaining({ type: 'task', orgId: ORG, id: TASK, title: 'Write launch notes' }),
    ]);
  });
});
