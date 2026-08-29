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
  renderRecentDocumentIcon?: (document: OpenTab) => React.ReactNode,
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
          renderRecentDocumentIcon={renderRecentDocumentIcon}
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

  it('uses the compact target and M3 active-indicator geometry', () => {
    renderRail();

    const primary = screen.getByRole('navigation', { name: 'Primary navigation' });
    const destinations = primary.firstElementChild;
    const scrollRegion = primary.closest('[data-slot="navigation-rail-scroll-region"]');
    const today = screen.getByRole('link', { name: 'Today' });
    const indicator = today.querySelector('[data-slot="navigation-rail-active-indicator"]');
    const icon = indicator?.querySelector('svg');

    expect(destinations).toHaveClass('gap-1');
    expect(scrollRegion).toHaveClass('-mx-px', 'w-16.5');
    expect(today).toHaveClass('mx-auto', 'min-h-14', 'w-16');
    expect(indicator).toHaveClass('h-8', 'w-14', 'rounded-full');
    expect(icon).toHaveClass('size-6');
  });

  it('keeps selection on the indicator and selected label', () => {
    renderRail();

    const today = screen.getByRole('link', { name: 'Today' });
    const indicator = today.querySelector('[data-slot="navigation-rail-active-indicator"]');
    const label = today.querySelector('[data-slot="navigation-rail-label"]');

    expect(today).toHaveClass('hover:bg-transparent', 'focus-visible:ring-0');
    expect(indicator).toHaveClass('bg-secondary-container', 'text-on-secondary-container');
    expect(label).toHaveClass('text-secondary');
    expect(label).not.toHaveClass('font-semibold', 'font-bold');
  });

  it('paints M3 interaction layers and the focus ring on the indicator pill', () => {
    renderRail();

    const today = screen.getByRole('link', { name: 'Today' });
    const calendar = screen.getByRole('link', { name: 'Calendar' });
    const selectedIndicator = today.querySelector('[data-slot="navigation-rail-active-indicator"]');
    const selectedLayer = today.querySelector('[data-slot="navigation-rail-state-layer"]');
    const unselectedLayer = calendar.querySelector('[data-slot="navigation-rail-state-layer"]');

    expect(selectedIndicator).toHaveClass(
      'group-focus-visible:outline-3',
      'group-focus-visible:outline-secondary',
      'group-focus-visible:outline-offset-2',
    );
    expect(selectedLayer).toHaveClass(
      'bg-primary',
      'opacity-0',
      'group-hover:opacity-4',
      'group-active:opacity-8',
      'group-focus-visible:opacity-12',
      'group-hover:group-focus-visible:opacity-16',
    );
    expect(unselectedLayer).toHaveClass(
      'bg-on-surface',
      'opacity-0',
      'group-hover:opacity-4',
      'group-active:opacity-8',
      'group-focus-visible:opacity-12',
      'group-hover:group-focus-visible:opacity-16',
    );
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
    expect(project).toHaveClass('h-12', 'w-14');
    expect(project.querySelector('svg')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Recent: Ship the rail' })).toBeInTheDocument();
  });

  it('uses the host entity identity renderer for recent document icons', () => {
    const project: OpenTab = {
      key: `project:${ACME.id}:01JBBBBBBBBBBBBBBBBBBBBBBB`,
      type: 'project',
      orgId: ACME.id,
      id: '01JBBBBBBBBBBBBBBBBBBBBBBB',
      title: 'Rewrite onboarding',
      href: `/orgs/${ACME.id}/projects/01JBBBBBBBBBBBBBBBBBBBBBBB`,
    };

    renderRail(undefined, [project], undefined, (document) => (
      <span data-testid="saved-entity-identity" data-document-id={document.id} />
    ));

    const recent = screen.getByRole('link', { name: 'Recent: Rewrite onboarding' });
    expect(recent).toContainElement(screen.getByTestId('saved-entity-identity'));
    expect(screen.getByTestId('saved-entity-identity')).toHaveAttribute(
      'data-document-id',
      project.id,
    );
  });
});
