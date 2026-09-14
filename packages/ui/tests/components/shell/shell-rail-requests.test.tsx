import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Home } from '../../../src/icons';
import { AppShell } from '../../../src/components/shell/AppShell';
import { ContextProvider } from '../../../src/components/shell/ContextProvider';
import { useShellRail } from '../../../src/components/shell/ShellRailContext';
import { Sidebar } from '../../../src/components/shell/Sidebar';
import type { Workspace } from '../../../src/components/shell/workspaces';

const ACME: Workspace = { id: 'ORG00000000000000000000001', name: 'Acme Co' };
const WORKSPACES: readonly Workspace[] = [ACME];

const TASKS_PANEL = {
  id: 'tasks',
  label: 'Tasks',
  icon: <Home />,
  node: <div>Task list</div>,
};

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

/** Render the shell with one rail panel on a desktop-width window. */
function renderWithRail(
  main: React.ReactNode,
  railRequest?: { readonly panelId: string; readonly version: number },
): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: true,
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
            hrefForHome={(key) => `/${key}`}
            hrefForWorkspace={(orgId, key) => `/orgs/${orgId}/${key}`}
            renderLink={renderLink}
            onCreateWorkspace={() => undefined}
            onSelectWorkspace={() => undefined}
            onOpenSearch={() => undefined}
          />
        }
        aside={{ panels: [TASKS_PANEL], defaultPanelId: 'tasks' }}
        railRequest={railRequest}
      >
        {main}
      </AppShell>
    </ContextProvider>,
  );
}

function CollapseRailWhileMounted(): React.JSX.Element {
  const { requestCollapsed } = useShellRail();
  React.useEffect(() => requestCollapsed(), [requestCollapsed]);
  return <div>Canvas</div>;
}

describe('AppShell rail requests', () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('opens to a share of the viewport, never a fixed column', () => {
    renderWithRail(<div>Main</div>);

    // A viewport *share*, floored at 17.5rem and capped at 22rem. The bare fixed width this
    // replaced is what let a docked rail take 352px out of a 1024px window the moment a media
    // query flipped; the floor is what keeps the rail readable at the bottom of the range without
    // reintroducing that step.
    expect(screen.getByRole('complementary', { name: 'Tasks' })).toHaveClass(
      'w-[clamp(17.5rem,17vw,22rem)]',
    );
  });

  it('collapses and re-expands from its own activity-bar icon', () => {
    renderWithRail(<div>Main</div>);

    fireEvent.click(screen.getByRole('button', { name: 'Collapse Tasks' }));
    expect(screen.getByRole('complementary', { name: 'Tasks' })).toHaveClass('w-0');

    const activityBar = screen.getByRole('navigation', { name: 'Panels' });
    fireEvent.click(within(activityBar).getByRole('button', { name: 'Tasks' }));
    expect(screen.getByRole('complementary', { name: 'Tasks' })).toHaveClass(
      'w-[clamp(17.5rem,17vw,22rem)]',
    );
  });

  it('adopts a persisted collapsed choice after mount rather than at hydration', () => {
    // React does not patch attribute mismatches it finds while hydrating, so reading storage in
    // `useState`'s initializer left the server's class on the element forever and the viewer's saved
    // choice was silently dropped — visible now that the rail is server-rendered at every width.
    window.localStorage.setItem('docket.rail.collapsed', '1');
    renderWithRail(<div>Main</div>);

    expect(screen.getByRole('complementary', { name: 'Tasks' })).toHaveClass('w-0');
  });

  it('collapses the rail while a surface asks for room, without saving that choice', () => {
    window.localStorage.setItem('docket.rail.collapsed', '0');
    renderWithRail(<CollapseRailWhileMounted />);
    expect(screen.getByRole('complementary', { name: 'Tasks' })).toHaveClass('w-0');
    expect(window.localStorage.getItem('docket.rail.collapsed')).toBe('0');
  });

  it('expands the rail for a host request over a surface request, as the icon does', () => {
    window.localStorage.setItem('docket.rail.collapsed', '0');
    renderWithRail(<CollapseRailWhileMounted />, { panelId: 'tasks', version: 1 });
    expect(screen.getByRole('complementary', { name: 'Tasks' })).not.toHaveClass('w-0');
  });

  it('lets the viewer expand the rail over a request, and still saves nothing', () => {
    window.localStorage.setItem('docket.rail.collapsed', '0');
    renderWithRail(<CollapseRailWhileMounted />);
    const activityBar = screen.getByRole('navigation', { name: 'Panels' });
    fireEvent.click(within(activityBar).getByRole('button', { name: 'Tasks' }));
    expect(screen.getByRole('complementary', { name: 'Tasks' })).not.toHaveClass('w-0');
    expect(window.localStorage.getItem('docket.rail.collapsed')).toBe('0');
  });
});
