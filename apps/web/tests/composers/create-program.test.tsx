/**
 * Behavior tests for the program-create composer's visibility picker.
 *
 * @remarks
 * The properties panel on an existing program already explains what public/private *does*
 * (`@/components/pickers/options`'s `VISIBILITY_OPTIONS`), but the create composer used to
 * build its own bare `{ value, label }` pair with no supporting copy — the exact "two bare words"
 * gap the launch note named, just reachable from a different screen. These tests pin that the
 * create composer's Visibility picker uses the same explanatory options as the properties panel,
 * and that the chosen value still threads through to the create DTO.
 *
 * The RPC client is mocked; the actor roster (the only composer option this dialog loads) is fed
 * through the mocked `$get`.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { programPost, membersGet, agentsGet } = vi.hoisted(() => ({
  programPost: vi.fn(),
  membersGet: vi.fn(),
  agentsGet: vi.fn(),
}));

vi.mock('../../src/lib/api', () => ({
  api: {
    v1: {
      orgs: {
        ':orgId': {
          programs: { $post: programPost },
          members: { $get: membersGet },
          agents: { $get: agentsGet },
        },
      },
    },
  },
}));

import { CreateProgramDialog } from '../../src/components/programs/create-program';
import { firstJson, jsonResponse } from '../support/http';
import { choosePickerOption } from '../support/pickers';

const ORG_ID = '0RG00000000000000000000001';

beforeEach(() => {
  programPost.mockReset();
  membersGet.mockReset().mockResolvedValue(jsonResponse(true, { items: [] }));
  agentsGet.mockReset().mockResolvedValue(jsonResponse(true, { items: [] }));
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
});

afterEach(() => {
  cleanup();
});

/** Render the composer open; returns the spy callbacks. */
function renderComposer() {
  const onCreated = vi.fn();
  const onOpenChange = vi.fn();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <CreateProgramDialog
        orgId={ORG_ID}
        programNoun="Program"
        open
        onOpenChange={onOpenChange}
        onCreated={onCreated}
      />
    </QueryClientProvider>,
  );
  return { onCreated, onOpenChange };
}

describe('CreateProgramDialog — visibility picker', () => {
  it('explains each choice in the menu instead of offering two bare words', async () => {
    renderComposer();

    fireEvent.click(screen.getByRole('button', { name: /Visibility/ }));
    const list = await screen.findByRole('listbox');
    const options = within(list).getAllByRole('option');

    expect(options).toHaveLength(2);
    expect(options[0]).toHaveTextContent('Public');
    expect(options[0]).toHaveTextContent('Anyone in this workspace can find it in search.');
    expect(options[1]).toHaveTextContent('Private');
    expect(options[1]).toHaveTextContent('Kept out of search for anyone without access to it.');
  });

  it('defaults to public and threads a chosen visibility through the create DTO', async () => {
    programPost.mockResolvedValue(jsonResponse(true, { id: 'prog_1', name: 'Ops' }));
    const { onCreated } = renderComposer();

    fireEvent.change(screen.getByLabelText('Program name'), { target: { value: 'Ops' } });
    fireEvent.click(screen.getByRole('button', { name: 'Visibility — Public' }));
    choosePickerOption(/Private/);
    fireEvent.click(screen.getByRole('button', { name: 'Create Program' }));

    await waitFor(() => {
      expect(programPost).toHaveBeenCalledTimes(1);
    });
    expect(firstJson(programPost.mock.calls)).toMatchObject({
      name: 'Ops',
      visibility: 'private',
    });
    expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: 'prog_1' }));
  });
});
