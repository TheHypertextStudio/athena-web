import '@testing-library/jest-dom/vitest';

import { render, screen, within } from '@testing-library/react';
import * as React from 'react';
import { describe, expect, it } from 'vitest';
import userEvent from '@testing-library/user-event';

import { ContextProvider } from '../../../src/components/shell/ContextProvider';
import { ShellSidebarProvider } from '../../../src/components/shell/ShellSidebarContext';
import { Sidebar } from '../../../src/components/shell/Sidebar';
import type { Workspace } from '../../../src/components/shell/workspaces';

const ACME: Workspace = { id: 'ORG00000000000000000000001', name: 'Acme Co' };

function renderRail(unreadCount?: number): void {
  render(
    <ContextProvider initialContext={ACME.id}>
      <ShellSidebarProvider value={{ collapsed: true, onToggle: () => undefined }}>
        <Sidebar
          workspaces={[ACME]}
          unreadCount={unreadCount}
          hrefForHome={(key) => `/${key}`}
          hrefForWorkspace={(orgId, key) => `/orgs/${orgId}/${key}`}
          renderLink={(href, content) => <a href={href}>{content}</a>}
          onSelectWorkspace={() => undefined}
          onCreateWorkspace={() => undefined}
          onOpenSearch={() => undefined}
        />
      </ShellSidebarProvider>
    </ContextProvider>,
  );
}

describe('collapsed sidebar navigation rail', () => {
  it('keeps the daily destinations visibly labeled', () => {
    renderRail();

    expect(screen.getByRole('navigation', { name: 'Primary navigation' })).toHaveTextContent(
      'TodayMy WorkCalendarInboxSearchAthenaMore',
    );
  });

  it('groups secondary destinations in More without dropping Inbox attention', async () => {
    const user = userEvent.setup();
    renderRail(3);

    expect(screen.getByRole('link', { name: 'Inbox, 3 unread' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'More navigation' }));

    const menu = screen.getByRole('menu');
    expect(within(menu).getByText('Workspace')).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Projects' })).toHaveAttribute(
      'href',
      `/orgs/${ACME.id}/projects`,
    );
    expect(within(menu).getByText('Manage')).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Settings' })).toHaveAttribute(
      'href',
      `/orgs/${ACME.id}/settings`,
    );
  });
});
