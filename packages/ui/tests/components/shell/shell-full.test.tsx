import '@testing-library/jest-dom/vitest';

import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Home } from '../../../src/icons';
import { AppShell } from '../../../src/components/shell/AppShell';
import {
  ContextProvider,
  useContextState,
  type ActiveContext,
} from '../../../src/components/shell/ContextProvider';
import { ShellDrawerProvider } from '../../../src/components/shell/ShellDrawerContext';
import { Sidebar } from '../../../src/components/shell/Sidebar';
import { SidebarNavItem } from '../../../src/components/shell/SidebarNavItem';
import { TabBar, type OpenTab } from '../../../src/components/shell/TabBar';
import { WorkspaceSwitcher } from '../../../src/components/shell/WorkspaceSwitcher';
import type { Workspace } from '../../../src/components/shell/workspaces';

const ACME: Workspace = { id: 'ORG00000000000000000000001', name: 'Acme Co' };
const GLOBEX: Workspace = { id: 'ORG00000000000000000000002', name: 'Globex' };
const PERSONAL: Workspace = { id: 'ORG00000000000000000000009', name: 'My Space' };
const WORKSPACES: readonly Workspace[] = [ACME, GLOBEX, PERSONAL];

/**
 * A test `renderLink` that mirrors the host's Next `Link` (a real anchor).
 *
 * @remarks
 * Accepts the optional `className` the {@link TabBar} hands its anchors so the link becomes the
 * flexing child of the tab row (matching the production `renderLink`). The sidebar calls it with
 * two args and the class is simply absent.
 */
function renderLink(href: string, content: React.ReactNode, className?: string): React.ReactNode {
  return (
    <a
      href={href}
      className={className}
      onClick={(event) => {
        event.preventDefault();
      }}
    >
      {content}
    </a>
  );
}

/** The full set of href builders a {@link Sidebar} needs. */
function sidebarHrefs() {
  return {
    hrefForHome: (key: 'today' | 'tasks' | 'calendar' | 'inbox' | 'stream' | 'portfolio') =>
      `/${key}`,
    hrefForWorkspace: (orgId: string, key: string) => `/orgs/${orgId}/${key}`,
    renderLink,
    onCreateWorkspace: () => undefined,
  };
}

function ctxWrapper(initial: ActiveContext) {
  return function Wrapper({ children }: { children: React.ReactNode }): React.JSX.Element {
    return <ContextProvider initialContext={initial}>{children}</ContextProvider>;
  };
}

function ContextRebindControls(): React.JSX.Element {
  const { setContext } = useContextState();
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setContext(ACME.id);
        }}
      >
        Resolve Acme
      </button>
      <button
        type="button"
        onClick={() => {
          setContext(GLOBEX.id);
        }}
      >
        Switch to Globex
      </button>
    </>
  );
}

describe('ContextProvider / useContextState', () => {
  it('defaults to no bound org with no accent and comfortable density', () => {
    const { result } = renderHook(() => useContextState(), { wrapper: ctxWrapper(null) });
    expect(result.current.activeOrgId).toBeNull();
    expect(result.current.orgAccent).toBeNull();
    expect(result.current.density).toBe('comfortable');
  });

  it('derives an org accent when an org is bound', () => {
    const { result } = renderHook(() => useContextState(), { wrapper: ctxWrapper(ACME.id) });
    expect(result.current.activeOrgId).toBe(ACME.id);
    expect(result.current.orgAccent).toMatch(/^oklch/);
  });

  it('setContext rebinds and setDensity updates density', () => {
    const { result } = renderHook(() => useContextState(), { wrapper: ctxWrapper(null) });
    act(() => {
      result.current.setContext(ACME.id);
    });
    expect(result.current.activeOrgId).toBe(ACME.id);
    act(() => {
      result.current.setDensity('compact');
    });
    expect(result.current.density).toBe('compact');
  });

  it('throws when used outside a provider', () => {
    expect(() => renderHook(() => useContextState())).toThrow(
      'useContextState must be used within a <ContextProvider>.',
    );
  });
});

