import '@testing-library/jest-dom/vitest';

import { render, screen } from '@testing-library/react';
import * as React from 'react';
import { describe, expect, it } from 'vitest';

import { ContextProvider } from '../../../src/components/shell/ContextProvider';
import { ShellSidebarProvider } from '../../../src/components/shell/ShellSidebarContext';
import { Sidebar } from '../../../src/components/shell/Sidebar';
import type { OpenTab } from '../../../src/components/shell/tab-types';
import type { Workspace } from '../../../src/components/shell/workspaces';

const ACME: Workspace = { id: 'ORG00000000000000000000001', name: 'Acme Co' };

function renderRail(
  unreadCount?: number,
  recentDocuments: readonly OpenTab[] = [],
  activeDocumentKey?: string,
): void {
  render(
    <ContextProvider initialContext={ACME.id}>
      <ShellSidebarProvider value={{ collapsed: true, onToggle: () => undefined }}>
        <Sidebar
          workspaces={[ACME]}
          activeHomeKey="today"
          unreadCount={unreadCount}
          recentDocuments={recentDocuments}
          activeDocumentKey={activeDocumentKey}
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
      'TodayMy WorkCalendarInboxSearchAthena',
    );
  });

  it('uses expansion instead of a duplicate More navigation menu', () => {
    renderRail();

    expect(screen.getByRole('button', { name: 'Expand navigation' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'More navigation' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Projects' })).not.toBeInTheDocument();
  });

  it('uses the baseline MD3 item and active-indicator geometry', () => {
    renderRail();

    const primary = screen.getByRole('navigation', { name: 'Primary navigation' });
    const destinations = primary.firstElementChild;
    const today = screen.getByRole('link', { name: 'Today' });
    const indicator = today.querySelector('[data-slot="navigation-rail-active-indicator"]');
    const icon = indicator?.querySelector('svg');

    expect(destinations).toHaveClass('gap-0');
    expect(today).toHaveClass('min-h-[3.75rem]');
    expect(indicator).toHaveClass('h-8', 'w-14', 'rounded-full');
    expect(icon).toHaveClass('size-6');
  });

  it('paints destination interaction states on the indicator instead of the hit box', () => {
    renderRail();

    const today = screen.getByRole('link', { name: 'Today' });
    const indicator = today.querySelector('[data-slot="navigation-rail-active-indicator"]');

    expect(today).toHaveClass('hover:bg-transparent', 'focus-visible:ring-0');
    expect(indicator).toHaveClass('group-focus-visible:ring-2', 'group-focus-visible:ring-ring');
  });

  it('keeps the expand control at the 40px auxiliary-control target', () => {
    renderRail();

    expect(screen.getByRole('button', { name: 'Expand navigation' })).toHaveClass('h-10', 'w-10');
  });

  it('gives each persisted navigation identity one unique shared-element name', () => {
    renderRail();

    const names = [...document.querySelectorAll<HTMLElement>('[style*="view-transition-name"]')]
      .map((element) => element.style.viewTransitionName)
      .sort();

    expect(names).toEqual([
      'navigation-home-athena',
      'navigation-home-calendar',
      'navigation-home-inbox',
      'navigation-home-search',
      'navigation-home-today',
      'navigation-workspace',
      'navigation-workspace-my-work',
    ]);
  });

  it('keeps Inbox attention on the direct destination', () => {
    renderRail(3);

    expect(screen.getByRole('link', { name: 'Inbox, 3 unread' })).toBeInTheDocument();
  });

  it('shows recent documents as bounded primary-icon shortcuts', () => {
    const recentDocuments: readonly OpenTab[] = [
      {
        key: `project:${ACME.id}:01JBBBBBBBBBBBBBBBBBBBBBBB`,
        type: 'project',
        orgId: ACME.id,
        id: '01JBBBBBBBBBBBBBBBBBBBBBBB',
        title: 'Rewrite onboarding',
        href: `/orgs/${ACME.id}/projects/01JBBBBBBBBBBBBBBBBBBBBBBB`,
      },
      {
        key: `task:${ACME.id}:01JCCCCCCCCCCCCCCCCCCCCCCC`,
        type: 'task',
        orgId: ACME.id,
        id: '01JCCCCCCCCCCCCCCCCCCCCCCC',
        title: 'Ship the rail',
        href: `/orgs/${ACME.id}/tasks/01JCCCCCCCCCCCCCCCCCCCCCCC`,
      },
    ];

    renderRail(undefined, recentDocuments, recentDocuments[0]?.key);

    const recent = screen.getByRole('navigation', { name: 'Recent' });
    const project = screen.getByRole('link', { name: 'Recent: Rewrite onboarding' });
    expect(recent).toContainElement(project);
    expect(project).toHaveAttribute('href', recentDocuments[0]?.href);
    expect(project).toHaveAttribute('aria-current', 'page');
    expect(project).toHaveClass('h-10', 'w-10');
    expect(project.querySelector('svg')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Recent: Ship the rail' })).toBeInTheDocument();
  });
});
