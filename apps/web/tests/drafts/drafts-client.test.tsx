import '@testing-library/jest-dom/vitest';

import { OrganizationId } from '@docket/identity-access/ids';
import type { ComposerDraftOut } from '@docket/work/composer-draft-contract';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { draftsGet, draftDelete, openCreate } = vi.hoisted(() => ({
  draftsGet: vi.fn(),
  draftDelete: vi.fn(),
  openCreate: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  api: {
    v1: {
      me: {
        drafts: Object.assign({ $get: draftsGet }, { ':id': { $delete: draftDelete } }),
      },
    },
  },
}));

vi.mock('@/components/active-org', () => ({
  useActiveOrg: () => ({
    activeOrgId: '0RG00000000000000000000001',
    orgs: [
      { id: '0RG00000000000000000000001', name: 'Alpha workspace' },
      { id: '0RG00000000000000000000002', name: 'Bravo workspace' },
    ],
  }),
}));

vi.mock('@/components/create-object/create-object-provider', () => ({
  useCreateObject: () => ({ openCreate, closeCreate: vi.fn(), request: null }),
}));

import DraftsClient from '@/app/(app)/drafts/drafts-client';

import { jsonResponse } from '../support/http';
import { makeQueryWrapper } from '../support/query';

function draft(overrides: Partial<ComposerDraftOut>): ComposerDraftOut {
  const now = new Date().toISOString();
  return {
    id: 'draft_1',
    organizationId: '0RG00000000000000000000001',
    kind: 'task',
    revision: 0,
    payload: { kind: 'task' },
    title: null,
    createdAt: now,
    updatedAt: now,
    expiresAt: now,
    ...overrides,
  } as ComposerDraftOut;
}

function renderPage(): void {
  const { wrapper: Wrapper } = makeQueryWrapper();
  render(
    <Wrapper>
      <DraftsClient />
    </Wrapper>,
  );
}

beforeEach(() => {
  draftsGet.mockReset();
  draftDelete.mockReset().mockResolvedValue(new Response(null, { status: 204 }));
  openCreate.mockReset();
});

afterEach(cleanup);

describe('the Drafts page', () => {
  it('groups drafts by what they become and opens one in its composer', async () => {
    draftsGet.mockResolvedValue(
      jsonResponse(true, {
        items: [
          draft({ id: 'draft_t', kind: 'task', title: 'Call the caterer' }),
          draft({
            id: 'draft_p',
            kind: 'project',
            title: 'Spring gala',
            organizationId: OrganizationId.parse('0RG00000000000000000000002'),
          }),
        ],
      }),
    );
    renderPage();

    const projects = await screen.findByRole('grid', { name: 'Projects' });
    const tasks = screen.getByRole('grid', { name: 'Tasks' });
    expect(within(projects).getByRole('row', { name: /Spring gala/ })).toBeInTheDocument();
    expect(within(projects).getByRole('row', { name: /Bravo workspace/ })).toBeInTheDocument();
    const taskRow = within(tasks).getByRole('row', { name: /Call the caterer/ });

    fireEvent.click(taskRow);
    expect(openCreate).toHaveBeenCalledWith({
      kind: 'task',
      sameWorkspaceCompletion: 'open',
      initialWorkspaceId: '0RG00000000000000000000001',
      draftId: 'draft_t',
    });
  });

  it('deletes a draft from its row without opening it', async () => {
    draftsGet.mockResolvedValue(
      jsonResponse(true, { items: [draft({ id: 'draft_t', title: 'Call the caterer' })] }),
    );
    renderPage();

    const remove = await screen.findByRole('button', { name: /Delete draft/ });
    fireEvent.click(remove);

    expect(draftDelete).toHaveBeenCalledWith({ param: { id: 'draft_t' } });
    expect(openCreate).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.queryByRole('row', { name: /Call the caterer/ })).not.toBeInTheDocument();
    });
  });

  it('shows an empty state with no drafts', async () => {
    draftsGet.mockResolvedValue(jsonResponse(true, { items: [] }));
    renderPage();

    expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByRole('grid')).not.toBeInTheDocument();
    });
    expect(screen.getByText(/no drafts/i)).toBeInTheDocument();
  });
});