describe('AppShell', () => {
  it('keeps the first resolved org steady and cross-fades a later org switch', () => {
    render(
      <ContextProvider initialContext={null}>
        <ContextRebindControls />
        <AppShell sidebar={<nav aria-label="Navigation" />}>
          <div>Main</div>
        </AppShell>
      </ContextProvider>,
    );
    const main = screen.getByRole('main');

    fireEvent.click(screen.getByRole('button', { name: 'Resolve Acme' }));
    expect(main).not.toHaveClass('animate-org-rebind');

    fireEvent.click(screen.getByRole('button', { name: 'Switch to Globex' }));
    expect(main).toHaveClass('animate-org-rebind');
  });

  it('applies --org-accent and data-density when an org is bound, around sidebar + tab bar', () => {
    const { container } = render(
      <ContextProvider initialContext={ACME.id} initialDensity="compact">
        <AppShell sidebar={<nav aria-label="Navigation">side</nav>} tabBar={<div>tabs</div>}>
          <div>Main</div>
        </AppShell>
      </ContextProvider>,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveAttribute('data-density', 'compact');
    expect(root.style.getPropertyValue('--org-accent')).toMatch(/oklch/);
    expect(screen.getByText('Main')).toBeInTheDocument();
    expect(screen.getByText('tabs')).toBeInTheDocument();
  });

  it('omits the --org-accent variable when no org is bound', () => {
    const { container } = render(
      <ContextProvider initialContext={null}>
        <AppShell sidebar={<nav aria-label="Navigation" />} className="shell-x">
          <div>No-org main</div>
        </AppShell>
      </ContextProvider>,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.style.getPropertyValue('--org-accent')).toBe('');
    expect(root).toHaveClass('shell-x');
  });

  it('is the tinted MD3 canvas, floating the main surface panel with a gutter on desktop only', () => {
    const { container } = render(
      <ContextProvider initialContext={null}>
        <AppShell sidebar={<nav aria-label="Navigation" />}>
          <div>Main</div>
        </AppShell>
      </ContextProvider>,
    );
    // Root = the tinted canvas tone (surface-container). The uniform gutter that floats the
    // panels is a DESKTOP affordance (`lg:p-2`) so mobile content can go full-bleed; the canvas
    // is never the old flat bg-background, and never bg-card/bg-background again.
    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveClass('bg-surface-container', 'text-on-surface', 'lg:p-2');
    expect(root).not.toHaveClass('bg-background', 'bg-card');
    // The main content is the single distinct surface panel: it carries the panel surface tone
    // always, and the rounded/bordered/elevated panel chrome at the desktop breakpoint, going
    // full-bleed (no rounding/border) below `lg`.
    const main = screen.getByRole('main');
    expect(main).toHaveClass('bg-surface', 'lg:rounded-xl', 'lg:border-outline-variant');
    expect(main).not.toHaveClass('bg-background', 'bg-card');
  });

  it('renders a mobile menu trigger and the static desktop sidebar (the same nav node)', () => {
    render(
      <ContextProvider initialContext={null}>
        <AppShell sidebar={<nav aria-label="Navigation">side</nav>}>
          <div>Main</div>
        </AppShell>
      </ContextProvider>,
    );
    // A hamburger affordance opens the off-canvas drawer below `lg`.
    expect(screen.getByRole('button', { name: 'Open navigation' })).toBeInTheDocument();
    // The static (desktop) sidebar node is mounted; the drawer's copy is not until opened.
    expect(screen.getByRole('navigation', { name: 'Navigation' })).toBeInTheDocument();
  });

  it('opens the off-canvas drawer from the hamburger and closes it on Escape', async () => {
    render(
      <ContextProvider initialContext={null}>
        <AppShell sidebar={<nav aria-label="Navigation">drawer side</nav>}>
          <div>Main</div>
        </AppShell>
      </ContextProvider>,
    );
    const trigger = screen.getByRole('button', { name: 'Open navigation' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    // Opening surfaces a focus-trapped dialog drawer (Radix Sheet) labelled "Navigation".
    fireEvent.click(trigger);
    const drawer = await screen.findByRole('dialog', { name: 'Navigation' });
    expect(drawer).toBeInTheDocument();
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    // Esc dismisses it (Radix focus trap → return focus + close).
    fireEvent.keyDown(drawer, { key: 'Escape' });
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Navigation' })).not.toBeInTheDocument(),
    );
  });

  it('closes the drawer when a nav row inside it is selected (the real Sidebar in the drawer)', async () => {
    render(
      <ContextProvider initialContext={ACME.id}>
        <AppShell
          sidebar={
            <Sidebar
              workspaces={WORKSPACES}
              {...sidebarHrefs()}
              onSelectWorkspace={() => undefined}
              onOpenSearch={() => undefined}
            />
          }
        >
          <div>Main</div>
        </AppShell>
      </ContextProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }));
    const drawer = await screen.findByRole('dialog', { name: 'Navigation' });

    // The drawer hosts the SAME sidebar; selecting a nav row dismisses the drawer.
    const myWork = within(drawer).getByRole('link', { name: 'My Work' });
    fireEvent.click(myWork);
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Navigation' })).not.toBeInTheDocument(),
    );
  });
});

