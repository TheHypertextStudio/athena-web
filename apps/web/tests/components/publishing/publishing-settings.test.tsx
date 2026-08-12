/**
 * `publishing` — regression coverage for the "Published pages" list and the read-only address
 * display.
 *
 * @remarks
 * Two things pinned here:
 *
 * 1. The original bug: a publication with no reachable URL (`urls: []`) used to fall back to
 *    `publication.path`, an internal routing string that contained the literal placeholder token
 *    `:workspace` when unclaimed — so the UI rendered a broken address directly. These tests pin
 *    the honest replacement: a real link when one exists, a plain "not reachable" message
 *    otherwise, never `path` or the placeholder token.
 * 2. The slug-unification follow-up: every workspace now has exactly one identity slug
 *    (`organization.slug`), edited in Settings → General — there is no more separate "claim a
 *    public name" step or unclaimed state. This page shows that slug read-only, fused with the
 *    shared brief host when one is configured for this deployment.
 */
import '@testing-library/jest-dom/vitest';

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type * as QueryModule from '../../../src/lib/query';

const { envMock, useApiQueryMock, useWorkspaceDomainsQueryMock, usePublicationsQueryMock } =
  vi.hoisted(() => ({
    envMock: {
      NEXT_PUBLIC_API_URL: 'https://api.docket.test',
      NEXT_PUBLIC_APP_URL: 'https://docket.test',
      NEXT_PUBLIC_PASSKEY_RP_ID: 'docket.test',
      NEXT_PUBLIC_BRIEF_HOST: undefined as string | undefined,
    },
    useApiQueryMock: vi.fn(),
    useWorkspaceDomainsQueryMock: vi.fn(),
    usePublicationsQueryMock: vi.fn(),
  }));

// A live object, not a snapshot: `env.NEXT_PUBLIC_BRIEF_HOST` is read at render time, so mutating
// this between tests changes what the component sees on its next render — no import-time
// `createEnv` validation to fight, unlike importing the real `@docket/env/web`.
vi.mock('@docket/env/web', () => ({ env: envMock }));

vi.mock('../../../src/lib/query', async () => {
  const actual = await vi.importActual<typeof QueryModule>('../../../src/lib/query');
  return { ...actual, useApiQuery: useApiQueryMock, apiQueryOptions: () => ({}) };
});

vi.mock('../../../src/components/publishing/use-publishing', () => ({
  useWorkspaceDomainsQuery: useWorkspaceDomainsQueryMock,
  usePublicationsQuery: usePublicationsQueryMock,
  useAddDomainMutation: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  useVerifyDomainMutation: () => ({ mutate: vi.fn(), isPending: false, data: null }),
  useRemoveDomainMutation: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('../../../src/components/settings/use-can-manage-org', () => ({
  useCanManageOrg: () => ({ canManage: true, loading: false }),
}));

import { PublishingSettings } from '../../../src/components/publishing/publishing-settings';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  envMock.NEXT_PUBLIC_BRIEF_HOST = undefined;
});

/** A publication row with every field a caller doesn't care about defaulted. */
function publication(overrides: { id: string; published: boolean; urls: string[] }): unknown {
  return {
    id: overrides.id,
    organizationId: 'org_1',
    subjectKind: 'project',
    subjectId: 'proj_1',
    slug: 'my-project',
    published: overrides.published,
    publishedAt: overrides.published ? '2026-08-01T00:00:00.000Z' : null,
    unpublishedAt: null,
    path: '/acme/my-project',
    urls: overrides.urls,
  };
}

describe('PublishingSettings — Published pages list', () => {
  it('shows an honest "not reachable" message instead of the internal path when urls is empty', () => {
    useApiQueryMock.mockReturnValue({ data: { slug: 'acme' } });
    useWorkspaceDomainsQueryMock.mockReturnValue({ data: { items: [] }, isPending: false });
    usePublicationsQueryMock.mockReturnValue({
      data: { items: [publication({ id: 'pub_1', published: true, urls: [] })] },
      isPending: false,
    });

    render(<PublishingSettings orgId="org_1" />);

    expect(screen.getByText('Not reachable yet')).toBeInTheDocument();
    expect(screen.queryByText(/:workspace/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\/briefs\//)).not.toBeInTheDocument();
  });

  it('renders a real clickable link when the publication has a reachable URL', () => {
    useApiQueryMock.mockReturnValue({ data: { slug: 'acme' } });
    useWorkspaceDomainsQueryMock.mockReturnValue({ data: { items: [] }, isPending: false });
    usePublicationsQueryMock.mockReturnValue({
      data: {
        items: [
          publication({
            id: 'pub_1',
            published: true,
            urls: ['https://briefs.docket.example/acme/my-project'],
          }),
        ],
      },
      isPending: false,
    });

    render(<PublishingSettings orgId="org_1" />);

    const link = screen.getByRole('link', {
      name: 'https://briefs.docket.example/acme/my-project',
    });
    expect(link).toHaveAttribute('href', 'https://briefs.docket.example/acme/my-project');
    expect(screen.queryByText('Not reachable yet')).not.toBeInTheDocument();
  });
});

describe('PublishingSettings — Workspace address display', () => {
  it('shows the real host inline as a prefix once one is configured for this deployment', () => {
    envMock.NEXT_PUBLIC_BRIEF_HOST = 'briefs.docket.example';
    useApiQueryMock.mockReturnValue({ data: { slug: 'acme' } });
    useWorkspaceDomainsQueryMock.mockReturnValue({ data: { items: [] }, isPending: false });
    usePublicationsQueryMock.mockReturnValue({ data: { items: [] }, isPending: false });

    render(<PublishingSettings orgId="org_1" />);

    expect(screen.getByText('briefs.docket.example/')).toBeInTheDocument();
    const input = screen.getByDisplayValue('acme');
    expect(input).toHaveAttribute('readonly');
    expect(input.parentElement).toBe(screen.getByText('briefs.docket.example/').parentElement);
  });

  it('shows the bare slug with no fabricated domain when no brief host is configured', () => {
    useApiQueryMock.mockReturnValue({ data: { slug: 'acme' } });
    useWorkspaceDomainsQueryMock.mockReturnValue({ data: { items: [] }, isPending: false });
    usePublicationsQueryMock.mockReturnValue({ data: { items: [] }, isPending: false });

    render(<PublishingSettings orgId="org_1" />);

    expect(screen.getByDisplayValue('acme')).toBeInTheDocument();
    expect(screen.queryByText(/https?:\/\//)).not.toBeInTheDocument();
    expect(
      screen.getByText('No shared brief host is configured for this deployment.'),
    ).toBeInTheDocument();
  });

  it('links to General settings to change the address', () => {
    useApiQueryMock.mockReturnValue({ data: { slug: 'acme' } });
    useWorkspaceDomainsQueryMock.mockReturnValue({ data: { items: [] }, isPending: false });
    usePublicationsQueryMock.mockReturnValue({ data: { items: [] }, isPending: false });

    render(<PublishingSettings orgId="org_1" />);

    expect(screen.getByRole('link', { name: 'Change in General settings' })).toHaveAttribute(
      'href',
      '/orgs/org_1/settings/general',
    );
  });
});
