/**
 * Keyboard behavior for Athena's persistent open-document tabs.
 *
 * The tab strip is browser-like, but document switching must remain in Athena rather than falling
 * through to browser navigation. These tests exercise the provider because it owns tab order,
 * routing, and the close-to-neighbor contract.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const push = vi.fn();
let pathname = '/orgs/01JAAAAAAAAAAAAAAAAAAAAAAA/projects/01JBBBBBBBBBBBBBBBBBBBBBBB';

vi.mock('../../../src/components/tabs/resolve-title', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/components/tabs/resolve-title')>();
  return { ...actual, resolveTabTitle: vi.fn().mockResolvedValue(null) };
});
vi.mock('../../../src/lib/app-location', () => ({
  useAppPathname: () => pathname,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

const { OpenDocumentsProvider, useOpenDocuments } =
  await import('../../../src/components/tabs/open-documents');

const ORG = '01JAAAAAAAAAAAAAAAAAAAAAAA';
const PROJECT = '01JBBBBBBBBBBBBBBBBBBBBBBB';
const TASK = '01JCCCCCCCCCCCCCCCCCCCCCCC';
const INITIATIVE = '01JDDDDDDDDDDDDDDDDDDDDDDD';

function href(type: 'project' | 'task' | 'initiative', id: string): string {
  return `/orgs/${ORG}/${type}s/${id}`;
}

function storeTabs(): void {
  sessionStorage.setItem(
    'docket:open-tabs:user_1',
    JSON.stringify([
      {
        key: `project:${ORG}:${PROJECT}`,
        type: 'project',
        orgId: ORG,
        id: PROJECT,
        title: 'Project one',
        href: href('project', PROJECT),
      },
      {
        key: `task:${ORG}:${TASK}`,
        type: 'task',
        orgId: ORG,
        id: TASK,
        title: 'Task two',
        href: href('task', TASK),
      },
      {
        key: `initiative:${ORG}:${INITIATIVE}`,
        type: 'initiative',
        orgId: ORG,
        id: INITIATIVE,
        title: 'Initiative three',
        href: href('initiative', INITIATIVE),
      },
    ]),
  );
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

function keydown(init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  document.dispatchEvent(event);
  return event;
}

beforeEach(() => {
  sessionStorage.clear();
  push.mockReset();
  pathname = href('project', PROJECT);
  storeTabs();
});

describe('open-document tab shortcuts', () => {
  it('cycles to the adjacent tab with the Linear-style forward shortcut', async () => {
    const { result } = harness();
    await waitFor(() => expect(result.current.tabs).toHaveLength(3));

    let event: KeyboardEvent;
    act(() => {
      event = keydown({ key: 'ArrowRight', metaKey: true, altKey: true });
    });

    expect(push).toHaveBeenCalledWith(href('task', TASK));
    expect(event!.defaultPrevented).toBe(true);
  });

  it('wraps backward from the first tab to the last tab', async () => {
    const { result } = harness();
    await waitFor(() => expect(result.current.tabs).toHaveLength(3));

    act(() => {
      keydown({ key: 'ArrowLeft', metaKey: true, altKey: true });
    });

    expect(push).toHaveBeenCalledWith(href('initiative', INITIATIVE));
  });

  it('opens the first or last tab from a non-document page', async () => {
    pathname = '/today';
    const { result } = harness();
    await waitFor(() => expect(result.current.tabs).toHaveLength(3));

    act(() => {
      keydown({ key: 'ArrowRight', metaKey: true, altKey: true });
    });
    expect(push).toHaveBeenLastCalledWith(href('project', PROJECT));

    act(() => {
      keydown({ key: 'ArrowLeft', ctrlKey: true, altKey: true });
    });
    expect(push).toHaveBeenLastCalledWith(href('initiative', INITIATIVE));
  });

  it('closes the active document with the platform close shortcut', async () => {
    pathname = href('task', TASK);
    const { result } = harness();
    await waitFor(() => expect(result.current.activeKey).toBe(`task:${ORG}:${TASK}`));

    let event: KeyboardEvent;
    act(() => {
      event = keydown({ key: 'w', metaKey: true });
    });

    expect(result.current.tabs.map((tab) => tab.id)).toEqual([PROJECT, INITIATIVE]);
    expect(push).toHaveBeenCalledWith(href('initiative', INITIATIVE));
    expect(event!.defaultPrevented).toBe(true);
  });

  it('accepts Control+W as the non-Apple close shortcut', async () => {
    pathname = href('task', TASK);
    const { result } = harness();
    await waitFor(() => expect(result.current.activeKey).toBe(`task:${ORG}:${TASK}`));

    act(() => {
      keydown({ key: 'w', ctrlKey: true });
    });

    expect(result.current.tabs.map((tab) => tab.id)).toEqual([PROJECT, INITIATIVE]);
    expect(push).toHaveBeenCalledWith(href('initiative', INITIATIVE));
  });

  it('does not close a document when Control+W has an extra modifier', async () => {
    pathname = href('task', TASK);
    const { result } = harness();
    await waitFor(() => expect(result.current.activeKey).toBe(`task:${ORG}:${TASK}`));

    const event = keydown({ key: 'w', ctrlKey: true, altKey: true });

    expect(result.current.tabs).toHaveLength(3);
    expect(push).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('leaves repeated, composing, and already-handled tab shortcuts alone', async () => {
    const { result } = harness();
    await waitFor(() => expect(result.current.tabs).toHaveLength(3));

    const repeated = keydown({ key: 'ArrowRight', metaKey: true, altKey: true, repeat: true });
    const composing = keydown({ key: 'ArrowRight', metaKey: true, altKey: true, isComposing: true });
    const handled = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'ArrowRight',
      metaKey: true,
      altKey: true,
    });
    handled.preventDefault();
    document.dispatchEvent(handled);

    expect(push).not.toHaveBeenCalled();
    expect(repeated.defaultPrevented).toBe(false);
    expect(composing.defaultPrevented).toBe(false);
    expect(handled.defaultPrevented).toBe(true);
  });
});
