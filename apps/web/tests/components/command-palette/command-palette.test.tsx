import '@testing-library/jest-dom/vitest';

import { ContextProvider } from '@docket/ui/components';
import { LabelId, OrganizationId } from '@docket/types';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CommandPalette } from '@/components/command-palette/command-palette';
import { makeQueryWrapper } from '../../support/query';

afterEach(() => {
  vi.restoreAllMocks();
});

// jsdom has no layout engine, so `Element.scrollIntoView` is unimplemented — the palette's
// active-row-follows-selection effect calls it on every render, same polyfill as
// `composer-reset.test.tsx` and `shell-first-paint.test.tsx`.
Element.prototype.scrollIntoView = vi.fn();

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}));

const ORG = OrganizationId.parse('01HZX5K3QJ9F8B7C6D5E4F3G2H');
const BUG = LabelId.parse('01ARZ3NDEKTSV4RRFFQ69G5FA1');

// `command-palette.tsx` is imported statically below, so a per-test `vi.doMock` +
// dynamic-`import()` swap (as `sub-modes.test.ts` uses for its standalone hook) would need
// `vi.resetModules()` — which also forces a fresh `@docket/ui/components` module instance, and
// with it a *different* `ContextProvider` React Context object than the one this file's static
// `ContextProvider` import wraps `render()` with, so `useContextState` inside the freshly
// re-imported tree would throw "must be used within a ContextProvider" even though a provider is
// clearly rendered. A mutable, `vi.hoisted`-backed mock sidesteps that entirely: one real module
// instance, and each test just points `activeOrgState.activeOrgId` at what it needs first.
const activeOrgState = vi.hoisted(() => ({ activeOrgId: null as string | null }));

vi.mock('@/components/active-org', () => ({
  useActiveOrg: () => ({
    orgs: [],
    get activeOrgId() {
      return activeOrgState.activeOrgId;
    },
    orgName: () => 'Acme',
  }),
}));

// The app shell normally provides creation context. These tests isolate label-search sub-modes,
// so keep create actions inert while retaining the command palette's real action composition.
vi.mock('@/components/create-object/create-object-provider', () => ({
  useCreateObject: () => ({ request: null, openCreate: vi.fn(), closeCreate: vi.fn() }),
}));

vi.mock('@/components/settings/use-can-manage-org', () => ({
  useCanManageOrg: () => ({ canManage: true, canContribute: true, loading: false }),
}));

const SEARCH_GET = vi.fn().mockResolvedValue({
  ok: true,
  status: 200,
  json: () => Promise.resolve({ items: [] }),
});
const EMPTY_SEARCH_RESPONSE = {
  ok: true,
  status: 200,
  json: () => Promise.resolve({ items: [] }),
};
const LABELS_GET = vi.fn().mockResolvedValue({
  ok: true,
  status: 200,
  json: () =>
    Promise.resolve({
      items: [
        {
          id: BUG,
          organizationId: ORG,
          name: 'Bug',
          color: '#ef4444',
          teamId: null,
          createdAt: '2026-08-01T00:00:00.000Z',
        },
      ],
    }),
});

vi.mock('@/lib/api', () => ({
  api: {
    v1: {
      hub: { search: { $get: (...args: unknown[]) => SEARCH_GET(...args) } },
      orgs: {
        ':orgId': {
          search: { $get: (...args: unknown[]) => SEARCH_GET(...args) },
          labels: { $get: (...args: unknown[]) => LABELS_GET(...args) },
        },
      },
    },
  },
}));

// `vi.restoreAllMocks` (above) only restores `vi.spyOn` spies back to their original
// implementation; it does not clear a plain `vi.fn()`'s call history or reset its
// `mockResolvedValue`. `SEARCH_GET`/`LABELS_GET`/`push` are plain `vi.fn()`s shared across every
// test in this file, so without an explicit clear each test would see the previous test's calls
// still on the mock.
beforeEach(() => {
  SEARCH_GET.mockReset().mockResolvedValue(EMPTY_SEARCH_RESPONSE);
  LABELS_GET.mockClear();
  push.mockClear();
});

function renderPalette() {
  activeOrgState.activeOrgId = ORG;
  const { wrapper: QueryWrapper } = makeQueryWrapper();
  const onClose = vi.fn();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryWrapper>
      <ContextProvider initialContext={ORG}>{children}</ContextProvider>
    </QueryWrapper>
  );
  render(<CommandPalette open onClose={onClose} />, { wrapper });
  return { onClose };
}

