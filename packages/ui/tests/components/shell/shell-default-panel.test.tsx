import '@testing-library/jest-dom/vitest';

import { cleanup, render, screen } from '@testing-library/react';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Calendar, Sparkles } from '../../../src/icons';
import { AppShell } from '../../../src/components/shell/AppShell';
import { ContextProvider } from '../../../src/components/shell/ContextProvider';
import { Sidebar } from '../../../src/components/shell/Sidebar';
import type { RailPanel } from '../../../src/components/shell/ShellAside';
import type { Workspace } from '../../../src/components/shell/workspaces';

const ACME: Workspace = { id: 'ORG00000000000000000000001', name: 'Acme Co' };
const WORKSPACES: readonly Workspace[] = [ACME];

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

/**
 * Mirrors `railAsideFor` in `apps/web/src/components/app-shell-frame.tsx`: Athena leads the rail
 * and its default panel flips to Athena while its status carries the `attention` tone.
 */
function railAside(athenaTone: 'attention' | null): {
  panels: readonly RailPanel[];
  defaultPanelId: string;
} {
  const athena: RailPanel = {
    id: 'athena',
    label: 'Athena',
    icon: <Sparkles />,
    node: <div>Athena conversation</div>,
    ...(athenaTone ? { status: { tone: athenaTone, label: 'Waiting on you' } } : {}),
  };
  const agenda: RailPanel = {
    id: 'agenda',
    label: 'Agenda',
    icon: <Calendar />,
    node: <div>Agenda plan</div>,
  };
  return {
    panels: [athena, agenda],
    defaultPanelId: athenaTone === 'attention' ? 'athena' : 'agenda',
  };
}

/** Render the shell on a desktop-width window, where the rail's default panel is visible. */
function renderShell(aside: { panels: readonly RailPanel[]; defaultPanelId: string }) {
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
  return render(
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
        aside={aside}
      >
        <div>Main</div>
      </AppShell>
    </ContextProvider>,
  );
}

describe('AppShell default panel', () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('opens on Athena while its status is waiting on the person', () => {
    renderShell(railAside('attention'));

    expect(screen.getByRole('complementary', { name: 'Athena' })).toBeInTheDocument();
  });

  it('keeps Athena open once the waiting status clears, instead of jumping to Agenda', () => {
    const view = renderShell(railAside('attention'));
    expect(screen.getByRole('complementary', { name: 'Athena' })).toBeInTheDocument();

    // Approving the waiting change clears Athena's `attention` tone, which flips
    // `railAsideFor`'s computed `defaultPanelId` to `'agenda'` on the very next render. With no
    // persisted `activeId`, the shell must not re-read that new default and move the open rail out
    // from under the person mid-session.
    view.rerender(
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
          aside={railAside(null)}
        >
          <div>Main</div>
        </AppShell>
      </ContextProvider>,
    );

    expect(screen.getByRole('complementary', { name: 'Athena' })).toBeInTheDocument();
  });
});
