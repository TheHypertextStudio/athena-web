/**
 * `publishing` — regression coverage for the address list, the "Published pages" list, and
 * custom-domain verification state.
 *
 * @remarks
 * Assertions target structure and behavior (an `<a>` with the right `href`, an input's value, a
 * button's presence) rather than exact copy — copy must stay freely editable without breaking
 * these tests.
 *
 * Five things pinned here:
 *
 * 1. The original bug: a publication with no reachable URL used to fall back to
 *    `publication.path`, an internal routing string that could contain the literal placeholder
 *    token `:workspace`. These tests pin the honest replacement: a real link when one exists, no
 *    link (and never that placeholder) otherwise.
 * 2. The slug-unification follow-up: every workspace has exactly one identity slug
 *    (`organization.slug`), which is the last segment of its default address.
 * 3. Every address is one row of one list, and exactly one of them is marked `Primary`. A verified
 *    custom domain takes that mark from the default address, since it needs no workspace segment
 *    and the shared brief host may not even be configured for this deployment.
 * 4. The default address is renamed in its own row — no navigation to another settings surface.
 * 5. A domain's "Verified" state is re-confirmed automatically on every view (no manual "re-check"
 *    affordance once verified — see `DomainRow`), so it can never silently go stale.
 */
import '@testing-library/jest-dom/vitest';

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as QueryModule from '../../../src/lib/query';

const {
  envMock,
  useApiQueryMock,
  useWorkspaceDomainsQueryMock,
  usePublicationsQueryMock,
  verifyMutateMock,
  renameMutateMock,
  useVerifyDomainMutationMock,
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
  renameMutateMock: vi.fn(),
  useVerifyDomainMutationMock: vi.fn(),
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
  useVerifyDomainMutation: useVerifyDomainMutationMock,
  useRemoveDomainMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useRenameAddressMutation: () => ({
    mutate: renameMutateMock,
    isPending: false,
    isSuccess: false,
    error: null,
  }),
}));

vi.mock('../../../src/components/settings/use-can-manage-org', () => ({
  useCanManageOrg: () => ({ canManage: true, loading: false }),
}));

import { PublishingSettings } from '../../../src/components/publishing/publishing-settings';
import { assertDefined } from '@docket/test-utils';

const clipboardWriteText = vi.fn<(text: string) => Promise<void>>();

beforeEach(() => {
  clipboardWriteText.mockResolvedValue();
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: clipboardWriteText },
    configurable: true,
  });
  useVerifyDomainMutationMock.mockReturnValue({
    mutate: verifyMutateMock,
    isPending: false,
    data: null,
    error: null,
  });
});

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
  routingRecord?: { type: string; name: string; value: string; ttlSeconds: number } | null;
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
      value: 'docket-verify=abc123',
      ttlSeconds: 300,
    },
    routingRecord: overrides.routingRecord ?? null,
    createdAt: '2026-08-01T00:00:00.000Z',
  };
}

/** Render the surface with the three queries stubbed. */
function renderSettings(options: { domains?: unknown[]; publications?: unknown[] } = {}): void {
  useApiQueryMock.mockReturnValue({ data: { slug: 'acme' } });
  useWorkspaceDomainsQueryMock.mockReturnValue({
    data: { items: options.domains ?? [] },
    isPending: false,
  });
  usePublicationsQueryMock.mockReturnValue({
    data: { items: options.publications ?? [] },
    isPending: false,
  });
  render(<PublishingSettings orgId="org_1" />);
}

/** The list row for one address, found by the host text it states. */
function addressRow(text: string): HTMLElement {
  const row = screen.getByText(text).closest('li');
  expect(row).not.toBeNull();
  return assertDefined(row);
}

/** The default address row — always first in the Addresses list, regardless of what it says. */
function defaultAddressRow(): HTMLElement {
  const list = screen.getByRole('region', { name: 'Addresses' });
  const [row] = within(list).getAllByRole('listitem');
  return assertDefined(row);
}

