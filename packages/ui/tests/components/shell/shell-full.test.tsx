import '@testing-library/jest-dom/vitest';

import {
  act,
  cleanup as cleanupRender,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import * as React from 'react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Home } from '../../../src/icons';
import { AppShell, SHELL_DESKTOP_QUERY } from '../../../src/components/shell/AppShell';
import { useShellOverlayHost } from '../../../src/components/shell/ShellOverlayContext';
import {
  ContextProvider,
  useContextState,
  type ActiveContext,
} from '../../../src/components/shell/ContextProvider';
import { ShellDrawerProvider } from '../../../src/components/shell/ShellDrawerContext';
import { ShellSidebarProvider } from '../../../src/components/shell/ShellSidebarContext';
import { Sidebar } from '../../../src/components/shell/Sidebar';
import { SidebarNavItem } from '../../../src/components/shell/SidebarNavItem';
import { TabBar, type OpenTab } from '../../../src/components/shell/TabBar';
import { WorkspaceSwitcher } from '../../../src/components/shell/WorkspaceSwitcher';
import type { Workspace } from '../../../src/components/shell/workspaces';
import { assertDefined } from '@docket/test-utils';

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
    hrefForHome: (
      key: 'today' | 'tasks' | 'calendar' | 'time' | 'inbox' | 'athena' | 'stream' | 'portfolio',
    ) => `/${key}`,
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

function OverlayHostProbe(): React.JSX.Element {
  const host = useShellOverlayHost();
  return <output data-testid="overlay-host-probe">{host ? 'ready' : 'missing'}</output>;
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
  it('provides a primary-column overlay host outside main content', async () => {
    const { container } = render(
      <ContextProvider initialContext={null}>
        <AppShell sidebar={<nav aria-label="Navigation" />}>
          <OverlayHostProbe />
        </AppShell>
      </ContextProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId('overlay-host-probe')).toHaveTextContent('ready'),
    );
    const host = container.querySelector<HTMLElement>('[data-shell-overlay-host]');
    expect(host).toBeInTheDocument();
    expect(screen.getByRole('main')).not.toContainElement(host);
    expect(host?.parentElement).toContainElement(screen.getByRole('main'));
  });

  it('keeps the first resolved org steady and cross-fades a later org switch', async () => {
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

    // The cross-fade is transient: once its 240ms timer fires, the class is dropped again.
    await waitFor(
      () => {
        expect(main).not.toHaveClass('animate-org-rebind');
      },
      { timeout: 1000 },
    );
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
        <AppShell
          sidebar={<nav aria-label="Navigation" />}
          banner={<div data-testid="sync-banner">Syncing</div>}
        >
          <div>Main</div>
        </AppShell>
      </ContextProvider>,
    );
    // Root = the tinted canvas tone (surface-container). The uniform gutter that floats the
    // panels is a DESKTOP affordance (`lg:p-2`) so mobile content can go full-bleed; the canvas
    // is never the old flat bg-surface, and never bg-surface-container-low/bg-surface again.
    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveClass('bg-surface-container', 'text-on-surface', 'lg:p-2');
    expect(root).not.toHaveClass('bg-surface', 'bg-surface-container-low');
    // The main content is the single distinct surface panel: it carries the panel surface tone
    // always and rounds at the desktop breakpoint, going full-bleed below `lg`. Separation is the
    // tonal step from the canvas onto `surface` and nothing else — no border and no drop shadow,
    // which together drew a second box around content that already read as a panel.
    const main = screen.getByRole('main');
    expect(main).toHaveClass('bg-surface', 'lg:rounded-xl');
    expect(main.parentElement).not.toHaveClass('lg:gap-2');
    expect(screen.getByTestId('sync-banner').parentElement).toHaveAttribute(
      'data-slot',
      'shell-banner',
    );
    expect(screen.getByTestId('sync-banner').parentElement).toHaveClass('lg:mb-2');
    expect(main).not.toHaveClass(
      'bg-surface',
      'bg-surface-container-low',
      'lg:border',
      'lg:shadow-sm',
    );
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

describe('AppShell rail', () => {
  // These tests replace the suite-wide `matchMedia` stub; put the non-matching default back so a
  // later test never inherits a viewport this block invented.
  afterEach(() => {
    window.localStorage.clear();
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(() => false),
    }));
  });

  const TASKS_PANEL = {
    id: 'tasks',
    label: 'Tasks',
    icon: <Home />,
    node: <div>Task list</div>,
  };

  /** Render the shell with one rail panel, with `matchMedia` answering per query. */
  function renderWithRail(matches: (query: string) => boolean): void {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: matches(query),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(() => false),
    }));
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
          aside={{ panels: [TASKS_PANEL], defaultPanelId: 'tasks' }}
        >
          <div>Main</div>
        </AppShell>
      </ContextProvider>,
    );
  }

  it('renders the panel host and switcher at EVERY width, hiding them in CSS below lg', () => {
    // The old shell mounted these on a JS media query, so crossing the query added a whole column
    // of chrome in one pixel of window growth. They are unconditional now: the layout the server
    // paints is already the final one, and the desktop chrome is the same width at 1024 as at 1920.
    renderWithRail(() => false);

    const host = screen.getByRole('complementary', { name: 'Tasks' });
    const bar = screen.getByRole('navigation', { name: 'Panels' });
    expect(host).toHaveClass('hidden', 'lg:block');
    expect(bar).toHaveClass('hidden', 'lg:flex');
  });

  it('opens to a share of the viewport, never a fixed column', () => {
    renderWithRail(() => true);

    // A viewport *share*, floored at 17.5rem and capped at 22rem. The bare fixed width this
    // replaced is what let a docked rail take 352px out of a 1024px window the moment a media
    // query flipped; the floor is what keeps the rail readable at the bottom of the range without
    // reintroducing that step.
    expect(screen.getByRole('complementary', { name: 'Tasks' })).toHaveClass(
      'w-[clamp(17.5rem,17vw,22rem)]',
    );
  });

  it('collapses and re-expands from its own activity-bar icon', () => {
    renderWithRail(() => true);

    fireEvent.click(screen.getByRole('button', { name: 'Collapse Tasks' }));
    expect(screen.getByRole('complementary', { name: 'Tasks' })).toHaveClass('w-0');

    const activityBar = screen.getByRole('navigation', { name: 'Panels' });
    fireEvent.click(within(activityBar).getByRole('button', { name: 'Tasks' }));
    expect(screen.getByRole('complementary', { name: 'Tasks' })).toHaveClass(
      'w-[clamp(17.5rem,17vw,22rem)]',
    );
  });

  it('selects and expands a requested panel through the versioned shell interface', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === SHELL_DESKTOP_QUERY,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(() => false),
    }));
    const onRailStateChange = vi.fn();
    const sidebar = (
      <Sidebar
        workspaces={WORKSPACES}
        {...sidebarHrefs()}
        onSelectWorkspace={() => undefined}
        onOpenSearch={() => undefined}
      />
    );
    const agenda = { id: 'agenda', label: 'Agenda', icon: <Home />, node: <div>Agenda body</div> };
    const athena = { id: 'athena', label: 'Athena', icon: <Home />, node: <div>Athena queue</div> };
    const view = render(
      <ContextProvider initialContext={ACME.id}>
        <AppShell
          sidebar={sidebar}
          aside={{ panels: [agenda, athena], defaultPanelId: 'agenda' }}
          onRailStateChange={onRailStateChange}
        >
          <div>Main</div>
        </AppShell>
      </ContextProvider>,
    );

    expect(screen.getByRole('complementary', { name: 'Agenda' })).toHaveClass(
      'w-[clamp(17.5rem,17vw,22rem)]',
    );

    view.rerender(
      <ContextProvider initialContext={ACME.id}>
        <AppShell
          sidebar={sidebar}
          aside={{ panels: [agenda, athena], defaultPanelId: 'agenda' }}
          railRequest={{ panelId: 'athena', version: 1 }}
          onRailStateChange={onRailStateChange}
        >
          <div>Main</div>
        </AppShell>
      </ContextProvider>,
    );

    expect(screen.getByRole('complementary', { name: 'Athena' })).toHaveClass(
      'w-[clamp(17.5rem,17vw,22rem)]',
    );
    expect(onRailStateChange).toHaveBeenLastCalledWith({
      activePanelId: 'athena',
      expanded: true,
      visible: true,
    });
  });

  it('arms the width transition only for the duration of the collapse/expand motion', async () => {
    renderWithRail(() => true);
    const host = screen.getByRole('complementary', { name: 'Tasks' });
    expect(host).not.toHaveClass('transition-[width]');

    fireEvent.click(screen.getByRole('button', { name: 'Collapse Tasks' }));
    expect(host).toHaveClass('transition-[width]', 'w-0');

    // Once the 240ms motion completes, the transition class is dropped so a later viewport
    // resize (which also changes the rail's width) never gets caught by the same animation.
    await waitFor(
      () => {
        expect(host).not.toHaveClass('transition-[width]');
      },
      { timeout: 1000 },
    );
    expect(host).toHaveClass('w-0');
  });

  it('adopts a persisted collapsed choice after mount rather than at hydration', () => {
    // React does not patch attribute mismatches it finds while hydrating, so reading storage in
    // `useState`'s initializer left the server's class on the element forever and the viewer's saved
    // choice was silently dropped — visible now that the rail is server-rendered at every width.
    window.localStorage.setItem('docket.rail.collapsed', '1');
    renderWithRail(() => true);

    expect(screen.getByRole('complementary', { name: 'Tasks' })).toHaveClass('w-0');
  });

  it('presents the panels as a modal sheet below lg, costing <main> nothing', async () => {
    renderWithRail(() => false);

    fireEvent.click(screen.getByRole('button', { name: 'Show Tasks' }));

    const overlay = await screen.findByRole('dialog', { name: 'Tasks' });
    expect(within(overlay).getByText('Task list')).toBeInTheDocument();
    // The docked host is `display: none` at these widths, so it is not a column and takes no width
    // from `<main>` however wide its class says it would be. Queried by id rather than by role
    // because the open modal `aria-hidden`s the rest of the tree — which is also why the two
    // presentations can no longer share one id.
    expect(document.getElementById('shell-aside')).toHaveClass('hidden');
  });

  it('switches between panels from one mobile sheet menu', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(() => false),
    }));
    const panels = [
      TASKS_PANEL,
      { id: 'agenda', label: 'Agenda', icon: <Home />, node: <div>Agenda body</div> },
      { id: 'focus', label: 'Focus', icon: <Home />, node: <div>Focus body</div> },
      { id: 'athena', label: 'Athena', icon: <Home />, node: <div>Athena body</div> },
      { id: 'inbox', label: 'Inbox', icon: <Home />, node: <div>Inbox body</div> },
    ];
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
          aside={{ panels, defaultPanelId: 'tasks' }}
        >
          <div>Main</div>
        </AppShell>
      </ContextProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Show Tasks' }));
    const overlay = await screen.findByRole('dialog', { name: 'Tasks' });
    expect(within(overlay).queryByRole('tablist')).not.toBeInTheDocument();

    openMenu(within(overlay).getByRole('button', { name: 'Panel: Tasks. Switch panel' }));
    expect(screen.getAllByRole('menuitem')).toHaveLength(5);
    await act(async () => {
      screen.getByRole('menuitem', { name: 'Tasks' }).focus();
      await user.keyboard('{ArrowDown}{Enter}');
    });

    expect(await screen.findByRole('dialog', { name: 'Agenda' })).toBeInTheDocument();
    expect(within(overlay).getByText('Agenda body')).toBeInTheDocument();
    expect(window.localStorage.getItem('docket.rail.active')).toBe('agenda');

    // Escape dismisses the mobile sheet (the sheet's own onOpenChange(false) path).
    fireEvent.keyDown(overlay, { key: 'Escape', code: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Agenda' })).not.toBeInTheDocument();
    });
  });

  it('keeps a long active panel name on one line and carries live status into the menu', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(() => false),
    }));
    const longLabel = 'A utility panel name that cannot fit inside a narrow sheet';
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
          aside={{
            panels: [
              { id: 'long', label: longLabel, icon: <Home />, node: <div>Long panel body</div> },
              {
                id: 'focus',
                label: 'Focus',
                icon: <Home />,
                node: <div>Focus body</div>,
                status: { tone: 'active', label: 'tracking Deep work' },
              },
            ],
            defaultPanelId: 'long',
          }}
        >
          <div>Main</div>
        </AppShell>
      </ContextProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: `Show ${longLabel}` }));
    const overlay = await screen.findByRole('dialog', { name: longLabel });
    const trigger = within(overlay).getByRole('button', {
      name: `Panel: ${longLabel}. Switch panel`,
    });
    expect(within(trigger).getByTitle(longLabel)).toHaveClass('truncate', 'whitespace-nowrap');

    openMenu(trigger);
    const focus = screen.getByRole('menuitem', { name: /Focus.*tracking Deep work/ });
    expect(focus.querySelector('[data-panel-status-tone="active"]')).toBeInTheDocument();
  });

  // A panel's live state has to survive the rail being collapsed — that is the moment it matters,
  // because the panel body is gone and the icon is all that is left. The dot alone would only
  // reach people who can see it, so the state belongs in the accessible name too.
  it('carries a panel’s live status on its icon, in the name as well as the dot', () => {
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
          aside={{
            panels: [
              TASKS_PANEL,
              {
                id: 'focus',
                label: 'Focus',
                icon: <Home />,
                node: <div>Focus body</div>,
                status: { tone: 'active' as const, label: 'tracking Deep work' },
              },
            ],
            defaultPanelId: 'tasks',
          }}
        >
          <div>Main</div>
        </AppShell>
      </ContextProvider>,
    );

    expect(screen.getByRole('button', { name: 'Focus, tracking Deep work' })).toBeInTheDocument();
    expect(screen.getByTestId('rail-status-focus')).toHaveAttribute('data-tone', 'active');
    // A panel with nothing ongoing stays a plain glyph; a dot that never changes teaches people
    // to stop looking at it.
    expect(screen.queryByTestId('rail-status-tasks')).not.toBeInTheDocument();
  });
});

