import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Home } from '../../../src/icons';
import { AppShell } from '../../../src/components/shell/AppShell';
import { ContextProvider } from '../../../src/components/shell/ContextProvider';
import { useRailPresentation } from '../../../src/components/shell/RailPresentationContext';
import { Sidebar } from '../../../src/components/shell/Sidebar';
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

/** A rail panel body that reports which host is rendering it, for {@link useRailPresentation}. */
function PresentationProbe(): React.JSX.Element {
  const presentation = useRailPresentation();
  return <p>Presentation: {presentation}</p>;
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

describe('AppShell rail presentation', () => {
  it('tells a panel which host is rendering it, so it can drop its own header in the sheet', async () => {
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
    const athena = { id: 'athena', label: 'Athena', icon: <Home />, node: <PresentationProbe /> };
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
          aside={{ panels: [athena], defaultPanelId: 'athena' }}
        >
          <div>Main</div>
        </AppShell>
      </ContextProvider>,
    );

    // The docked host is in the DOM at every width (CSS-hidden below `lg`), and it never supplies
    // its own header row, so it always reports `docked`.
    const dockedHost = document.getElementById('shell-aside');
    expect(dockedHost).not.toBeNull();
    expect(
      within(dockedHost ?? document.body).getByText('Presentation: docked'),
    ).toBeInTheDocument();

    // The mobile utility sheet supplies its own title row (the panel switcher plus a close
    // button) — the one place the same panel body must know to leave its own header out.
    fireEvent.click(screen.getByRole('button', { name: 'Show Athena' }));
    const overlay = await screen.findByRole('dialog', { name: 'Athena' });
    expect(within(overlay).getByText('Presentation: sheet')).toBeInTheDocument();
  });
});
