/**
 * `publishing` — regression coverage for the "Published pages" list, the read-only address
 * display, and custom-domain verification state.
 *
 * @remarks
 * Assertions target structure and behavior (an `<a>` with the right `href`, an input's value, a
 * button's presence) rather than exact copy — copy must stay freely editable without breaking
 * these tests.
 *
 * Three things pinned here:
 *
 * 1. The original bug: a publication with no reachable URL used to fall back to
 *    `publication.path`, an internal routing string that could contain the literal placeholder
 *    token `:workspace`. These tests pin the honest replacement: a real link when one exists, no
 *    link (and never that placeholder) otherwise.
 * 2. The slug-unification follow-up: every workspace has exactly one identity slug
 *    (`organization.slug`), edited in Settings → General — there is no more separate "claim a
 *    public name" step. A verified custom domain wins as the shown reachable address over the
 *    shared brief host, since it needs no workspace segment and the shared host may not even be
 *    configured for this deployment.
 * 3. A domain's "Verified" state is re-confirmed automatically on every view (no manual
 *    "re-check" affordance once verified — see `DomainRow`), so it can never silently go stale.
 */
import '@testing-library/jest-dom/vitest';

import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type * as QueryModule from '../../../src/lib/query';

const {
  envMock,
  useApiQueryMock,
  useWorkspaceDomainsQueryMock,
  usePublicationsQueryMock,
  verifyMutateMock,
} = vi.hoisted(() => ({
  envMock: {
    NEXT_PUBLIC_API_URL: 'https://api.docket.test',
    NEXT_PUBLIC_APP_URL: 'https://docket.test',
    NEXT_PUBLIC_PASSKEY_RP_ID: 'docket.test',
    NEXT_PUBLIC_BRIEF_HOST: undefined as string | undefined,
  },
  useApiQueryMock: vi.fn(),
  useWorkspaceDomainsQueryMock: vi.fn(),
  usePublicationsQueryMock: vi.fn(),
  verifyMutateMock: vi.fn(),
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
  useVerifyDomainMutation: () => ({ mutate: verifyMutateMock, isPending: false, data: null }),
  useRemoveDomainMutation: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('../../../src/components/settings/use-can-manage-org', () => ({
  useCanManageOrg: () => ({ canManage: true, loading: false }),
}));

import { PublishingSettings } from '../../../src/components/publishing/publishing-settings';
import { assertDefined } from '@docket/test-utils';

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

/** A workspace_domain row with every field a caller doesn't care about defaulted. */
function domain(overrides: {
  id: string;
  host: string;
  verified: boolean;
  lastFailure?: string | null;
}): unknown {
  return {
    id: overrides.id,
    organizationId: 'org_1',
    host: overrides.host,
    verified: overrides.verified,
    verifiedAt: overrides.verified ? '2026-08-01T00:00:00.000Z' : null,
    lastCheckedAt: '2026-08-01T00:00:00.000Z',
    lastFailure: overrides.lastFailure ?? null,
    verificationRecord: {
      type: 'TXT',
      name: `_docket-verify.${overrides.host}`,
      value: 'x',
      ttlSeconds: 300,
    },
    routingRecord: null,
    createdAt: '2026-08-01T00:00:00.000Z',
  };
}

describe('PublishingSettings — Published pages list', () => {
  it('renders no link when the publication has no reachable URL', () => {
    useApiQueryMock.mockReturnValue({ data: { slug: 'acme' } });
    useWorkspaceDomainsQueryMock.mockReturnValue({ data: { items: [] }, isPending: false });
    usePublicationsQueryMock.mockReturnValue({
      data: { items: [publication({ id: 'pub_1', published: true, urls: [] })] },
      isPending: false,
    });

    render(<PublishingSettings orgId="org_1" />);

    const row = screen.getByRole('listitem');
    expect(within(row).queryByRole('link')).not.toBeInTheDocument();
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

    const row = screen.getByRole('listitem');
    expect(within(row).getByRole('link')).toHaveAttribute(
      'href',
      'https://briefs.docket.example/acme/my-project',
    );
  });
});

describe('PublishingSettings — Workspace address display', () => {
  it('fuses the brief host into the identity input as a prefix once one is configured', () => {
    envMock.NEXT_PUBLIC_BRIEF_HOST = 'briefs.docket.example';
    useApiQueryMock.mockReturnValue({ data: { slug: 'acme' } });
    useWorkspaceDomainsQueryMock.mockReturnValue({ data: { items: [] }, isPending: false });
    usePublicationsQueryMock.mockReturnValue({ data: { items: [] }, isPending: false });

    render(<PublishingSettings orgId="org_1" />);

    const input = screen.getByDisplayValue('acme');
    expect(input).toHaveAttribute('readonly');
    // The prefix and the input share one fused box — see the `Input` `prefix` primitive.
    expect(input.closest('span')?.textContent).toContain('briefs.docket.example');
  });

  it('never fabricates a domain when none is configured and none is verified', () => {
    useApiQueryMock.mockReturnValue({ data: { slug: 'acme' } });
    useWorkspaceDomainsQueryMock.mockReturnValue({ data: { items: [] }, isPending: false });
    usePublicationsQueryMock.mockReturnValue({ data: { items: [] }, isPending: false });

    render(<PublishingSettings orgId="org_1" />);

    expect(screen.getByDisplayValue('acme')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /https?:\/\// })).not.toBeInTheDocument();
  });

  it('shows a verified custom domain as the reachable address, ahead of the shared brief host', () => {
    envMock.NEXT_PUBLIC_BRIEF_HOST = 'briefs.docket.example';
    useApiQueryMock.mockReturnValue({ data: { slug: 'acme' } });
    useWorkspaceDomainsQueryMock.mockReturnValue({
      data: { items: [domain({ id: 'dom_1', host: 'updates.acme.com', verified: true })] },
      isPending: false,
    });
    usePublicationsQueryMock.mockReturnValue({ data: { items: [] }, isPending: false });

    render(<PublishingSettings orgId="org_1" />);

    const addressSection = document.getElementById('workspace-address')?.closest('section');
    expect(addressSection).not.toBeNull();
    const reachableLink = within(assertDefined(addressSection))
      .getAllByRole('link')
      .find((link) => link.getAttribute('href')?.startsWith('https://'));
    expect(reachableLink).toHaveAttribute('href', 'https://updates.acme.com/');
  });

  it('links to General settings to change the identity', () => {
    useApiQueryMock.mockReturnValue({ data: { slug: 'acme' } });
    useWorkspaceDomainsQueryMock.mockReturnValue({ data: { items: [] }, isPending: false });
    usePublicationsQueryMock.mockReturnValue({ data: { items: [] }, isPending: false });

    render(<PublishingSettings orgId="org_1" />);

    expect(screen.getByRole('link', { name: /general settings/i })).toHaveAttribute(
      'href',
      '/orgs/org_1/settings/general',
    );
  });
});

describe('PublishingSettings — custom domain verification state', () => {
  it('re-confirms an already-verified domain automatically, with no manual affordance to do it', () => {
    useApiQueryMock.mockReturnValue({ data: { slug: 'acme' } });
    useWorkspaceDomainsQueryMock.mockReturnValue({
      data: { items: [domain({ id: 'dom_1', host: 'updates.acme.com', verified: true })] },
      isPending: false,
    });
    usePublicationsQueryMock.mockReturnValue({ data: { items: [] }, isPending: false });

    render(<PublishingSettings orgId="org_1" />);

    expect(verifyMutateMock).toHaveBeenCalledWith('dom_1');
    const domainRow = screen.getByText('updates.acme.com').closest('li');
    expect(domainRow).not.toBeNull();
    expect(
      within(assertDefined(domainRow)).queryByRole('button', { name: /check/i }),
    ).not.toBeInTheDocument();
    expect(
      within(assertDefined(domainRow)).getByRole('button', { name: /remove/i }),
    ).toBeInTheDocument();
  });

  it('offers a manual check for an unverified domain, and does not auto-verify it', () => {
    useApiQueryMock.mockReturnValue({ data: { slug: 'acme' } });
    useWorkspaceDomainsQueryMock.mockReturnValue({
      data: {
        items: [
          domain({
            id: 'dom_2',
            host: 'pending.acme.com',
            verified: false,
            lastFailure: 'no-record',
          }),
        ],
      },
      isPending: false,
    });
    usePublicationsQueryMock.mockReturnValue({ data: { items: [] }, isPending: false });

    render(<PublishingSettings orgId="org_1" />);

    expect(verifyMutateMock).not.toHaveBeenCalled();
    const domainRow = screen.getByText('pending.acme.com').closest('li');
    expect(domainRow).not.toBeNull();
    expect(
      within(assertDefined(domainRow)).getByRole('button', { name: /check/i }),
    ).toBeInTheDocument();
  });
});