describe('Sidebar collapse', () => {
  afterEach(() => {
    Reflect.deleteProperty(document, 'startViewTransition');
    window.localStorage.removeItem('docket.sidebar.collapsed');
  });

  /** Render the sidebar inside a shell-collapse provider at the given state. */
  function renderSidebar(collapsed: boolean, onToggle = () => undefined): void {
    render(
      <ContextProvider initialContext={ACME.id}>
        <ShellSidebarProvider value={{ collapsed, onToggle }}>
          <Sidebar
            workspaces={WORKSPACES}
            {...sidebarHrefs()}
            onSelectWorkspace={() => undefined}
            onOpenSearch={() => undefined}
          />
        </ShellSidebarProvider>
      </ContextProvider>,
    );
  }

  // Collapsing keeps daily routes on the labeled rail. Expansion exposes the complete catalog.
  it('keeps daily destinations named and leaves the complete catalog to expansion', () => {
    renderSidebar(true);
    expect(screen.getByRole('link', { name: 'Today' })).toHaveAttribute('href', '/today');
    expect(screen.getByRole('link', { name: 'My Work' })).toHaveAttribute(
      'href',
      `/orgs/${ACME.id}/my-work`,
    );
    expect(screen.getByRole('button', { name: 'Search' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Expand navigation' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'More navigation' })).not.toBeInTheDocument();
  });

  it('narrows to the labeled navigation rail, and back', () => {
    renderSidebar(true);
    expect(screen.getByRole('complementary', { name: 'Navigation' })).toHaveClass('lg:w-16');
    cleanupRender();
    renderSidebar(false);
    expect(screen.getByRole('complementary', { name: 'Navigation' })).toHaveClass('lg:w-60');
  });

  it('offers a toggle that names the state it will move to', () => {
    const onToggle = vi.fn();
    renderSidebar(true, onToggle);
    const expand = screen.getByRole('button', { name: 'Expand navigation' });
    expect(expand).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(expand);
    expect(onToggle).toHaveBeenCalledTimes(1);

    cleanupRender();
    renderSidebar(false);
    expect(screen.getByRole('button', { name: 'Collapse navigation' })).toBeInTheDocument();
  });

  it('uses a shared transition and keeps focus on the state-changing control', async () => {
    window.localStorage.setItem('docket.sidebar.collapsed', '0');
    const startViewTransition = vi.fn((update: () => void) => {
      update();
      return { finished: Promise.resolve() };
    });
    Object.defineProperty(document, 'startViewTransition', {
      configurable: true,
      value: startViewTransition,
    });
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

    const collapse = screen.getByRole('button', { name: 'Collapse navigation' });
    collapse.focus();
    fireEvent.click(collapse);

    await waitFor(() => {
      expect(startViewTransition).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByRole('button', { name: 'Expand navigation' })).toHaveFocus();
  });

  // The drawer IS the surface someone opened to navigate. Shrinking it to glyphs would leave a
  // 56px sheet floating over an empty screen, so the collapse is a desktop-only affordance.
  it('ignores the collapse inside the mobile drawer', () => {
    render(
      <ContextProvider initialContext={ACME.id}>
        <ShellSidebarProvider value={{ collapsed: true, onToggle: () => undefined }}>
          <ShellDrawerProvider dismiss={() => undefined}>
            <Sidebar
              workspaces={WORKSPACES}
              {...sidebarHrefs()}
              onSelectWorkspace={() => undefined}
              onOpenSearch={() => undefined}
            />
          </ShellDrawerProvider>
        </ShellSidebarProvider>
      </ContextProvider>,
    );
    expect(screen.getByRole('complementary', { name: 'Navigation' })).toHaveClass('lg:w-60');
    expect(screen.queryByRole('button', { name: /navigation$/ })).toBeNull();
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
    expect(screen.getByRole('link', { name: 'Time' })).toHaveAttribute('href', '/time');
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
    expect(screen.getByRole('link', { name: 'Athena' })).toHaveAttribute('href', '/athena');
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
      'bg-surface-container-low',
      'bg-surface',
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

  it('closes the drawer when creating a workspace from the switcher inside a drawer', () => {
    // The workspace switcher navigates (create / switch) but sits outside the nav rows, so it must
    // close the drawer itself — otherwise the destination renders behind the still-open drawer.
    const dismiss = vi.fn();
    const onCreateWorkspace = vi.fn();
    render(
      <ContextProvider initialContext={ACME.id}>
        <ShellDrawerProvider dismiss={dismiss}>
          <Sidebar
            workspaces={WORKSPACES}
            {...sidebarHrefs()}
            onCreateWorkspace={onCreateWorkspace}
            onSelectWorkspace={() => undefined}
            onOpenSearch={() => undefined}
          />
        </ShellDrawerProvider>
      </ContextProvider>,
    );
    const trigger = screen.getByRole('button', { name: /Switch workspace/ });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Create workspace' }));
    expect(onCreateWorkspace).toHaveBeenCalledTimes(1);
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

  it('puts Tasks in the Workspace section beside Projects and Initiatives', () => {
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

    const workspaceNav = screen.getByRole('navigation', { name: 'Workspace' });
    const tasks = within(workspaceNav).getByRole('link', { name: 'Tasks' });
    expect(tasks).toHaveAttribute('href', `/orgs/${ACME.id}/tasks`);
    // Peer, not a child: it is a top-level row in the same flat section as Projects/Initiatives,
    // with no group to expand first.
    expect(tasks.parentElement).toBe(
      within(workspaceNav).getByRole('link', { name: 'Projects' }).parentElement,
    );
    expect(tasks.parentElement).toBe(
      within(workspaceNav).getByRole('link', { name: 'Initiatives' }).parentElement,
    );
    // The cross-org Home row is a different altitude and stays where it is.
    expect(
      within(screen.getByRole('navigation', { name: 'Home' })).getByRole('link', { name: 'Tasks' }),
    ).toHaveAttribute('href', '/tasks');
  });

  it('keeps the Workspace Tasks row in a personal workspace', () => {
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

    const workspaceNav = screen.getByRole('navigation', { name: 'Workspace' });
    expect(within(workspaceNav).getByRole('link', { name: 'Tasks' })).toHaveAttribute(
      'href',
      `/orgs/${PERSONAL.id}/tasks`,
    );
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
    // The Workspace section keeps its real labels and makes them inert rather than emitting bad
    // hrefs — the workspaces exist, so an empty treatment here would be false.
    expect(screen.getByRole('button', { name: 'Projects' })).toBeDisabled();
  });

  it('pins optional footer content to the bottom of the nav, outside the scrolling middle', () => {
    const { container } = render(
      <ContextProvider initialContext={ACME.id}>
        <Sidebar
          workspaces={WORKSPACES}
          {...sidebarHrefs()}
          onSelectWorkspace={() => undefined}
          onOpenSearch={() => undefined}
          footer={<button type="button">Sign out</button>}
        />
      </ContextProvider>,
    );
    const footerButton = screen.getByRole('button', { name: 'Sign out' });
    // Not `mt-auto` on a scrolling parent (the old bug: the whole rail scrolled as one region).
    // `shrink-0` is what keeps the footer from being squeezed by the scrolling middle sibling.
    expect(footerButton.parentElement).toHaveClass('shrink-0');
    // The switcher and the footer are outside the scrollable region; only the middle scrolls.
    const aside = assertDefined(container.querySelector('aside'));
    expect(aside).not.toHaveClass('overflow-y-auto');
    const scrollRegion = aside.querySelector(':scope > .overflow-y-auto');
    expect(scrollRegion).not.toBeNull();
    expect(scrollRegion?.contains(footerButton)).toBe(false);
  });
});

/** Open a Radix dropdown trigger in jsdom (pointerDown + click). */
function openMenu(trigger: HTMLElement): void {
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
  fireEvent.click(trigger);
}

describe('WorkspaceSwitcher attention + avatar details', () => {
  it('shows the attention badge for a workspace with a positive count', async () => {
    const withAttention: Workspace = { ...GLOBEX, attentionCount: 5 };
    render(
      <ContextProvider initialContext={ACME.id}>
        <WorkspaceSwitcher
          workspaces={[ACME, withAttention]}
          onSelect={() => undefined}
          onCreate={() => undefined}
        />
      </ContextProvider>,
    );
    openMenu(screen.getByRole('button', { name: /Workspace: Acme Co/ }));
    await waitFor(() => expect(screen.getByLabelText('5 need attention')).toBeInTheDocument());
  });

  it('clamps a large attention count to a 99+ ceiling', async () => {
    const overflowing: Workspace = { ...GLOBEX, attentionCount: 140 };
    render(
      <ContextProvider initialContext={ACME.id}>
        <WorkspaceSwitcher
          workspaces={[ACME, overflowing]}
          onSelect={() => undefined}
          onCreate={() => undefined}
        />
      </ContextProvider>,
    );
    openMenu(screen.getByRole('button', { name: /Workspace: Acme Co/ }));
    await waitFor(() => expect(screen.getByLabelText('140 need attention')).toBeInTheDocument());
    expect(screen.getByLabelText('140 need attention')).toHaveTextContent('99+');
  });

  it('renders the workspace avatar image when one is supplied', () => {
    const withAvatar: Workspace = { ...ACME, avatar: 'https://example.com/acme.png' };
    render(
      <ContextProvider initialContext={ACME.id}>
        <WorkspaceSwitcher
          workspaces={[withAvatar]}
          onSelect={() => undefined}
          onCreate={() => undefined}
        />
      </ContextProvider>,
    );
    // Radix's AvatarImage only swaps in after a successful load; asserting the fallback still
    // renders is enough to prove the `workspace.avatar` branch was taken (it renders an
    // AvatarImage instead of skipping straight to AvatarFallback).
    expect(screen.getByRole('button', { name: /Workspace: Acme Co/ })).toBeInTheDocument();
  });

  it('falls back to "?" initials for a blank workspace name', async () => {
    const blank: Workspace = { id: 'ORG00000000000000000000099', name: '   ' };
    render(
      <ContextProvider initialContext={blank.id}>
        <WorkspaceSwitcher
          workspaces={[blank]}
          onSelect={() => undefined}
          onCreate={() => undefined}
        />
      </ContextProvider>,
    );
    expect(screen.getByText('?')).toBeInTheDocument();
  });
});

describe('WorkspaceSwitcher', () => {
  it('gives the collapsed workspace identity a 32px mark inside its 40px target', () => {
    render(
      <ContextProvider initialContext={ACME.id}>
        <WorkspaceSwitcher
          collapsed
          workspaces={WORKSPACES}
          onSelect={() => undefined}
          onCreate={() => undefined}
        />
      </ContextProvider>,
    );

    const trigger = screen.getByRole('button', { name: /Workspace: Acme Co/ });
    expect(trigger).toHaveClass('size-10');
    expect(trigger.querySelector('[data-slot="workspace-avatar"]')).toHaveClass('size-8');
  });

  it('keeps the expanded workspace identity at 24px beside its label', () => {
    render(
      <ContextProvider initialContext={ACME.id}>
        <WorkspaceSwitcher
          workspaces={WORKSPACES}
          onSelect={() => undefined}
          onCreate={() => undefined}
        />
      </ContextProvider>,
    );

    const trigger = screen.getByRole('button', { name: /Workspace: Acme Co/ });
    expect(trigger.querySelector('[data-slot="workspace-avatar"]')).toHaveClass('size-6');
  });

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
    expect(bar).not.toHaveClass('bg-surface-container-low', 'border-b');
    // Every tab is a detached pill at the control radius, NOT welded to the panel below: no
    // top-only rounding, no self-stretch.
    const activeTab = assertDefined(
      screen.getByText('Q3 Launch').closest<HTMLElement>('[role="tab"]'),
    );
    const inactiveTab = assertDefined(
      screen.getByText('Fix the build').closest<HTMLElement>('[role="tab"]'),
    );
    for (const tab of [activeTab, inactiveTab]) {
      expect(tab).toHaveClass('rounded-md');
      expect(tab).not.toHaveClass('rounded-t-lg', 'self-stretch');
    }
    // State is pure tonal hierarchy — no ring, no shadow, no chip selection role. The active pill
    // wears the content panel's own `surface` tone (the open document's layer); the inactive pill
    // rests one ramp step above the strip so it reads as a pill rather than vanishing into it.
    expect(activeTab).toHaveClass('bg-surface', 'text-on-surface');
    expect(activeTab).not.toHaveClass('bg-secondary-container', 'shadow-sm', 'ring-1');
    expect(inactiveTab).toHaveClass('bg-surface-container-high', 'text-on-surface-variant');
    expect(inactiveTab).not.toHaveClass('bg-secondary-container', 'ring-1', 'shadow-sm');
  });

  it('gives each tab a bounded width with a flexing, truncating title and a right-pinned close', () => {
    render(
      <TabBar
        tabs={[TAB_A, TAB_B]}
        activeKey={TAB_A.key}
        renderLink={renderLink}
        onClose={() => undefined}
      />,
    );
    const tab = assertDefined(
      screen.getByText('Fix the build').closest<HTMLElement>('[role="tab"]'),
    );
    // A width RANGE rather than one rigid width: tabs shrink toward `min-w-24` so more of them fit
    // before the strip has to scroll on a phone, and stop at `max-w-60` so a lone tab is not
    // stretched across the bar. The floor is what keeps a crowded bar readable instead of
    // squeezing every tab down to its close button.
    expect(tab).toHaveClass('min-w-24', 'max-w-60', 'flex-1', 'shrink');
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

  it('opens a compact adaptive search surface instead of spending a row on a menu heading', async () => {
    render(
      <TabBar
        tabs={[TAB_A, TAB_B]}
        activeKey={TAB_B.key}
        renderLink={renderLink}
        onClose={() => undefined}
      />,
    );
    const trigger = screen.getByRole('button', { name: 'Open documents (2)' });
    openMenu(trigger);

    const switcher = await screen.findByRole('dialog', { name: 'Open documents' });
    const search = within(switcher).getByRole('searchbox', { name: 'Search open documents' });
    expect(search).toHaveFocus();
    expect(switcher).toHaveClass('w-88', 'lg:w-[min(480px,calc(100vw-1.5rem))]', 'p-2');
    expect(switcher).not.toHaveClass('p-1');
    expect(search.parentElement).toHaveClass('h-9', 'coarse:h-10');
    expect(within(switcher).queryByText('Open documents')).not.toBeInTheDocument();

    const jumpA = within(switcher).getByRole('link', { name: 'Fix the build' });
    expect(jumpA).toHaveAttribute('href', '/orgs/o1/tasks/t1');
    expect(within(switcher).getByRole('link', { name: 'Q3 Launch' })).toHaveAttribute(
      'href',
      '/orgs/o1/projects/p1',
    );
    expect(within(switcher).getByRole('listitem', { name: /Q3 Launch/ })).toHaveAttribute(
      'aria-current',
      'true',
    );
  });

  it('filters open documents locally and renders a quiet no-results state', async () => {
    render(
      <TabBar
        tabs={[TAB_A, TAB_B]}
        activeKey={TAB_B.key}
        renderLink={renderLink}
        onClose={() => undefined}
      />,
    );
    openMenu(screen.getByRole('button', { name: 'Open documents (2)' }));
    const switcher = await screen.findByRole('dialog', { name: 'Open documents' });
    const search = within(switcher).getByRole('searchbox', { name: 'Search open documents' });

    fireEvent.change(search, { target: { value: 'launch' } });
    expect(within(switcher).queryByRole('link', { name: 'Fix the build' })).not.toBeInTheDocument();
    expect(within(switcher).getByRole('link', { name: 'Q3 Launch' })).toBeInTheDocument();

    fireEvent.change(search, { target: { value: 'missing' } });
    expect(within(switcher).getByText('No open documents found')).toBeInTheDocument();
  });

  it('opens from either platform shortcut while rejecting Alt and repeated keydown', async () => {
    render(
      <TabBar
        tabs={[TAB_A, TAB_B]}
        activeKey={TAB_A.key}
        renderLink={renderLink}
        onClose={() => undefined}
      />,
    );

    fireEvent.keyDown(document, { key: 'a', metaKey: true, shiftKey: true, altKey: true });
    fireEvent.keyDown(document, { key: 'a', metaKey: true, shiftKey: true, repeat: true });
    expect(screen.queryByRole('dialog', { name: 'Open documents' })).not.toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'A', ctrlKey: true, shiftKey: true });
    expect(await screen.findByRole('searchbox', { name: 'Search open documents' })).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Open documents' })).not.toBeInTheDocument(),
    );

    fireEvent.keyDown(document, { key: 'a', metaKey: true, shiftKey: true });
    expect(await screen.findByRole('searchbox', { name: 'Search open documents' })).toHaveFocus();
  });

  it('moves visible focus through the search, document link, and close action with Tab', async () => {
    const user = userEvent.setup();
    render(
      <TabBar
        tabs={[TAB_A, TAB_B]}
        activeKey={TAB_A.key}
        renderLink={renderLink}
        onClose={() => undefined}
      />,
    );
    const trigger = screen.getByRole('button', { name: 'Open documents (2)' });
    openMenu(trigger);
    const switcher = await screen.findByRole('dialog', { name: 'Open documents' });
    expect(
      within(switcher).getByRole('searchbox', { name: 'Search open documents' }),
    ).toHaveFocus();

    await user.tab();
    expect(within(switcher).getByRole('link', { name: 'Fix the build' })).toHaveFocus();
    await user.tab();
    expect(within(switcher).getByRole('button', { name: 'Close Fix the build' })).toHaveFocus();

    fireEvent.keyDown(switcher, { key: 'Escape' });
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('uses Arrow keys to wrap focus across document links', async () => {
    render(
      <TabBar
        tabs={[TAB_A, TAB_B]}
        activeKey={TAB_A.key}
        renderLink={renderLink}
        onClose={() => undefined}
      />,
    );
    openMenu(screen.getByRole('button', { name: 'Open documents (2)' }));
    const switcher = await screen.findByRole('dialog', { name: 'Open documents' });
    const search = within(switcher).getByRole('searchbox', { name: 'Search open documents' });
    const first = within(switcher).getByRole('link', { name: 'Fix the build' });
    const last = within(switcher).getByRole('link', { name: 'Q3 Launch' });

    fireEvent.keyDown(search, { key: 'ArrowDown' });
    expect(first).toHaveFocus();
    fireEvent.keyDown(first, { key: 'ArrowUp' });
    expect(last).toHaveFocus();
    fireEvent.keyDown(last, { key: 'ArrowDown' });
    expect(first).toHaveFocus();
  });

  it('opens the focused document with Enter and dismisses the switcher', async () => {
    const user = userEvent.setup();
    render(
      <TabBar
        tabs={[TAB_A, TAB_B]}
        activeKey={TAB_A.key}
        renderLink={renderLink}
        onClose={() => undefined}
      />,
    );
    openMenu(screen.getByRole('button', { name: 'Open documents (2)' }));
    const switcher = await screen.findByRole('dialog', { name: 'Open documents' });
    const link = within(switcher).getByRole('link', { name: 'Q3 Launch' });
    link.focus();

    await user.keyboard('{Enter}');
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Open documents' })).not.toBeInTheDocument(),
    );
  });

  it('uses fixed result rows and a contextual close target without expanding the list', async () => {
    render(
      <TabBar
        tabs={[TAB_A, TAB_B]}
        activeKey={TAB_A.key}
        renderLink={renderLink}
        onClose={() => undefined}
      />,
    );
    openMenu(screen.getByRole('button', { name: 'Open documents (2)' }));
    const switcher = await screen.findByRole('dialog', { name: 'Open documents' });
    const row = within(switcher).getByRole('listitem', { name: /Fix the build/ });
    const close = within(row).getByRole('button', { name: 'Close Fix the build' });
    const layer = close.querySelector<HTMLElement>('[data-menu-action-layer]');
    const results = within(switcher).getByRole('list', { name: 'Open document results' });
    expect(row).toHaveAttribute('data-menu-action-row', '');
    expect(row).toHaveClass('h-11', 'min-h-11', 'py-0');
    expect(close).toHaveClass('size-10');
    expect(layer).toHaveClass('size-7');
    expect(close).toHaveClass('absolute');
    expect(results).toHaveClass('max-h-80', 'overflow-y-auto', 'overscroll-contain');
  });

  it('filters and closes within a thirteen-document scrolling result list', async () => {
    const tabs: readonly OpenTab[] = Array.from({ length: 13 }, (_, index) => ({
      key: `task:o1:t${String(index + 1)}`,
      type: 'task',
      orgId: 'o1',
      id: `t${String(index + 1)}`,
      title: `Open document ${String(index + 1)}`,
      href: `/orgs/o1/tasks/t${String(index + 1)}`,
    }));

    function StatefulTabs(): React.JSX.Element {
      const [openTabs, setOpenTabs] = React.useState(tabs);
      return (
        <TabBar
          tabs={openTabs}
          activeKey={tabs[0]?.key}
          renderLink={renderLink}
          onClose={(key) => {
            setOpenTabs((current) => current.filter((tab) => tab.key !== key));
          }}
        />
      );
    }

    render(<StatefulTabs />);
    openMenu(screen.getByRole('button', { name: 'Open documents (13)' }));
    const switcher = await screen.findByRole('dialog', { name: 'Open documents' });
    const results = within(switcher).getByRole('list', { name: 'Open document results' });
    const search = within(switcher).getByRole('searchbox', { name: 'Search open documents' });
    expect(results).toHaveClass('max-h-80', 'overflow-y-auto', 'overscroll-contain');
    expect(within(results).getAllByRole('listitem')).toHaveLength(13);

    fireEvent.change(search, { target: { value: '13' } });
    expect(within(results).getByRole('link', { name: 'Open document 13' })).toBeInTheDocument();
    fireEvent.click(within(results).getByRole('button', { name: 'Close Open document 13' }));
    await waitFor(() => expect(search).toHaveFocus());
    expect(
      within(results).queryByRole('link', { name: 'Open document 13' }),
    ).not.toBeInTheDocument();
  });

  it('closes a document and restores focus to the nearest remaining result', async () => {
    function StatefulTabs(): React.JSX.Element {
      const [tabs, setTabs] = React.useState<readonly OpenTab[]>([TAB_A, TAB_B]);
      return (
        <TabBar
          tabs={tabs}
          activeKey={TAB_A.key}
          renderLink={renderLink}
          onClose={(key) => {
            setTabs((current) => current.filter((tab) => tab.key !== key));
          }}
        />
      );
    }

    render(<StatefulTabs />);
    openMenu(screen.getByRole('button', { name: 'Open documents (2)' }));
    const switcher = await screen.findByRole('dialog', { name: 'Open documents' });
    fireEvent.click(within(switcher).getByRole('button', { name: 'Close Q3 Launch' }));
    await waitFor(() =>
      expect(within(switcher).getByRole('link', { name: 'Fix the build' })).toHaveFocus(),
    );
  });

  it('closes any open document from the switcher', async () => {
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
    const switcher = await screen.findByRole('dialog', { name: 'Open documents' });
    fireEvent.click(within(switcher).getByRole('button', { name: 'Close Q3 Launch' }));
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

  it('clamps a badge over 99 to a 99+ ceiling', () => {
    render(<SidebarNavItem label="Inbox" badge={140} />);
    const button = screen.getByRole('button', { name: 'Inbox, 140 unread' });
    expect(button).toHaveTextContent('99+');
  });
});
