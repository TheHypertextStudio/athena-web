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

/** Render the editor and hand back the pieces a paste test needs. */
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
 * Dispatch a paste carrying exactly the flavors given.
 *
 * @remarks
 * jsdom implements no `DataTransfer` and `user-event`'s own paste only ever sets `text/plain`, so
 * the *combination* of flavors — which is the whole thing the handler branches on — can only be
 * exercised by constructing the event.
 */
function paste(target: Element, flavors: Readonly<Record<string, string>>): void {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: {
      getData: (type: string) => flavors[type] ?? '',
      files: [],
      types: Object.keys(flavors),
    },
  });
  target.dispatchEvent(event);
}

/**
 * Pasting is where content arrives from other tools, and it is the half of the clipboard contract
 * that decides whether a Linear issue body survives the trip. The rules under test are all about
 * *when* the handler declines: HTML always wins, a code fence is never interpreted, and plain prose
 * stays prose.
 */
describe('pasting into the editor', () => {
  it('turns pasted Markdown into real structure when the clipboard carries only text', async () => {
    const { user, onChange } = renderEditor();
    const editor = await screen.findByRole('textbox', { name: 'Description' });

    await user.click(editor);
    paste(editor, { 'text/plain': '# Rollout plan\n\n- [ ] Flip the flag' });

    await waitFor(() => {
      expect(editor.querySelector('h1')).not.toBeNull();
    });
    expect(editor.querySelector('li[data-checked]')).not.toBeNull();
    // The stored value is Markdown, so the round trip is what the host actually receives.
    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });
    expect(onChange.mock.calls.at(-1)?.[0]).toContain('# Rollout plan');
  });

  it('leaves ordinary prose as prose', async () => {
    const { user } = renderEditor();
    const editor = await screen.findByRole('textbox', { name: 'Description' });

    await user.click(editor);
    paste(editor, { 'text/plain': 'Just a sentence about the release.' });

    await waitFor(() => {
      expect(editor).toHaveTextContent('Just a sentence about the release.');
    });
    expect(editor.querySelector('h1')).toBeNull();
    expect(editor.querySelector('ul')).toBeNull();
  });

  it('defers to the HTML flavor when the source provided one', async () => {
    const { user } = renderEditor();
    const editor = await screen.findByRole('textbox', { name: 'Description' });

    await user.click(editor);
    // What a rich source (Linear, Docs, another editor) puts on the clipboard. The HTML is the
    // richer of the two and is parsed against the real schema, so the plain flavor is ignored.
    paste(editor, {
      'text/html': '<h2>From Linear</h2><ul><li>One</li></ul>',
      'text/plain': '## From Linear\n\n- One',
    });

    await waitFor(() => {
      expect(editor.querySelector('h2')).not.toBeNull();
    });
    expect(editor.querySelector('ul')).not.toBeNull();
  });

  it('keeps Markdown literal inside a code block', async () => {
    const { user } = renderEditor();
    const editor = await screen.findByRole('textbox', { name: 'Description' });

    await user.click(editor);
    await user.keyboard('```');
    await waitFor(() => {
      expect(editor.querySelector('pre')).not.toBeNull();
    });

    paste(editor, { 'text/plain': '# Not a heading' });

    await waitFor(() => {
      expect(editor.querySelector('pre')).toHaveTextContent('# Not a heading');
    });
    // A fence is the one place the syntax is the content.
    expect(editor.querySelector('h1')).toBeNull();
  });
});
