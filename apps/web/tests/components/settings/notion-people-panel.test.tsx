/**
 * Behavior tests for {@link NotionPeoplePanel} — who is who across Notion and Docket.
 *
 * @remarks
 * This file exists because its absence is how the original defect shipped. "Don't sync them" wrote
 * a state byte-identical to "nobody has decided", and the panel bucketed people by `actorId` alone
 * — so pressing Apply refreshed the list and put the person straight back into the group of
 * decisions still to make. Every request succeeded, so nothing below the UI could catch it.
 *
 * The cases here therefore pin the bucketing itself, not just that the request goes out.
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { makeQueryWrapper, okResponse } from '../../support/query';

// Hoisted so the mock factory (lifted above imports) can reference them.
const { peopleGet, unmatchedGet, membersGet, resolvePost } = vi.hoisted(() => ({
  peopleGet: vi.fn(),
  unmatchedGet: vi.fn(),
  membersGet: vi.fn(),
  resolvePost: vi.fn(),
}));

vi.mock('../../../src/lib/api', () => ({
  api: {
    v1: {
      orgs: {
        ':orgId': {
          integrations: {
            ':id': {
              notion: {
                people: {
                  $get: peopleGet,
                  ':externalId': { resolve: { $post: resolvePost } },
                },
                'unmatched-people': { $get: unmatchedGet },
              },
            },
          },
          members: { $get: membersGet },
        },
      },
    },
  },
}));

import { NotionPeoplePanel } from '../../../src/components/settings/notion/notion-people-panel';
// Imported rather than spelled out, so the wording stays a product decision the copy module owns.
import { UNIGNORE_ACTION } from '../../../src/components/settings/notion/notion-copy';

const ORG_ID = 'org_1';
const INTEGRATION_ID = 'int_1';

/** One Notion workspace member as `GET …/people` returns it. */
function person(over: Record<string, unknown> = {}) {
  return {
    externalId: 'notion-1',
    name: 'Sam S',
    email: 'sam@example.com',
    avatarUrl: null,
    actorId: null,
    matchedBy: null,
    ignoredAt: null,
    ...over,
  };
}

function renderPanel(): void {
  const { wrapper } = makeQueryWrapper();
  render(<NotionPeoplePanel orgId={ORG_ID} integrationId={INTEGRATION_ID} />, { wrapper });
}

/** The decision select and its Apply button, for the one unmatched row on screen. */
async function decisionRow(): Promise<{ select: HTMLElement; apply: HTMLElement }> {
  const select = await screen.findByRole('combobox');
  const apply = screen.getByRole('button', { name: 'Apply' });
  return { select, apply };
}

beforeEach(() => {
  vi.clearAllMocks();
  unmatchedGet.mockResolvedValue(okResponse({ docketOnly: 0 }));
  membersGet.mockResolvedValue(okResponse({ items: [] }));
  resolvePost.mockResolvedValue(okResponse(person({ ignoredAt: '2026-08-12T00:00:00Z' })));
});

afterEach(cleanup);

describe('NotionPeoplePanel — deciding about a person', () => {
  it('asks about somebody nobody has decided on yet', async () => {
    peopleGet.mockResolvedValue(okResponse({ items: [person()] }));
    renderPanel();

    const { select } = await decisionRow();
    expect(select).toBeInTheDocument();
  });

  it('sends the skip decision when "don’t sync them" is applied', async () => {
    peopleGet.mockResolvedValue(okResponse({ items: [person()] }));
    renderPanel();

    const { select, apply } = await decisionRow();
    await userEvent.selectOptions(select, 'skip');
    await userEvent.click(apply);

    expect(resolvePost).toHaveBeenCalledWith({
      param: { orgId: ORG_ID, id: INTEGRATION_ID, externalId: 'notion-1' },
      json: { action: 'skip' },
    });
  });

  it('takes a skipped person OUT of the decisions still to make', async () => {
    // The defect, stated as a test. `ignoredAt` is the only thing distinguishing this row from an
    // undecided one; bucketing on `actorId` alone put them back in the list and made Apply look
    // like it had done nothing at all.
    peopleGet.mockResolvedValue(
      okResponse({ items: [person({ ignoredAt: '2026-08-12T00:00:00Z' })] }),
    );
    renderPanel();

    expect(await screen.findByRole('button', { name: UNIGNORE_ACTION })).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Apply' })).not.toBeInTheDocument();
  });

  it('offers the way back, so an exclusion is never a one-way door', async () => {
    peopleGet.mockResolvedValue(
      okResponse({ items: [person({ ignoredAt: '2026-08-12T00:00:00Z' })] }),
    );
    renderPanel();

    await userEvent.click(await screen.findByRole('button', { name: UNIGNORE_ACTION }));

    expect(resolvePost).toHaveBeenCalledWith({
      param: { orgId: ORG_ID, id: INTEGRATION_ID, externalId: 'notion-1' },
      json: { action: 'unignore' },
    });
  });

  it('leaves a matched person out of both groups', async () => {
    peopleGet.mockResolvedValue(okResponse({ items: [person({ actorId: 'act_1' })] }));
    renderPanel();

    // Rendering at all proves the query resolved; neither decision affordance should be present.
    await screen.findByText(/have no Notion account/);
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: UNIGNORE_ACTION })).not.toBeInTheDocument();
  });

  it('does not claim the workspace is empty when everyone in it was skipped', async () => {
    // `ignored` is still evidence the roster was learned. Reporting "no Notion people yet" would
    // deny the decisions the reader just made.
    peopleGet.mockResolvedValue(
      okResponse({ items: [person({ ignoredAt: '2026-08-12T00:00:00Z' })] }),
    );
    renderPanel();

    await screen.findByRole('button', { name: UNIGNORE_ACTION });
    expect(screen.queryByText(/No Notion people yet/)).not.toBeInTheDocument();
  });
});