describe('CommandPalette — # label sub-mode', () => {
  it('finds a Settings section through its catalog metadata', async () => {
    renderPalette();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'security' } });

    const label = await screen.findByText('Security', { selector: 'span.w-full.truncate' });
    const row = label.closest('[role="option"]');
    expect(row).toBeInstanceOf(HTMLElement);
    if (!(row instanceof HTMLElement)) {
      throw new Error('Security result did not render inside an option.');
    }
    expect(within(row).queryByText('Setting', { exact: true })).not.toBeInTheDocument();
    fireEvent.click(row);

    expect(push).toHaveBeenCalledWith('/settings/security');
  });

  it('opens a Settings group through its stable route fragment', async () => {
    renderPalette();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'passkeys' } });

    const row = await screen.findByRole('option', { name: /Passkeys/ });
    expect(row).toHaveTextContent('Settings › Security');
    fireEvent.click(row);

    expect(push).toHaveBeenCalledWith(
      '/settings/security?route-focus=settings-passkeys#settings-passkeys',
    );
  });

  it('focuses a route-fragment destination after navigation mounts it', async () => {
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
    const heading = document.createElement('h3');
    heading.id = 'settings-passkeys';
    heading.tabIndex = -1;
    heading.textContent = 'Mounted passkeys';
    push.mockImplementationOnce((href: string) => {
      window.history.replaceState(null, '', href);
      document.body.append(heading);
    });
    renderPalette();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'passkeys' } });
    fireEvent.click(await screen.findByRole('option', { name: /Passkeys/ }));
    act(() => {
      while (frames.length > 0) frames.shift()?.(0);
    });

    expect(heading).toHaveFocus();
    heading.remove();
  });

  it('does not restore focus to the opener after selecting a destination', async () => {
    activeOrgState.activeOrgId = ORG;
    const opener = document.createElement('button');
    opener.textContent = 'Open search';
    document.body.append(opener);
    opener.focus();
    const { wrapper: QueryWrapper } = makeQueryWrapper();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryWrapper>
        <ContextProvider initialContext={ORG}>{children}</ContextProvider>
      </QueryWrapper>
    );
    const onClose = vi.fn();
    const view = render(<CommandPalette open onClose={onClose} />, { wrapper });
    const input = screen.getByRole('combobox');
    await waitFor(() => {
      expect(input).toHaveFocus();
    });
    fireEvent.change(input, { target: { value: 'passkeys' } });
    fireEvent.click(await screen.findByRole('option', { name: /Passkeys/ }));
    view.rerender(<CommandPalette open={false} onClose={onClose} />);

    expect(opener).not.toHaveFocus();
    opener.remove();
  });

  it('keeps query-only Settings entries out of the idle browse state', () => {
    renderPalette();

    expect(screen.queryByRole('option', { name: /Passkeys/ })).not.toBeInTheDocument();
  });

  it('keeps local Settings matches usable when remote search fails', async () => {
    SEARCH_GET.mockRejectedValue(new Error('search unavailable'));
    renderPalette();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'security' } });

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not search your workspace.');
    const label = screen.getByText('Security', { selector: 'span.w-full.truncate' });
    const row = label.closest('[role="option"]');
    expect(row).not.toBeNull();
    if (!row) throw new Error('Security result did not render inside an option.');
    fireEvent.click(row);

    expect(push).toHaveBeenCalledWith('/settings/security');
  });

  it('enters the labels mode on #, suppressing hub search and static commands', async () => {
    renderPalette();
    const beforeTypingCalls = SEARCH_GET.mock.calls.length;
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: '#bu' } });

    await waitFor(() => {
      expect(screen.getByRole('option', { name: /Bug/ })).toBeInTheDocument();
    });
    // The search endpoint is never hit *because of* entering mode (any call already in flight
    // from the initial empty-box "recents" mount fetch, before the user typed `#`, is unrelated).
    expect(SEARCH_GET.mock.calls.length).toBe(beforeTypingCalls);
  });

  it('navigates to the filtered task list and closes on selecting a label', async () => {
    const { onClose } = renderPalette();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '#bug' } });
    const row = await screen.findByRole('option', { name: /Bug/ });
    fireEvent.click(row);

    expect(push).toHaveBeenCalledWith(`/orgs/${ORG}/tasks?filter=labels%3Aeq%3A${BUG}`);
    expect(onClose).toHaveBeenCalled();
  });

  it('exits the mode on Escape without closing the palette', async () => {
    const { onClose } = renderPalette();
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: '#bug' } });
    await screen.findByRole('option', { name: /Bug/ });

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    expect(input).toHaveValue('');

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('exits the mode when backspacing the prefix away', async () => {
    renderPalette();
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: '#bug' } });
    await screen.findByRole('option', { name: /Bug/ });
    fireEvent.change(input, { target: { value: '' } });
    await waitFor(() => {
      expect(screen.queryByRole('option', { name: /Bug/ })).not.toBeInTheDocument();
    });
  });

  it('wraps the label swatch in a flex container so its explicit size actually applies', async () => {
    renderPalette();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '#bug' } });
    const row = await screen.findByRole('option', { name: /Bug/ });

    // The swatch (a bare `<span>` sized via `size-2.5`) is an empty inline element -- `width`
    // and `height` never apply to inline elements, only to block or flex-item boxes. Its
    // wrapper must therefore itself be `flex` (making the swatch a flex item) or the swatch
    // renders at 0x0, invisible. jsdom does no real layout, so this asserts on the class that
    // produces that layout rather than on measured pixels.
    const swatchWrapper = row.querySelector('span[aria-hidden="true"]');
    expect(swatchWrapper).not.toBeNull();
    expect(swatchWrapper).toHaveClass('flex');
  });
});

describe('CommandPalette — # with no bound organization', () => {
  it('shows an explanatory row instead of an empty list', async () => {
    activeOrgState.activeOrgId = null;
    const { wrapper: QueryWrapper } = makeQueryWrapper();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryWrapper>
        <ContextProvider initialContext={null}>{children}</ContextProvider>
      </QueryWrapper>
    );
    render(<CommandPalette open onClose={vi.fn()} />, { wrapper });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '#' } });

    expect(await screen.findByText(/open a workspace/i)).toBeInTheDocument();
    expect(LABELS_GET).not.toHaveBeenCalled();
  });
});
