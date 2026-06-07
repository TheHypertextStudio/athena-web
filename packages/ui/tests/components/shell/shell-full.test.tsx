import '@testing-library/jest-dom/vitest';

import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Home } from '../../../src/icons';
import { AppShell } from '../../../src/components/shell/AppShell';
import {
  ContextProvider,
  HUB_CONTEXT,
  useContextState,
  type ActiveContext,
} from '../../../src/components/shell/ContextProvider';
import { Sidebar } from '../../../src/components/shell/Sidebar';
import { SidebarNavItem } from '../../../src/components/shell/SidebarNavItem';
import { TabBar, type OpenTab } from '../../../src/components/shell/TabBar';
import { WorkspaceSwitcher } from '../../../src/components/shell/WorkspaceSwitcher';
import type { Workspace } from '../../../src/components/shell/workspaces';

const ACME: Workspace = { id: 'ORG00000000000000000000001', name: 'Acme Co', isPersonal: false };
const GLOBEX: Workspace = { id: 'ORG00000000000000000000002', name: 'Globex', isPersonal: false };
const PERSONAL: Workspace = {
  id: 'ORG00000000000000000000009',
  name: 'My Space',
  isPersonal: true,
};
const WORKSPACES: readonly Workspace[] = [ACME, GLOBEX, PERSONAL];

/** A test `renderLink` that mirrors the host's Next `Link` (a real anchor). */
function renderLink(href: string, content: React.ReactNode): React.ReactNode {
  return <a href={href}>{content}</a>;
}

/** The full set of href builders a {@link Sidebar} needs, plus spies. */
function sidebarHrefs() {
  return {
    hrefForHome: (key: 'today' | 'inbox' | 'portfolio') => `/${key}`,
    hrefForWorkspace: (orgId: string, key: string) => `/orgs/${orgId}/${key}`,
    hrefForOrgHome: (orgId: string) => `/orgs/${orgId}/my-work`,
    renderLink,
  };
}

function ctxWrapper(initial: ActiveContext) {
  return function Wrapper({ children }: { children: React.ReactNode }): React.JSX.Element {
    return <ContextProvider initialContext={initial}>{children}</ContextProvider>;
  };
}

