import '@testing-library/jest-dom/vitest';

/**
 * Tasks as a first-class **workspace** destination in the sidebar.
 *
 * @remarks
 * The audit's finding was structural, not cosmetic: `tasks` existed only in the cross-org Home
 * group, so the Workspace group ran "…Initiatives · Programs · Projects · Cycles…" with no Tasks
 * beside them, and a workspace's own task roster was reachable only by first opening a project, an
 * initiative or a cycle. These tests hold the fix at the two places it can regress —
 *
 * 1. the row's **presence and company**: Tasks is a direct row of the Workspace nav, in the same
 *    flat list as Projects and Initiatives, with no disclosure or sub-group between them, in a
 *    personal workspace and in a shared org alike (a personal space drops Teams and People — it
 *    must never drop Tasks);
 * 2. the row's **destination and state**: it links to the host's workspace-tasks route and marks
 *    itself `aria-current="page"` when that route is open, which is what makes it read as a
 *    destination rather than a shortcut into somewhere else.
 *
 * The Home group keeps its own Tasks row. That is deliberate and is asserted here so a later reader
 * does not "clean up" the duplicate: the two rows are two altitudes over one noun ("what is on my
 * plate anywhere" vs "what work exists in this workspace"), exactly as Stream already is.
 */
import { render, screen, within } from '@testing-library/react';
import * as React from 'react';
import { describe, expect, it } from 'vitest';

import { ContextProvider } from '../../../src/components/shell/ContextProvider';
import { Sidebar } from '../../../src/components/shell/Sidebar';
import type { WorkspaceNavKey } from '../../../src/components/shell/workspaces';

const ORG_ID = 'ORG00000000000000000000001';

/** A test `renderLink` mirroring the host's Next `Link` — a real, inspectable anchor. */
function renderLink(href: string, content: React.ReactNode): React.ReactNode {
  return <a href={href}>{content}</a>;
}

/** Render the sidebar bound to a workspace, in either the personal or the shared-org presentation. */
function renderSidebar(options: {
  readonly personalWorkspace: boolean;
  readonly activeWorkspaceKey?: WorkspaceNavKey;
}): void {
  render(
    <ContextProvider initialContext={ORG_ID}>
      <Sidebar
        workspaces={[{ id: ORG_ID, name: 'Acme Co' }]}
        personalWorkspace={options.personalWorkspace}
        activeWorkspaceKey={options.activeWorkspaceKey}
        hrefForHome={(key) => `/${key}`}
        hrefForWorkspace={(orgId, key) => `/orgs/${orgId}/${key}`}
        renderLink={renderLink}
        onSelectWorkspace={() => undefined}
        onCreateWorkspace={() => undefined}
        onOpenSearch={() => undefined}
      />
    </ContextProvider>,
  );
}

/** The Workspace group's rows, in render order, by visible label. */
function workspaceRowLabels(): string[] {
  const nav = screen.getByRole('navigation', { name: 'Workspace' });
  return [...nav.querySelectorAll('a')].map((row) => row.textContent.trim());
}

describe.each([
  { presentation: 'a personal workspace', personalWorkspace: true },
  { presentation: 'a shared org workspace', personalWorkspace: false },
])('Tasks in the Workspace nav of $presentation', ({ personalWorkspace }) => {
  it('renders beside Projects and Initiatives in one flat group', () => {
    renderSidebar({ personalWorkspace });

    const labels = workspaceRowLabels();
    expect(labels).toContain('Tasks');
    expect(labels).toContain('Projects');
    expect(labels).toContain('Initiatives');

    // "Beside", concretely: one list, so every row is a sibling of every other. A row hidden behind
    // a disclosure would not be a sibling — it would be a descendant of a control.
    const nav = screen.getByRole('navigation', { name: 'Workspace' });
    const tasksRow = within(nav).getByRole('link', { name: 'Tasks' });
    const projectsRow = within(nav).getByRole('link', { name: 'Projects' });
    expect(tasksRow.parentElement).toBe(projectsRow.parentElement);
    expect(within(nav).queryByRole('group')).toBeNull();
    expect(nav.querySelector('details, [aria-expanded]')).toBeNull();
  });

  it('links to the workspace-scoped Tasks route, not a cross-org or nested one', () => {
    renderSidebar({ personalWorkspace });

    const nav = screen.getByRole('navigation', { name: 'Workspace' });
    expect(within(nav).getByRole('link', { name: 'Tasks' })).toHaveAttribute(
      'href',
      `/orgs/${ORG_ID}/tasks`,
    );
  });

  it('marks itself the current page when the Tasks route is open', () => {
    renderSidebar({ personalWorkspace, activeWorkspaceKey: 'tasks' });

    const nav = screen.getByRole('navigation', { name: 'Workspace' });
    const tasksRow = within(nav).getByRole('link', { name: 'Tasks' });
    expect(tasksRow).toHaveAttribute('aria-current', 'page');
    // Exactly one row may claim the page.
    expect(nav.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
  });
});

describe('the two Tasks altitudes', () => {
  it('keeps a cross-org Tasks row in Home as well as the workspace one', () => {
    renderSidebar({ personalWorkspace: false });

    const home = screen.getByRole('navigation', { name: 'Home' });
    expect(within(home).getByRole('link', { name: 'Tasks' })).toHaveAttribute('href', '/tasks');
    // Same noun, different altitude — as with Stream, which also spans both groups.
    expect(within(home).getByRole('link', { name: 'Stream' })).toBeInTheDocument();
  });

  it('drops Teams and People in a personal workspace but never Tasks', () => {
    renderSidebar({ personalWorkspace: true });

    const labels = workspaceRowLabels();
    expect(labels).not.toContain('Teams');
    expect(labels).not.toContain('People');
    expect(labels).toContain('Tasks');
  });
});