describe('Sidebar', () => {
  it('renders the Home section + the active org Workspace section, both always present', () => {
    render(
      <ContextProvider initialContext={ACME.id}>
        <Sidebar
          workspaces={WORKSPACES}
          activeWorkspaceKey="projects"
          {...sidebarHrefs()}
          onSelectWorkspace={() => undefined}
          onOpenSearch={() => undefined}
        />
      </ContextProvider>,
    );
    // Home section (cross-org) is always present.
    expect(screen.getByRole('link', { name: 'Today' })).toHaveAttribute('href', '/today');
    expect(screen.getByRole('link', { name: 'Calendar' })).toHaveAttribute('href', '/calendar');
    expect(screen.getByRole('link', { name: 'Portfolio' })).toHaveAttribute('href', '/portfolio');
    expect(screen.getByRole('button', { name: 'Search' })).toBeInTheDocument();

    // Workspace section (org-scoped) — entity rows fall back to the startup preset here.
    const projects = screen.getByRole('link', { name: 'Projects' });
    expect(projects).toHaveAttribute('href', `/orgs/${ACME.id}/projects`);
    expect(projects).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'My Work' })).toHaveAttribute(
      'href',
      `/orgs/${ACME.id}/my-work`,
    );
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute(
      'href',
      `/orgs/${ACME.id}/settings`,
    );
    expect(screen.queryByRole('link', { name: 'Athena' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Agents' })).not.toBeInTheDocument();
  });

  it('blends into the canvas — no separate-container chrome (fill, border, rounding, shadow)', () => {
    render(
      <ContextProvider initialContext={ACME.id}>
        <Sidebar
          workspaces={WORKSPACES}
          {...sidebarHrefs()}
          onSelectWorkspace={() => undefined}
          onOpenSearch={() => undefined}
        />
      </ContextProvider>,
    );
    const aside = screen.getByRole('complementary', { name: 'Navigation' });
    // The nav reads as part of the background: it shares the canvas tone (only `text-on-surface`
    // for legibility) and carries NO distinct-panel chrome — no surface fill, no border (of any
    // edge), no rounding, no elevation. Only the `<main>` content stays a distinct panel.
    expect(aside).toHaveClass('text-on-surface');
    expect(aside).not.toHaveClass(
      'bg-surface',
      'bg-card',
      'bg-background',
      'border',
      'border-r',
      'border-outline-variant',
      'rounded-xl',
      'shadow-sm',
    );
  });

  it('closes the drawer on a nav selection when rendered inside a drawer provider', () => {
    const dismiss = vi.fn();
    render(
      <ContextProvider initialContext={ACME.id}>
        <ShellDrawerProvider dismiss={dismiss}>
          <Sidebar
            workspaces={WORKSPACES}
            {...sidebarHrefs()}
            onSelectWorkspace={() => undefined}
            onOpenSearch={() => undefined}
          />
        </ShellDrawerProvider>
      </ContextProvider>,
    );
    // Selecting any nav row inside the drawer dismisses it so the destination is visible.
    fireEvent.click(screen.getByRole('link', { name: 'My Work' }));
    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  it('does not dismiss anything when rendered as the static (non-drawer) sidebar', () => {
    // No drawer provider → `useShellDrawer()` is null → a nav click is a no-op dismissal.
    render(
      <ContextProvider initialContext={ACME.id}>
        <Sidebar
          workspaces={WORKSPACES}
          {...sidebarHrefs()}
          onSelectWorkspace={() => undefined}
          onOpenSearch={() => undefined}
        />
      </ContextProvider>,
    );
    // Clicking a row must not throw (there is simply no drawer to close on the static rail).
    fireEvent.click(screen.getByRole('link', { name: 'My Work' }));
    expect(screen.getByRole('link', { name: 'My Work' })).toBeInTheDocument();
  });

  it('shows the Workspace section on a cross-org route (no Hub mode swap)', () => {
    // No org in the path, but the host has resolved an active org for the context.
    render(
      <ContextProvider initialContext={ACME.id}>
        <Sidebar
          workspaces={WORKSPACES}
          activeHomeKey="today"
          {...sidebarHrefs()}
          onSelectWorkspace={() => undefined}
          onOpenSearch={() => undefined}
        />
      </ContextProvider>,
    );
    // The Home destination is highlighted…
    expect(screen.getByRole('link', { name: 'Today' })).toHaveAttribute('aria-current', 'page');
    // …and the Workspace section still reflects the active org (stable, never empty).
    expect(screen.getByRole('link', { name: 'Triage' })).toHaveAttribute(
      'href',
      `/orgs/${ACME.id}/triage`,
    );
  });

  it('folds the unread count into the Inbox row name', () => {
    render(
      <ContextProvider initialContext={ACME.id}>
        <Sidebar
          workspaces={WORKSPACES}
          unreadCount={4}
          {...sidebarHrefs()}
          onSelectWorkspace={() => undefined}
          onOpenSearch={() => undefined}
        />
      </ContextProvider>,
    );
    expect(screen.getByRole('link', { name: 'Inbox, 4 unread' })).toHaveAttribute('href', '/inbox');
  });

  it('opens the palette from the Search row', () => {
    const onOpenSearch = vi.fn();
    render(
      <ContextProvider initialContext={ACME.id}>
        <Sidebar
          workspaces={WORKSPACES}
          {...sidebarHrefs()}
          onSelectWorkspace={() => undefined}
          onOpenSearch={onOpenSearch}
        />
      </ContextProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(onOpenSearch).toHaveBeenCalledTimes(1);
  });

  it('shows the Teams row for a shared org (the default, non-personal workspace)', () => {
    render(
      <ContextProvider initialContext={ACME.id}>
        <Sidebar
          workspaces={WORKSPACES}
          {...sidebarHrefs()}
          onSelectWorkspace={() => undefined}
          onOpenSearch={() => undefined}
        />
      </ContextProvider>,
    );
    // A shared org organizes members into teams, so the Teams row is present and links out.
    expect(screen.getByRole('link', { name: 'Teams' })).toHaveAttribute(
      'href',
      `/orgs/${ACME.id}/teams`,
    );
  });

  it('omits ONLY the Teams row in a personal workspace, keeping every other row', () => {
    render(
      <ContextProvider initialContext={PERSONAL.id}>
        <Sidebar
          workspaces={WORKSPACES}
          personalWorkspace
          {...sidebarHrefs()}
          onSelectWorkspace={() => undefined}
          onOpenSearch={() => undefined}
        />
      </ContextProvider>,
    );
    // A personal space is the user's own space, not an org with members — no Teams row.
    expect(screen.queryByRole('link', { name: 'Teams' })).not.toBeInTheDocument();
    // Every other workspace-owned row stays — personal Athena lives in the global pulse.
    for (const name of ['My Work', 'Triage', 'Views', 'Settings']) {
      expect(screen.getByRole('link', { name })).toHaveAttribute(
        'href',
        `/orgs/${PERSONAL.id}/${name === 'My Work' ? 'my-work' : name.toLowerCase()}`,
      );
    }
  });

  it('never produces an /orgs/null href when no org is bound yet', () => {
    render(
      <ContextProvider initialContext={null}>
        <Sidebar
          workspaces={WORKSPACES}
          {...sidebarHrefs()}
          onSelectWorkspace={() => undefined}
          onOpenSearch={() => undefined}
        />
      </ContextProvider>,
    );
    for (const link of screen.getAllByRole('link')) {
      expect(link.getAttribute('href')).not.toContain('/orgs/null');
    }
    // The Workspace section degrades to a calm empty treatment rather than emitting bad hrefs.
    expect(screen.getByText('No workspace yet')).toBeInTheDocument();
  });
});

/** Open a Radix dropdown trigger in jsdom (pointerDown + click). */
function openMenu(trigger: HTMLElement): void {
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
  fireEvent.click(trigger);
}

describe('WorkspaceSwitcher', () => {
  it('shows the active org as the trigger and switches to another org on selection', async () => {
    const onSelect = vi.fn();
    render(
      <ContextProvider initialContext={ACME.id}>
        <WorkspaceSwitcher workspaces={WORKSPACES} onSelect={onSelect} onCreate={() => undefined} />
      </ContextProvider>,
    );
    openMenu(screen.getByRole('button', { name: /Workspace: Acme Co/ }));
    await waitFor(() => expect(screen.getByText('Globex')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Globex'));
    expect(onSelect).toHaveBeenCalledWith(GLOBEX.id);
  });

  it('lists every org uniformly with no personal/shared partition and no Hub entry', async () => {
    render(
      <ContextProvider initialContext={ACME.id}>
        <WorkspaceSwitcher
          workspaces={WORKSPACES}
          onSelect={() => undefined}
          onCreate={() => undefined}
        />
      </ContextProvider>,
    );
    openMenu(screen.getByRole('button', { name: /Workspace: Acme Co/ }));
    await waitFor(() =>
      expect(screen.getByRole('menuitem', { name: /Globex/ })).toBeInTheDocument(),
    );
    // No 'Hub' entry and no 'Personal' section header — one uniform list.
    expect(screen.queryByText('Hub')).not.toBeInTheDocument();
    expect(screen.queryByText('Personal')).not.toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /Acme Co/ })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /My Space/ })).toBeInTheDocument();
  });

  it('falls back to the first org as the trigger when none is bound yet', () => {
    render(
      <ContextProvider initialContext={null}>
        <WorkspaceSwitcher
          workspaces={WORKSPACES}
          onSelect={() => undefined}
          onCreate={() => undefined}
        />
      </ContextProvider>,
    );
    expect(screen.getByRole('button', { name: /Workspace: Acme Co/ })).toBeInTheDocument();
  });

  it('keeps workspace creation available when the caller has no orgs', async () => {
    const onCreate = vi.fn();
    render(
      <ContextProvider initialContext={null}>
        <WorkspaceSwitcher workspaces={[]} onSelect={() => undefined} onCreate={onCreate} />
      </ContextProvider>,
    );
    const trigger = screen.getByRole('button', { name: /Workspace: Workspace/ });
    expect(trigger).toBeEnabled();
    openMenu(trigger);
    await waitFor(() =>
      expect(screen.getByRole('menuitem', { name: 'Create workspace' })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole('menuitem', { name: 'Create workspace' }));
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it('opens workspace creation from the switcher menu', async () => {
    const onCreate = vi.fn();
    render(
      <ContextProvider initialContext={ACME.id}>
        <WorkspaceSwitcher workspaces={WORKSPACES} onSelect={() => undefined} onCreate={onCreate} />
      </ContextProvider>,
    );
    openMenu(screen.getByRole('button', { name: /Workspace: Acme Co/ }));
    await waitFor(() =>
      expect(screen.getByRole('menuitem', { name: 'Create workspace' })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole('menuitem', { name: 'Create workspace' }));
    expect(onCreate).toHaveBeenCalledTimes(1);
  });
});

describe('TabBar', () => {
  const TAB_A: OpenTab = {
    key: 'task:o1:t1',
    type: 'task',
    orgId: 'o1',
    id: 't1',
    title: 'Fix the build',
    href: '/orgs/o1/tasks/t1',
  };
  const TAB_B: OpenTab = {
    key: 'project:o1:p1',
    type: 'project',
    orgId: 'o1',
    id: 'p1',
    title: 'Q3 Launch',
    href: '/orgs/o1/projects/p1',
  };

  it('renders nothing when there are no open documents', () => {
    const { container } = render(
      <TabBar tabs={[]} renderLink={renderLink} onClose={() => undefined} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders each tab as a navigable link and marks the active one selected', () => {
    render(
      <TabBar
        tabs={[TAB_A, TAB_B]}
        activeKey={TAB_B.key}
        renderLink={renderLink}
        onClose={() => undefined}
      />,
    );
    expect(screen.getByRole('link', { name: 'Fix the build' })).toHaveAttribute(
      'href',
      '/orgs/o1/tasks/t1',
    );
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(2);
    const activeTab = screen.getByText('Q3 Launch').closest('[role="tab"]');
    expect(activeTab).toHaveAttribute('aria-selected', 'true');
  });

  it('closes a tab by key', () => {
    const onClose = vi.fn();
    render(
      <TabBar
        tabs={[TAB_A, TAB_B]}
        activeKey={TAB_A.key}
        renderLink={renderLink}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Close Q3 Launch' }));
    expect(onClose).toHaveBeenCalledWith(TAB_B.key);
  });

  it('is its own bar on the canvas, with each tab a detached floating pill', () => {
    const { container } = render(
      <TabBar
        tabs={[TAB_A, TAB_B]}
        activeKey={TAB_B.key}
        renderLink={renderLink}
        onClose={() => undefined}
      />,
    );
    // The bar reads as its own chrome on the canvas tone — not a panel surface, no divider border.
    const bar = container.firstElementChild as HTMLElement;
    expect(bar).toHaveClass('bg-surface-container');
    expect(bar).not.toHaveClass('bg-card', 'border-b');
    // Every tab is a fully-rounded floating pill, NOT welded to the panel below: no top-only
    // rounding, no self-stretch, no panel surface fill.
    const activeTab = screen.getByText('Q3 Launch').closest<HTMLElement>('[role="tab"]')!;
    const inactiveTab = screen.getByText('Fix the build').closest<HTMLElement>('[role="tab"]')!;
    for (const tab of [activeTab, inactiveTab]) {
      expect(tab).toHaveClass('rounded-lg');
      expect(tab).not.toHaveClass('rounded-t-lg', 'self-stretch', 'bg-surface');
    }
    // The active pill takes the selected secondary fill plus a shadow; the inactive pill stays
    // transparent and calm in the muted on-surface-variant.
    expect(activeTab).toHaveClass(
      'bg-secondary-container',
      'shadow-sm',
      'text-on-secondary-container',
    );
    expect(inactiveTab).toHaveClass('text-on-surface-variant');
    expect(inactiveTab).not.toHaveClass('bg-secondary-container', 'ring-1', 'shadow-sm');
  });

  it('gives each tab a fixed width with a flexing, truncating title and a right-pinned close', () => {
    render(
      <TabBar
        tabs={[TAB_A, TAB_B]}
        activeKey={TAB_A.key}
        renderLink={renderLink}
        onClose={() => undefined}
      />,
    );
    const tab = screen.getByText('Fix the build').closest<HTMLElement>('[role="tab"]')!;
    // Fixed width, never shrinks (so a crowded bar scrolls instead of squishing tabs).
    expect(tab).toHaveClass('w-40', 'shrink-0');
    // The title is the routing anchor itself, made the flexing child so it fills + truncates.
    const link = within(tab).getByRole('link', { name: 'Fix the build' });
    expect(link).toHaveClass('flex-1', 'min-w-0');
    // The title text node truncates with an ellipsis.
    expect(screen.getByText('Fix the build')).toHaveClass('truncate', 'min-w-0');
    // The close button is the last child of the tab and never shrinks, so it pins to the right
    // edge regardless of title length.
    const close = within(tab).getByRole('button', { name: 'Close Fix the build' });
    expect(close).toHaveClass('shrink-0');
    expect(tab.lastElementChild).toBe(close);
  });

  it('scrolls horizontally only — the strip never scrolls vertically or grows a second row', () => {
    const { container } = render(
      <TabBar
        tabs={[TAB_A, TAB_B]}
        activeKey={TAB_A.key}
        renderLink={renderLink}
        onClose={() => undefined}
      />,
    );
    // The outer bar is a fixed-height strip that clips overflow entirely.
    const bar = container.firstElementChild as HTMLElement;
    expect(bar).toHaveClass('h-10', 'overflow-hidden');
    // The scroll track scrolls on X but CLIPS Y, so a tall tab never makes the chrome scroll
    // vertically or wrap to a second row.
    const tablist = screen.getByRole('tablist', { name: 'Open documents' });
    expect(tablist).toHaveClass('overflow-x-auto', 'overflow-y-hidden');
    expect(tablist).not.toHaveClass('overflow-y-auto', 'overflow-y-scroll', 'flex-wrap');
  });

  it('pins an overflow menu listing every open document to jump to', async () => {
    render(
      <TabBar
        tabs={[TAB_A, TAB_B]}
        activeKey={TAB_B.key}
        renderLink={renderLink}
        onClose={() => undefined}
      />,
    );
    // The pinned control announces the open-document count and lives outside the scroll track.
    const trigger = screen.getByRole('button', { name: 'Open documents (2)' });
    openMenu(trigger);
    // It lists every open document by title (type glyph + title), even those scrolled out of
    // view — the strategy for a crowded bar. The active row is marked.
    await waitFor(() => expect(screen.getByRole('menu')).toBeInTheDocument());
    const menu = screen.getByRole('menu');
    const jumpA = within(menu).getByRole('link', { name: 'Fix the build' });
    expect(jumpA).toHaveAttribute('href', '/orgs/o1/tasks/t1');
    expect(within(menu).getByRole('link', { name: 'Q3 Launch' })).toHaveAttribute(
      'href',
      '/orgs/o1/projects/p1',
    );
    expect(within(menu).getByRole('menuitem', { name: /Q3 Launch/ })).toHaveAttribute(
      'aria-current',
      'true',
    );
  });

  it('closes any open document from the overflow menu', async () => {
    const onClose = vi.fn();
    render(
      <TabBar
        tabs={[TAB_A, TAB_B]}
        activeKey={TAB_A.key}
        renderLink={renderLink}
        onClose={onClose}
      />,
    );
    openMenu(screen.getByRole('button', { name: 'Open documents (2)' }));
    const menu = await screen.findByRole('menu');
    fireEvent.click(within(menu).getByRole('button', { name: 'Close Q3 Launch' }));
    expect(onClose).toHaveBeenCalledWith(TAB_B.key);
  });
});

describe('SidebarNavItem', () => {
  it('renders a button with an icon and calls onSelect', () => {
    const onSelect = vi.fn();
    render(<SidebarNavItem label="Home" icon={Home} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: 'Home' }));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('marks the active row with aria-current', () => {
    render(<SidebarNavItem label="Active" active />);
    expect(screen.getByRole('button', { name: 'Active' })).toHaveAttribute('aria-current', 'page');
  });

  it('folds a badge count into the button accessible name', () => {
    render(<SidebarNavItem label="Inbox" badge={3} />);
    expect(screen.getByRole('button', { name: 'Inbox, 3 unread' })).toBeInTheDocument();
  });

  it('renders asChild onto a custom link element with the active highlight', () => {
    render(
      <SidebarNavItem label="Linked" asChild active>
        <a href="/dest">Linked</a>
      </SidebarNavItem>,
    );
    const link = screen.getByRole('link', { name: 'Linked' });
    expect(link).toHaveAttribute('aria-current', 'page');
    expect(link).toHaveClass('justify-start');
  });

  it('appends a badge inside the asChild link content', () => {
    render(
      <SidebarNavItem label="Inbox" asChild badge={5}>
        <a href="/inbox">
          <span>Inbox</span>
        </a>
      </SidebarNavItem>,
    );
    const link = screen.getByRole('link', { name: 'Inbox, 5 unread' });
    expect(link).toHaveTextContent('5');
  });
});
