import '@testing-library/jest-dom/vitest';

import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/components/active-org', () => ({
  useActiveOrg: () => ({
    orgsLoading: false,
    orgsError: null,
    orgs: [
      { id: 'personal-1', name: 'Personal', isPersonal: true },
      { id: 'org-2', name: 'Transit team', isPersonal: false },
    ],
  }),
}));
vi.mock('../../src/components/docket-link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

import StartBillingPage from '../../src/app/(app)/billing/start/page';

afterEach(cleanup);

describe('StartBillingPage', () => {
  it('asks an authenticated customer which organization should receive Pro', () => {
    render(<StartBillingPage />);

    expect(screen.getByRole('heading', { name: 'Choose a workspace' })).toBeInTheDocument();
    expect(screen.getByText('Personal workspace')).toBeInTheDocument();
    expect(screen.getByText('Shared organization')).toBeInTheDocument();
    expect(
      screen.getAllByRole('link', { name: 'Choose' }).map((link) => link.getAttribute('href')),
    ).toEqual([
      '/orgs/personal-1/settings/billing?upgrade=1',
      '/orgs/org-2/settings/billing?upgrade=1',
    ]);
  });
});
