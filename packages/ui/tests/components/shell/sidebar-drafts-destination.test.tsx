import '@testing-library/jest-dom/vitest';

/**
 * Drafts as a Home destination that exists only while there is a draft to return to.
 *
 * @remarks
 * A person who has never set a composer aside should not see a row for it: the row would be a
 * dead destination, which the design system bans. Once a draft exists the row appears in Home,
 * links to the host's `/drafts` route, and carries the count as its badge, the way Inbox carries
 * unread. These tests hold both halves.
 */
import { render, screen, within } from '@testing-library/react';
import * as React from 'react';
import { describe, expect, it } from 'vitest';

import { ContextProvider } from '../../../src/components/shell/ContextProvider';
import { Sidebar } from '../../../src/components/shell/Sidebar';

const ORG_ID = 'ORG00000000000000000000001';

/** A test `renderLink` mirroring the host's Next `Link` — a real, inspectable anchor. */
function renderLink(href: string, content: React.ReactNode): React.ReactNode {
  return <a href={href}>{content}</a>;
}

/** Render the sidebar with a given number of drafts to return to. */
function renderSidebar(draftCount: number | undefined, activeHomeKey?: 'drafts'): void {
  render(
    <ContextProvider initialContext={ORG_ID}>
      <Sidebar
        workspaces={[{ id: ORG_ID, name: 'Acme Co' }]}
        draftCount={draftCount}
        activeHomeKey={activeHomeKey}
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

describe('Drafts in the Home nav', () => {
  it('is absent while there is nothing to return to', () => {
    renderSidebar(0);

    const home = screen.getByRole('navigation', { name: 'Home' });
    expect(within(home).queryByRole('link', { name: /Drafts/ })).toBeNull();
    // Absent by default too: a host that has not counted yet must not show a dead row.
    renderSidebar(undefined);
    expect(screen.queryAllByRole('link', { name: /Drafts/ })).toHaveLength(0);
  });

  it('appears beside Inbox with the count once a draft exists', () => {
    renderSidebar(2);

    const home = screen.getByRole('navigation', { name: 'Home' });
    const drafts = within(home).getByRole('link', { name: 'Drafts, 2 drafts' });
    expect(drafts).toHaveAttribute('href', '/drafts');
    expect(within(home).getByRole('link', { name: /Inbox/ })).toBeInTheDocument();
  });

  it('marks itself the current page when the Drafts route is open', () => {
    renderSidebar(1, 'drafts');

    const home = screen.getByRole('navigation', { name: 'Home' });
    expect(within(home).getByRole('link', { name: 'Drafts, 1 drafts' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });
});