describe('PublishingSettings — Published pages list', () => {
  it('renders no link when the publication has no reachable URL', () => {
    renderSettings({ publications: [publication({ id: 'pub_1', published: true, urls: [] })] });

    const list = screen.getByRole('region', { name: 'Published pages' });
    const row = within(list).getByRole('listitem');
    expect(within(row).queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByText(/:workspace/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\/briefs\//)).not.toBeInTheDocument();
  });

  it('renders a real clickable link when the publication has a reachable URL', () => {
    renderSettings({
      publications: [
        publication({
          id: 'pub_1',
          published: true,
          urls: ['https://briefs.docket.example/acme/my-project'],
        }),
      ],
    });

    const list = screen.getByRole('region', { name: 'Published pages' });
    expect(within(list).getByRole('link')).toHaveAttribute(
      'href',
      'https://briefs.docket.example/acme/my-project',
    );
  });
});

describe('PublishingSettings — the address list', () => {
  it('states the default address as one whole URL, host and slug together', () => {
    envMock.NEXT_PUBLIC_BRIEF_HOST = 'briefs.docket.example';
    renderSettings();

    const row = addressRow('briefs.docket.example/acme');
    expect(within(row).getByRole('link')).toHaveAttribute(
      'href',
      'https://briefs.docket.example/acme/',
    );
  });

  it('never fabricates a domain when none is configured and none is verified', () => {
    renderSettings();

    const row = defaultAddressRow();
    expect(within(row).queryByRole('link')).not.toBeInTheDocument();
  });

  it('never presents the bare workspace identity as a web address', () => {
    // The identity slug (e.g. an org named "Las Vegans for Better Transit" -> "lvbt") is an internal
    // key, not a URL — no host, no scheme, nothing a visitor could type into a browser.
    renderSettings();

    const row = defaultAddressRow();
    expect(within(row).queryByText('acme')).not.toBeInTheDocument();
  });

  it('marks the default address Primary while no custom domain has taken over', () => {
    envMock.NEXT_PUBLIC_BRIEF_HOST = 'briefs.docket.example';
    renderSettings({
      domains: [domain({ id: 'dom_1', host: 'pending.acme.com', verified: false })],
    });

    expect(within(addressRow('briefs.docket.example/acme')).getByText('Primary')).toBeVisible();
    expect(within(addressRow('pending.acme.com')).queryByText('Primary')).not.toBeInTheDocument();
  });

  it('moves Primary onto a verified custom domain that actually routes here', () => {
    envMock.NEXT_PUBLIC_BRIEF_HOST = 'briefs.docket.example';
    renderSettings({
      domains: [
        domain({
          id: 'dom_1',
          host: 'updates.acme.com',
          verified: true,
          routingRecord: {
            type: 'CNAME',
            name: 'updates.acme.com',
            value: 'briefs.docket.example',
            ttlSeconds: 300,
          },
        }),
      ],
    });

    // Not `addressRow`: a real CNAME's Name field is the host itself, so the row's own DNS
    // record duplicates the host text — the link's accessible name stays unambiguous.
    const link = screen.getByRole('link', { name: 'updates.acme.com' });
    const row = assertDefined(link.closest('li'));
    expect(within(row).getByText('Primary')).toBeVisible();
    expect(link).toHaveAttribute('href', 'https://updates.acme.com/');
    expect(
      within(addressRow('briefs.docket.example/acme')).queryByText('Primary'),
    ).not.toBeInTheDocument();
  });

  it('withholds Primary and the live link from a verified domain with nowhere to route', () => {
    envMock.NEXT_PUBLIC_BRIEF_HOST = 'briefs.docket.example';
    renderSettings({
      domains: [domain({ id: 'dom_1', host: 'updates.acme.com', verified: true })],
    });

    const row = addressRow('updates.acme.com');
    expect(within(row).queryByText('Primary')).not.toBeInTheDocument();
    expect(within(row).queryByRole('link')).not.toBeInTheDocument();
    // Nothing is actually served by the unroutable domain, so the default address keeps the mark.
    expect(within(addressRow('briefs.docket.example/acme')).getByText('Primary')).toBeVisible();
  });

  it('withholds Primary when there is only one address for it to distinguish', () => {
    envMock.NEXT_PUBLIC_BRIEF_HOST = 'briefs.docket.example';
    renderSettings();

    expect(screen.queryByText('Primary')).not.toBeInTheDocument();
  });

  it('calls the default address unreachable where the deployment configures no shared host', () => {
    renderSettings({
      domains: [domain({ id: 'dom_1', host: 'updates.acme.com', verified: true })],
    });

    const row = defaultAddressRow();
    expect(within(row).getByText(/not reachable/i)).toBeVisible();
    expect(within(row).queryByText('Primary')).not.toBeInTheDocument();
  });

  it('renames the default address in its own row, with no trip to another settings page', async () => {
    const user = userEvent.setup();
    envMock.NEXT_PUBLIC_BRIEF_HOST = 'briefs.docket.example';
    renderSettings();

    expect(screen.queryByRole('link', { name: /general settings/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /rename workspace address/i }));

    const input = screen.getByRole('textbox', { name: /workspace address/i });
    expect(input).toHaveValue('acme');
    // The host is fused into the control, so the slug is never a bare word with no context.
    expect(input.closest('span')?.textContent).toContain('briefs.docket.example');
  });
});

describe('PublishingSettings — custom domain verification state', () => {
  it('re-confirms an already-verified domain automatically, with no manual affordance to do it', () => {
    renderSettings({
      domains: [domain({ id: 'dom_1', host: 'updates.acme.com', verified: true })],
    });

    expect(verifyMutateMock).toHaveBeenCalledWith('dom_1');
    const row = addressRow('updates.acme.com');
    expect(within(row).queryByRole('button', { name: /check/i })).not.toBeInTheDocument();
    expect(within(row).getByRole('button', { name: /remove/i })).toBeInTheDocument();
  });

  it('re-checks a pending domain on its own instead of asking the operator to poll it', () => {
    vi.useFakeTimers();
    try {
      renderSettings({
        domains: [domain({ id: 'dom_2', host: 'pending.acme.com', verified: false })],
      });

      expect(verifyMutateMock).not.toHaveBeenCalled();
      act(() => {
        vi.advanceTimersByTime(20_000);
      });
      expect(verifyMutateMock).toHaveBeenCalledWith('dom_2');
    } finally {
      vi.useRealTimers();
    }
  });

  it('states plainly that a verified domain with nowhere to route is not serving', () => {
    renderSettings({
      domains: [domain({ id: 'dom_1', host: 'updates.acme.com', verified: true })],
    });

    const row = addressRow('updates.acme.com');
    expect(within(row).getByRole('status')).toHaveTextContent(/isn.t serving/i);
  });

  it('offers a retry when the automatic re-check of an already-verified domain fails', () => {
    useVerifyDomainMutationMock.mockReturnValue({
      mutate: verifyMutateMock,
      isPending: false,
      data: null,
      error: new Error('network error'),
    });
    renderSettings({
      domains: [domain({ id: 'dom_1', host: 'updates.acme.com', verified: true })],
    });

    const row = addressRow('updates.acme.com');
    expect(within(row).getByRole('alert')).toBeInTheDocument();
    // Stale success-cache still says Verified — the failure must not be the only place that shows.
    expect(within(row).getByText('Verified')).toBeVisible();
    const retry = within(row).getByRole('button', { name: /check/i });
    fireEvent.click(retry);
    expect(verifyMutateMock).toHaveBeenCalledWith('dom_1');
  });

  it('offers a manual check for an unverified domain, and does not auto-verify it', () => {
    renderSettings({
      domains: [
        domain({
          id: 'dom_2',
          host: 'pending.acme.com',
          verified: false,
          lastFailure: 'no-record',
        }),
      ],
    });

    expect(verifyMutateMock).not.toHaveBeenCalled();
    expect(
      within(addressRow('pending.acme.com')).getByRole('button', { name: /check/i }),
    ).toBeInTheDocument();
  });

  it('asks before releasing a domain rather than removing it on the first press', async () => {
    const user = userEvent.setup();
    renderSettings({
      domains: [domain({ id: 'dom_1', host: 'updates.acme.com', verified: true })],
    });

    const row = addressRow('updates.acme.com');
    await user.click(within(row).getByRole('button', { name: 'Remove updates.acme.com' }));

    expect(
      within(row).getByRole('button', { name: /confirm removing updates\.acme\.com/i }),
    ).toBeInTheDocument();
  });
});

describe('PublishingSettings — DNS records', () => {
  // `fireEvent`, not `userEvent`: `userEvent.setup()` installs its own `navigator.clipboard` stub
  // over the one this file asserts against.
  it('puts each record field on the clipboard verbatim, from a control of its own', async () => {
    renderSettings({
      domains: [domain({ id: 'dom_2', host: 'pending.acme.com', verified: false })],
    });

    const row = addressRow('pending.acme.com');

    fireEvent.click(within(row).getByRole('button', { name: /copy name/i }));
    await waitFor(() => {
      expect(clipboardWriteText).toHaveBeenCalledWith('_docket-verify.pending.acme.com');
    });

    fireEvent.click(within(row).getByRole('button', { name: /copy value/i }));
    await waitFor(() => {
      expect(clipboardWriteText).toHaveBeenCalledWith('docket-verify=abc123');
    });
  });

  it('offers no copy control for the record type, which is chosen rather than pasted', () => {
    renderSettings({
      domains: [domain({ id: 'dom_2', host: 'pending.acme.com', verified: false })],
    });

    const row = addressRow('pending.acme.com');
    expect(within(row).queryByRole('button', { name: /copy type/i })).not.toBeInTheDocument();
    expect(within(row).getByText('TXT')).toBeVisible();
  });
});