describe('ContextProvider / useContextState', () => {
  it('defaults to the Hub with no accent and comfortable density', () => {
    const { result } = renderHook(() => useContextState(), { wrapper: ctxWrapper(HUB_CONTEXT) });
    expect(result.current.isHub).toBe(true);
    expect(result.current.activeOrgId).toBeNull();
    expect(result.current.orgAccent).toBeNull();
    expect(result.current.density).toBe('comfortable');
  });

  it('derives an org accent when an org context is bound', () => {
    const { result } = renderHook(() => useContextState(), { wrapper: ctxWrapper(ACME.id) });
    expect(result.current.isHub).toBe(false);
    expect(result.current.activeOrgId).toBe(ACME.id);
    expect(result.current.orgAccent).toMatch(/^oklch/);
  });

  it('setContext rebinds and setDensity updates density', () => {
    const { result } = renderHook(() => useContextState(), { wrapper: ctxWrapper(HUB_CONTEXT) });
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

  it('omits the --org-accent variable on the Hub (no bound org)', () => {
    const { container } = render(
      <ContextProvider initialContext={HUB_CONTEXT}>
        <AppShell sidebar={<nav aria-label="Navigation" />} className="shell-x">
          <div>Hub main</div>
        </AppShell>
      </ContextProvider>,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.style.getPropertyValue('--org-accent')).toBe('');
    expect(root).toHaveClass('shell-x');
  });
});

describe('Sidebar', () => {
  it('renders the Home group + the org Workspace group when an org is bound', () => {
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
    // Home group (cross-org) is always present.
    expect(screen.getByRole('link', { name: 'Today' })).toHaveAttribute('href', '/today');
    expect(screen.getByRole('link', { name: 'Portfolio' })).toHaveAttribute('href', '/portfolio');
    expect(screen.getByRole('button', { name: 'Search' })).toBeInTheDocument();

    // Workspace group (org-scoped) — entity rows fall back to the startup preset here.
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

  it('shows a Workspaces list (not org nav) on the Hub, with an add-org affordance', () => {
    const onAddOrg = vi.fn();
    render(
      <ContextProvider initialContext={HUB_CONTEXT}>
        <Sidebar
          workspaces={WORKSPACES}
          {...sidebarHrefs()}
          onSelectWorkspace={() => undefined}
          onOpenSearch={() => undefined}
          onAddOrg={onAddOrg}
        />
      </ContextProvider>,
    );
    // The Hub never shows the org nav (no My Work / Triage rows).
    expect(screen.queryByRole('link', { name: 'Triage' })).not.toBeInTheDocument();
    // It lists every workspace as an entry into the org.
    expect(screen.getByRole('link', { name: 'Acme Co' })).toHaveAttribute(
      'href',
      `/orgs/${ACME.id}/my-work`,
    );
    expect(screen.getByRole('link', { name: 'Globex' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add organization' }));
    expect(onAddOrg).toHaveBeenCalledTimes(1);
  });

  it('never produces an /orgs/undefined href when no org is bound', () => {
    render(
      <ContextProvider initialContext={HUB_CONTEXT}>
        <Sidebar
          workspaces={WORKSPACES}
          {...sidebarHrefs()}
          onSelectWorkspace={() => undefined}
          onOpenSearch={() => undefined}
        />
      </ContextProvider>,
    );
    for (const link of screen.getAllByRole('link')) {
      expect(link.getAttribute('href')).not.toContain('/orgs/undefined');
    }
  });

  it('renders an empty-state line when the caller has no workspaces', () => {
    render(
      <ContextProvider initialContext={HUB_CONTEXT}>
        <Sidebar
          workspaces={[]}
          {...sidebarHrefs()}
          onSelectWorkspace={() => undefined}
          onOpenSearch={() => undefined}
        />
      </ContextProvider>,
    );
    expect(screen.getByText('No organizations yet.')).toBeInTheDocument();
  });
});

/** Open a Radix dropdown trigger in jsdom (pointerDown + click). */
function openMenu(trigger: HTMLElement): void {
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
  fireEvent.click(trigger);
}

describe('WorkspaceSwitcher', () => {
  it('shows the Hub as the active workspace and switches to an org on selection', async () => {
    const onSelect = vi.fn();
    render(
      <ContextProvider initialContext={HUB_CONTEXT}>
        <WorkspaceSwitcher workspaces={WORKSPACES} hubBadge={2} onSelect={onSelect} />
      </ContextProvider>,
    );
    openMenu(screen.getByRole('button', { name: /Workspace: Hub/ }));
    // The Hub + each shared org + the personal org appear as menu items.
    await waitFor(() => expect(screen.getByText('Acme Co')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Acme Co'));
    expect(onSelect).toHaveBeenCalledWith(ACME.id);
  });

  it('selects the Hub (null) from the cross-organization entry', async () => {
    const onSelect = vi.fn();
    render(
      <ContextProvider initialContext={ACME.id}>
        <WorkspaceSwitcher workspaces={WORKSPACES} onSelect={onSelect} />
      </ContextProvider>,
    );
    openMenu(screen.getByRole('button', { name: /Workspace: Acme Co/ }));
    await waitFor(() => {
      expect(screen.getAllByText('Hub').length).toBeGreaterThan(0);
    });
    // The Hub menu item is the one inside the open menu (a menuitem role).
    fireEvent.click(screen.getByRole('menuitem', { name: /^Hub/ }));
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it('groups personal orgs under a Personal section', async () => {
    render(
      <ContextProvider initialContext={HUB_CONTEXT}>
        <WorkspaceSwitcher workspaces={WORKSPACES} onSelect={() => undefined} />
      </ContextProvider>,
    );
    openMenu(screen.getByRole('button', { name: /Workspace: Hub/ }));
    await waitFor(() => expect(screen.getByText('Personal')).toBeInTheDocument());
    expect(screen.getByText('My Space')).toBeInTheDocument();
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
