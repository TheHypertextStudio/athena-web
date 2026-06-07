import '@testing-library/jest-dom/vitest';

import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Home } from '../../../src/icons';
import { AppShell } from '../../../src/components/shell/AppShell';
import {
  ContextProvider,
  useContextState,
  type ActiveContext,
} from '../../../src/components/shell/ContextProvider';
import { Sidebar } from '../../../src/components/shell/Sidebar';
import { SidebarNavItem } from '../../../src/components/shell/SidebarNavItem';
import { TabBar, type OpenTab } from '../../../src/components/shell/TabBar';
import { WorkspaceSwitcher } from '../../../src/components/shell/WorkspaceSwitcher';
import type { Workspace } from '../../../src/components/shell/workspaces';

const ACME: Workspace = { id: 'ORG00000000000000000000001', name: 'Acme Co' };
const GLOBEX: Workspace = { id: 'ORG00000000000000000000002', name: 'Globex' };
const PERSONAL: Workspace = { id: 'ORG00000000000000000000009', name: 'My Space' };
const WORKSPACES: readonly Workspace[] = [ACME, GLOBEX, PERSONAL];

/** A test `renderLink` that mirrors the host's Next `Link` (a real anchor). */
function renderLink(href: string, content: React.ReactNode): React.ReactNode {
  return <a href={href}>{content}</a>;
}

/** The full set of href builders a {@link Sidebar} needs. */
function sidebarHrefs() {
  return {
    hrefForHome: (key: 'today' | 'inbox' | 'portfolio') => `/${key}`,
    hrefForWorkspace: (orgId: string, key: string) => `/orgs/${orgId}/${key}`,
    renderLink,
  };
}

function ctxWrapper(initial: ActiveContext) {
  return function Wrapper({ children }: { children: React.ReactNode }): React.JSX.Element {
    return <ContextProvider initialContext={initial}>{children}</ContextProvider>;
  };
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

  it('is the tinted MD3 canvas with a gutter, hosting a floating rounded main surface panel', () => {
    const { container } = render(
      <ContextProvider initialContext={null}>
        <AppShell sidebar={<nav aria-label="Navigation" />}>
          <div>Main</div>
        </AppShell>
      </ContextProvider>,
    );
    // Root = the tinted canvas tone (surface-container), inset by a uniform gutter so the
    // panels float — NOT the old flat bg-background, and never bg-card/bg-background again.
    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveClass('bg-surface-container', 'text-on-surface', 'p-2');
    expect(root).not.toHaveClass('bg-background', 'bg-card');
    // The main content is a floating rounded surface panel on that canvas.
    const main = screen.getByRole('main');
    expect(main).toHaveClass('bg-surface', 'rounded-xl', 'border-outline-variant');
    expect(main).not.toHaveClass('bg-background', 'bg-card');
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
  });

  it('is a floating rounded MD3 surface panel, not a flush bordered wall', () => {
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
    // Panel tone + rounded floating panel with a hairline outline — no full-bleed divider wall.
    expect(aside).toHaveClass(
      'bg-surface',
      'text-on-surface',
      'rounded-xl',
      'border-outline-variant',
    );
    expect(aside).not.toHaveClass('border-r', 'bg-card', 'bg-background');
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
    // The Workspace section degrades to a placeholder rather than emitting bad hrefs.
    expect(screen.getByText('No workspace yet.')).toBeInTheDocument();
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
        <WorkspaceSwitcher workspaces={WORKSPACES} onSelect={onSelect} />
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
        <WorkspaceSwitcher workspaces={WORKSPACES} onSelect={() => undefined} />
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
        <WorkspaceSwitcher workspaces={WORKSPACES} onSelect={() => undefined} />
      </ContextProvider>,
    );
    expect(screen.getByRole('button', { name: /Workspace: Acme Co/ })).toBeInTheDocument();
  });

  it('disables the switcher when the caller has no orgs', () => {
    render(
      <ContextProvider initialContext={null}>
        <WorkspaceSwitcher workspaces={[]} onSelect={() => undefined} />
      </ContextProvider>,
    );
    expect(screen.getByRole('button', { name: /Workspace: Workspace/ })).toBeDisabled();
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

  it('is its own bar on the canvas, with the active tab fused to the main panel surface', () => {
    render(
      <TabBar
        tabs={[TAB_A, TAB_B]}
        activeKey={TAB_B.key}
        renderLink={renderLink}
        onClose={() => undefined}
      />,
    );
    // The bar reads as its own chrome on the canvas tone — not a panel surface, no divider border.
    const tablist = screen.getByRole('tablist', { name: 'Open documents' });
    expect(tablist).toHaveClass('bg-surface-container');
    expect(tablist).not.toHaveClass('bg-card', 'border-b');
    // The active tab takes the panel surface tone with top-only rounding so it joins the panel
    // below; the inactive tab stays on the canvas in the muted on-surface-variant tone.
    const activeTab = screen.getByText('Q3 Launch').closest('[role="tab"]');
    expect(activeTab).toHaveClass('bg-surface', 'rounded-t-lg', 'text-on-surface');
    const inactiveTab = screen.getByText('Fix the build').closest('[role="tab"]');
    expect(inactiveTab).toHaveClass('text-on-surface-variant');
    expect(inactiveTab).not.toHaveClass('bg-surface');
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
