import '@testing-library/jest-dom/vitest';

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { type JSX, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api', () => ({
  api: {
    v1: {
      orgs: {
        ':orgId': {
          mentions: {
            search: { $get: vi.fn() },
            external: { $get: vi.fn() },
            hydrate: { $post: vi.fn() },
          },
        },
      },
    },
  },
}));

vi.mock('@/components/active-org', () => ({
  useOptionalActiveOrg: () => null,
  useActiveOrgIdOptional: () => null,
  useActiveOrg: () => ({ activeOrgId: 'org_1' }),
}));

import { TooltipProvider } from '@docket/ui/primitives';

import { ComposerShell } from '@/components/composer/composer-shell';
import type { ComposerDraftControls } from '@/components/composer/use-composer-draft-persistence';

import { installProseMirrorLayoutShims } from '../editor/prosemirror-jsdom';
import { makeQueryWrapper } from '../support/query';

installProseMirrorLayoutShims();

afterEach(cleanup);

/** Fake draft controls with every answer spied. */
function fakeControls(overrides: Partial<ComposerDraftControls> = {}): ComposerDraftControls {
  return {
    items: [
      { id: 'draft_a', title: 'Grant report', updatedAt: new Date().toISOString() },
      { id: 'draft_b', title: null, updatedAt: new Date().toISOString() },
    ],
    currentId: 'draft_a',
    saving: 'saved',
    onLoad: vi.fn(),
    onDelete: vi.fn(),
    onKeep: vi.fn(() => Promise.resolve()),
    onDiscard: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
}

/** Render a composer that keeps drafts, with a typed title so closing prompts. */
function renderComposer(
  drafts: ComposerDraftControls,
  title = 'Draft a grant report',
): { readonly onOpenChange: ReturnType<typeof vi.fn> } {
  const onOpenChange = vi.fn();
  function Harness(): JSX.Element {
    const [value, setValue] = useState(title);
    const [body, setBody] = useState('');
    return (
      <ComposerShell
        open
        onOpenChange={onOpenChange}
        heading="New task"
        title={value}
        onTitleChange={setValue}
        titlePlaceholder="Task title"
        body={body}
        onBodyChange={setBody}
        bodyPlaceholder="Add a description"
        drafts={drafts}
        draftNoun="task"
        creating={false}
        canSubmit
        onSubmit={vi.fn()}
        submitLabel="Create task"
      >
        <div />
      </ComposerShell>
    );
  }
  const { wrapper: Wrapper } = makeQueryWrapper();
  render(
    <Wrapper>
      <TooltipProvider>
        <Harness />
      </TooltipProvider>
    </Wrapper>,
  );
  return { onOpenChange };
}

describe('the Drafts chip', () => {
  it('lists this composer’s drafts and loads or deletes one', async () => {
    const drafts = fakeControls();
    renderComposer(drafts);

    fireEvent.click(screen.getByRole('button', { name: 'Drafts, 2' }));
    const list = await screen.findByRole('list', { name: 'Saved drafts' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    const [current, untitled] = rows;
    if (!current || !untitled) throw new Error('expected two draft rows');
    // The draft being written is marked current; the untitled one still has a name.
    expect(current).toHaveAttribute('aria-current', 'true');
    expect(untitled).toHaveAttribute('aria-label', expect.stringMatching(/task/i));

    fireEvent.click(within(untitled).getByRole('button', { name: /Delete draft/ }));
    expect(drafts.onDelete).toHaveBeenCalledWith('draft_b');

    fireEvent.click(within(current).getByRole('button', { name: /^Grant report/ }));
    expect(drafts.onLoad).toHaveBeenCalledWith('draft_a');
  });

  it('is absent without drafts and shows a failed save', () => {
    renderComposer(fakeControls({ items: [], saving: 'error' }));

    expect(screen.queryByRole('button', { name: /Drafts,/ })).not.toBeInTheDocument();
    const status = screen.getByText(/not saved/i);
    expect(status).toHaveAttribute('role', 'status');
    expect(status).not.toHaveClass('sr-only');
  });
});

describe('the close prompt of a composer that keeps drafts', () => {
  it('offers Save draft as the focused primary and keeps the row', async () => {
    const drafts = fakeControls();
    const { onOpenChange } = renderComposer(drafts);

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    const save = await screen.findByRole('button', { name: 'Save draft' });
    await waitFor(() => {
      expect(save).toHaveFocus();
    });
    expect(screen.getByRole('button', { name: 'Keep editing' })).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(save);
    });

    expect(drafts.onKeep).toHaveBeenCalledOnce();
    expect(drafts.onDiscard).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it('deletes the row on Discard before closing', async () => {
    const drafts = fakeControls();
    const { onOpenChange } = renderComposer(drafts);

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Discard' }));
    });

    expect(drafts.onDiscard).toHaveBeenCalledOnce();
    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });
});
