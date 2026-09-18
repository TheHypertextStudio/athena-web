import '@testing-library/jest-dom/vitest';

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

import { ComposerShell } from '@/components/composer/composer-shell';

import { installProseMirrorLayoutShims } from '../editor/prosemirror-jsdom';
import { makeQueryWrapper } from '../support/query';

installProseMirrorLayoutShims();

afterEach(cleanup);

/** What the harness exposes for assertions. */
interface PromptHarness {
  readonly onSubmit: ReturnType<typeof vi.fn>;
  readonly onContinue: ReturnType<typeof vi.fn>;
  readonly onOpenChange: ReturnType<typeof vi.fn>;
}

/** A composer with a typed title, so every close path has to go through the prompt. */
function renderDirtyComposer(): PromptHarness {
  const onSubmit = vi.fn();
  const onContinue = vi.fn();
  const onOpenChange = vi.fn();

  function Harness(): JSX.Element {
    const [title, setTitle] = useState('Draft a grant report');
    const [body, setBody] = useState('');
    return (
      <ComposerShell
        open
        onOpenChange={onOpenChange}
        heading="New task"
        title={title}
        onTitleChange={setTitle}
        titlePlaceholder="Task title"
        body={body}
        onBodyChange={setBody}
        bodyPlaceholder="Add a description"
        continuation={{ checked: false, onCheckedChange: vi.fn(), onSubmit: onContinue }}
        creating={false}
        canSubmit
        onSubmit={onSubmit}
        submitLabel="Create task"
      >
        <div />
      </ComposerShell>
    );
  }

  const { wrapper: Wrapper } = makeQueryWrapper();
  render(
    <Wrapper>
      <Harness />
    </Wrapper>,
  );
  return { onSubmit, onContinue, onOpenChange };
}

/** The composer's form element, which the raw-submit path targets. */
function composerForm(): HTMLFormElement {
  const form = screen.getByRole('button', { name: 'Create task' }).closest('form');
  if (form === null) throw new Error('The composer renders its fields inside a form.');
  return form;
}

/** Open the prompt through the dialog's own close control. */
async function openPrompt(): Promise<HTMLElement> {
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  return screen.findByRole('button', { name: 'Keep editing' });
}

describe('composer discard prompt', () => {
  it('refuses every submit path while the prompt is showing', async () => {
    const { onSubmit, onContinue, onOpenChange } = renderDirtyComposer();
    const form = composerForm();

    const keepEditing = await openPrompt();
    await waitFor(() => {
      expect(keepEditing).toHaveFocus();
    });
    expect(screen.queryByRole('button', { name: 'Create task' })).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Task title' })).toBeDisabled();

    // Enter in the title, Enter in the body, the create-and-continue chord, and a raw form
    // submit: none may create the object the prompt has visually replaced.
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Task title' }), { key: 'Enter' });
    fireEvent.submit(form);
    fireEvent.keyDown(screen.getByRole('dialog'), {
      key: 'Enter',
      shiftKey: true,
      metaKey: true,
    });

    expect(onSubmit).not.toHaveBeenCalled();
    expect(onContinue).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('returns to an editable, focused draft on Keep editing and then creates once', async () => {
    const { onSubmit, onOpenChange } = renderDirtyComposer();
    const keepEditing = await openPrompt();

    await act(async () => {
      fireEvent.click(keepEditing);
    });

    expect(screen.queryByRole('button', { name: 'Keep editing' })).not.toBeInTheDocument();
    const title = screen.getByRole('textbox', { name: 'Task title' });
    expect(title).toBeEnabled();
    await waitFor(() => {
      expect(title).toHaveFocus();
    });
    expect(onOpenChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Create task' }));
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it('answers a second Escape with Keep editing', async () => {
    const { onOpenChange } = renderDirtyComposer();
    await openPrompt();

    await act(async () => {
      fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    });

    expect(screen.queryByRole('button', { name: 'Keep editing' })).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Task title' })).toBeEnabled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('closes on Discard', async () => {
    const { onOpenChange } = renderDirtyComposer();
    await openPrompt();

    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
