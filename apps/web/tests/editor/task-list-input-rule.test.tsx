import '@testing-library/jest-dom/vitest';

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FreeformTextEditor } from '@/components/editor/freeform-text';

import { makeQueryWrapper } from '../support/query';
import { installProseMirrorLayoutShims } from './prosemirror-jsdom';

vi.mock('@/components/active-org', () => ({
  useOptionalActiveOrg: () => ({ activeOrgId: null }),
  useActiveOrgIdOptional: () => null,
  useActiveOrg: () => ({ activeOrgId: null }),
}));

installProseMirrorLayoutShims();

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** Render the editor and return the typing harness. */
function renderEditor(value = '') {
  const onChange = vi.fn<(next: string) => void>();
  const { wrapper: Wrapper } = makeQueryWrapper();
  render(
    <Wrapper>
      <FreeformTextEditor
        value={value}
        onChange={onChange}
        placeholder="Write something"
        ariaLabel="Description"
      />
    </Wrapper>,
  );
  return { onChange, user: userEvent.setup() };
}

/**
 * `- [ ] ` is the Markdown spelling bodies are stored in, and typing it crosses two input rules: the
 * `- ` becomes a bullet before `[` is ever typed. These pin the resulting document.
 *
 * `user-event`'s keyboard syntax reads `[` as the start of a key descriptor, so a literal bracket is
 * written `[[`.
 */
describe('typing a task item', () => {
  it('turns "- [ ] " into an unchecked task item', async () => {
    const { user } = renderEditor();
    const editor = await screen.findByRole('textbox', { name: 'Description' });

    await user.click(editor);
    await user.keyboard('- [[ ] Flip the flag');

    await waitFor(() => {
      expect(editor.querySelector('li[data-checked]')).not.toBeNull();
    });
    expect(editor.querySelector('li[data-checked="false"]')).not.toBeNull();
    expect(editor).toHaveTextContent('Flip the flag');
    // The bracket pair is the shortcut, so none of it survives as text.
    expect(editor).not.toHaveTextContent('[ ]');
  });

  it('turns "- [x] " into a checked task item', async () => {
    const { user } = renderEditor();
    const editor = await screen.findByRole('textbox', { name: 'Description' });

    await user.click(editor);
    await user.keyboard('- [[x] Backfill');

    await waitFor(() => {
      expect(editor.querySelector('li[data-checked="true"]')).not.toBeNull();
    });
    expect(editor).toHaveTextContent('Backfill');
  });

  it('stores a typed task item as Markdown the body can be reloaded from', async () => {
    const { user, onChange } = renderEditor();
    const editor = await screen.findByRole('textbox', { name: 'Description' });

    await user.click(editor);
    await user.keyboard('- [[x] Backfill');

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });
    expect(onChange.mock.calls.at(-1)?.[0]).toContain('[x] Backfill');
  });

  it('converts only the item being typed, leaving earlier bullets alone', async () => {
    const { user } = renderEditor();
    const editor = await screen.findByRole('textbox', { name: 'Description' });

    await user.click(editor);
    await user.keyboard('- One{Enter}[[ ] Two');

    await waitFor(() => {
      expect(editor.querySelector('li[data-checked]')).not.toBeNull();
    });
    // The first bullet keeps its own list; the checkbox opens a second one.
    expect(editor.querySelectorAll('ul')).toHaveLength(2);
    expect(editor.querySelectorAll('li[data-checked]')).toHaveLength(1);
    expect(editor.querySelector('ul:not([data-type]) > li')).toHaveTextContent('One');
  });

  it('leaves a plain bullet a plain bullet', async () => {
    const { user } = renderEditor();
    const editor = await screen.findByRole('textbox', { name: 'Description' });

    await user.click(editor);
    await user.keyboard('- Flip the flag');

    await waitFor(() => {
      expect(editor.querySelector('ul > li')).not.toBeNull();
    });
    expect(editor.querySelector('li[data-checked]')).toBeNull();
  });
});
