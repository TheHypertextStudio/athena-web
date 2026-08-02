import '@testing-library/jest-dom/vitest';

import { render, screen, within } from '@testing-library/react';
import * as React from 'react';
import { describe, expect, it } from 'vitest';

import { ContextProvider } from '../../../src/components/shell/ContextProvider';
import { Sidebar } from '../../../src/components/shell/Sidebar';

/**
 * The Workspace rows' labels under the default (startup) vocabulary. Every one is a compile-time
 * constant in `Sidebar`, which is the whole reason none of them may be replaced by a placeholder.
 */
const WORKSPACE_LABELS = [
  'My Work',
  'Triage',
  'Tasks',
  'Stream',
  'Initiatives',
  'Programs',
  'Projects',
  'Cycles',
  'Teams',
  'Views',
  'Graph',
  'Settings',
] as const;

/** A test `renderLink` mirroring the host's Next `Link` (a real anchor). */
function renderLink(href: string, content: React.ReactNode): React.ReactNode {
  return <a href={href}>{content}</a>;
}

/** Render the sidebar with no bound workspace and the workspace list still unknown. */
function renderUnresolvedSidebar(): void {
  render(
    <ContextProvider initialContext={null}>
      <Sidebar
        loading
        workspaces={[]}
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

describe('Sidebar workspace navigation before a workspace resolves', () => {
  it('renders every workspace label rather than a placeholder standing in for it', () => {
    renderUnresolvedSidebar();

    const workspaceNav = screen.getByRole('navigation', { name: 'Workspace' });
    for (const label of WORKSPACE_LABELS) {
      expect(within(workspaceNav).getByText(label)).toBeInTheDocument();
    }
  });

  it('makes the rows inert instead of grey bars — same text, no destination', () => {
    renderUnresolvedSidebar();

    const workspaceNav = screen.getByRole('navigation', { name: 'Workspace' });
    // There is no workspace to build an href against, so nothing here may be navigable…
    expect(workspaceNav.querySelectorAll('a')).toHaveLength(0);
    // …but every row is still a real, labelled control at its real height.
    const rows = within(workspaceNav).getAllByRole('button');
    expect(rows).toHaveLength(WORKSPACE_LABELS.length);
    for (const row of rows) expect(row).toBeDisabled();
  });

  it('renders no loading placeholder anywhere in the Workspace section', () => {
    renderUnresolvedSidebar();

    const workspaceNav = screen.getByRole('navigation', { name: 'Workspace' });
    expect(workspaceNav.querySelectorAll('.animate-pulse, [data-slot="skeleton"]')).toHaveLength(0);
  });

  it('does not flash the empty state in the gap between the list arriving and a workspace binding', () => {
    // The list has resolved and plainly contains a workspace; the host just has not bound one yet.
    // Showing "No workspace yet" here would be false, and showing a grey bar would say less than
    // the labels do.
    render(
      <ContextProvider initialContext={null}>
        <Sidebar
          workspaces={[{ id: 'ORG00000000000000000000001', name: 'Acme Co' }]}
          hrefForHome={(key) => `/${key}`}
          hrefForWorkspace={(orgId, key) => `/orgs/${orgId}/${key}`}
          renderLink={renderLink}
          onSelectWorkspace={() => undefined}
          onCreateWorkspace={() => undefined}
          onOpenSearch={() => undefined}
        />
      </ContextProvider>,
    );

    expect(screen.queryByText('No workspace yet')).not.toBeInTheDocument();
    const workspaceNav = screen.getByRole('navigation', { name: 'Workspace' });
    expect(within(workspaceNav).getByText('Projects')).toBeInTheDocument();
    expect(workspaceNav.querySelectorAll('.animate-pulse, [data-slot="skeleton"]')).toHaveLength(0);
  });

  it('still shows the settled empty state once the workspace list is known to be empty', () => {
    // `loading` false with no bound workspace is a different fact from "not yet known": the caller
    // genuinely belongs to no workspace, and saying so is more useful than eleven dead rows.
    render(
      <ContextProvider initialContext={null}>
        <Sidebar
          workspaces={[]}
          hrefForHome={(key) => `/${key}`}
          hrefForWorkspace={(orgId, key) => `/orgs/${orgId}/${key}`}
          renderLink={renderLink}
          onSelectWorkspace={() => undefined}
          onCreateWorkspace={() => undefined}
          onOpenSearch={() => undefined}
        />
      </ContextProvider>,
    );

    expect(screen.getByText('No workspace yet')).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Workspace' })).not.toBeInTheDocument();
  });
});
