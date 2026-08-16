/**
 * Behavior tests for {@link NotionSetupCard} — the one action a fresh Notion connection waits on.
 *
 * @remarks
 * These pin the three things the old card got wrong, each of which was a real consequence in
 * somebody else's Notion workspace rather than a matter of taste:
 *
 * - it defaulted to `parentPages[0]`, so pressing Create without opening the dropdown built nine
 *   databases inside whichever page Notion happened to return first;
 * - it listed every page the integration could see, unfiltered, in a native `<select>`;
 * - when nothing had been shared it told the reader to go use Notion's ••• menu and reload the
 *   page, which is a dead end rather than an action.
 *
 * The RPC client is mocked so these assert real behavior without touching the live API.
 */
import type { QueryClient } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { queryKeys } from '@/lib/query-keys';

import { choosePickerOption } from '../../support/pickers';
import { makeQueryWrapper, okResponse } from '../../support/query';

// Hoisted so the mock factories (lifted above imports) can reference them.
const { parentPagesGet, provisionPost, linkSocial } = vi.hoisted(() => ({
  parentPagesGet: vi.fn(),
  provisionPost: vi.fn(),
  linkSocial: vi.fn(),
}));

vi.mock('../../../src/lib/api', () => ({
  api: {
    v1: {
      orgs: {
        ':orgId': {
          integrations: {
            ':id': {
              notion: {
                'parent-pages': { $get: parentPagesGet },
                provision: { $post: provisionPost },
              },
            },
          },
        },
      },
    },
  },
}));

vi.mock('../../../src/lib/auth-client', () => ({ authClient: { linkSocial } }));

import { NotionSetupCard } from '../../../src/components/settings/notion/notion-setup-card';

const ORG_ID = 'org_1';
const INTEGRATION_ID = 'int_1';

const PAGE = (over: Record<string, unknown> = {}) => ({
  id: 'page_wiki',
  title: 'Team wiki',
  url: 'https://www.notion.so/team-wiki',
  icon: null,
  lastEditedTime: '2026-01-01T00:00:00.000Z',
  parentKind: 'workspace' as const,
  ...over,
});

function renderCard(canManage = true): QueryClient {
  const { client, wrapper } = makeQueryWrapper();
  render(<NotionSetupCard orgId={ORG_ID} integrationId={INTEGRATION_ID} canManage={canManage} />, {
    wrapper,
  });
  return client;
}

beforeEach(() => {
  vi.clearAllMocks();
  provisionPost.mockResolvedValue(okResponse({ status: 'succeeded' }));
});

afterEach(cleanup);

describe('NotionSetupCard', () => {
  it('will not create anything until a page has actually been chosen', async () => {
    // The regression that matters most. There is no implicit first-page default any more, so an
    // unattended Create cannot scatter nine databases into a page nobody looked at.
    parentPagesGet.mockResolvedValue(okResponse({ items: [PAGE(), PAGE({ id: 'page_b' })] }));
    renderCard();

    const create = await screen.findByRole('button', { name: 'Create in Notion' });
    expect(create).toBeDisabled();

    fireEvent.click(create);
    expect(provisionPost).not.toHaveBeenCalled();
  });

  it('creates under the page that was picked', async () => {
    parentPagesGet.mockResolvedValue(
      okResponse({ items: [PAGE(), PAGE({ id: 'page_handbook', title: 'Handbook' })] }),
    );
    renderCard();

    fireEvent.click(await screen.findByRole('button', { name: /Notion page/ }));
    await screen.findByRole('option', { name: /Handbook/ });
    choosePickerOption(/Handbook/);

    const create = await screen.findByRole('button', { name: 'Create in Notion' });
    await waitFor(() => {
      expect(create).toBeEnabled();
    });
    fireEvent.click(create);

    await waitFor(() => {
      expect(provisionPost).toHaveBeenCalled();
    });
    const call = provisionPost.mock.calls[0] as [{ json: { containerPageId: string } }];
    expect(call[0].json).toEqual({ containerPageId: 'page_handbook' });
  });

  it('searches at the server rather than filtering the list it already has', async () => {
    // Typing must issue a narrowed request. Filtering locally would mean the browser had already
    // paid to download a workspace, which is the cost this whole change removes.
    parentPagesGet.mockResolvedValue(okResponse({ items: [PAGE()] }));
    renderCard();

    fireEvent.click(await screen.findByRole('button', { name: /Notion page/ }));
    fireEvent.change(await screen.findByLabelText('Search Notion page'), {
      target: { value: 'handbook' },
    });

    await waitFor(() => {
      expect(
        parentPagesGet.mock.calls.some(
          (call) => (call[0] as { query?: { q?: string } }).query?.q === 'handbook',
        ),
      ).toBe(true);
    });
  });

  it('offers to reopen consent when the connection can see no pages', async () => {
    // A public Notion integration only sees what was ticked at connect time, so this is a common
    // first run. It needs an action, not an instruction to go elsewhere and come back.
    parentPagesGet.mockResolvedValue(okResponse({ items: [] }));
    renderCard();

    const share = await screen.findByRole('button', { name: 'Choose pages to share' });
    expect(screen.queryByRole('button', { name: 'Create in Notion' })).not.toBeInTheDocument();

    fireEvent.click(share);
    expect(linkSocial).toHaveBeenCalledWith(expect.objectContaining({ provider: 'notion' }));
  });

  it('refetches the connection itself, not just its databases, after provisioning', async () => {
    // Provisioning writes the container page into `integration.config`, and the hub reads it from
    // the integrations list — a different query. Without invalidating that too, the surface
    // reports success and then cannot show the page it just created, because the list it reads
    // from still holds the config from before the write.
    parentPagesGet.mockResolvedValue(okResponse({ items: [PAGE()] }));
    const client = renderCard();
    const invalidate = vi.spyOn(client, 'invalidateQueries');

    fireEvent.click(await screen.findByRole('button', { name: /Notion page/ }));
    await screen.findByRole('option', { name: /Team wiki/ });
    choosePickerOption(/Team wiki/);
    fireEvent.click(await screen.findByRole('button', { name: 'Create in Notion' }));

    await waitFor(() => {
      expect(provisionPost).toHaveBeenCalled();
    });
    await waitFor(() => {
      const keys = invalidate.mock.calls.map((call) => JSON.stringify(call[0]?.queryKey));
      expect(keys).toContain(JSON.stringify(queryKeys.integrations(ORG_ID)));
    });
  });

  it('reports a failed run as a failure, even though it arrives as a 200', async () => {
    // The provision route answers 200 carrying the run. Letting that read as success is exactly
    // the dishonesty the connector-reliability rule forbids.
    parentPagesGet.mockResolvedValue(okResponse({ items: [PAGE()] }));
    provisionPost.mockResolvedValue(okResponse({ status: 'failed' }));
    renderCard();

    fireEvent.click(await screen.findByRole('button', { name: /Notion page/ }));
    await screen.findByRole('option', { name: /Team wiki/ });
    choosePickerOption(/Team wiki/);
    fireEvent.click(await screen.findByRole('button', { name: 'Create in Notion' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not finish creating/i);
  });
  it('withholds provisioning from a caller who cannot manage the workspace', async () => {
    // Every write behind this card is guarded at `manage` server-side. Rendering an enabled
    // "Create in Notion" for a contributor promised something the API answers with a bare 403.
    parentPagesGet.mockResolvedValue(okResponse({ items: [PAGE()] }));
    renderCard(false);

    expect(await screen.findByRole('button', { name: 'Create in Notion' })).toBeDisabled();
  });
});
