import { cleanup, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FreeformText, FreeformTextEditor } from '../../../src/components/editor/freeform-text';
import { makeQueryWrapper } from '../../support/query';

afterEach(cleanup);

/**
 * The editor now offers `@` mentions, which read the workspace's objects through the typed query
 * layer — so it renders inside the query provider here exactly as it does inside the app shell.
 */
function renderEditor(ui: ReactElement) {
  const { wrapper: Wrapper } = makeQueryWrapper();
  return render(<Wrapper>{ui}</Wrapper>);
}

describe('FreeformTextEditor', () => {
  it('renders a quiet accessible writing surface without Markdown or toolbar chrome', () => {
    renderEditor(
      <FreeformTextEditor
        value=""
        onChange={vi.fn()}
        placeholder="Write a short description"
        ariaLabel="Description"
      />,
    );

    const writing = screen.getByRole('textbox', { name: 'Description' });
    expect(writing.getAttribute('contenteditable')).toBe('true');
    expect(writing.getAttribute('aria-multiline')).toBe('true');
    expect(screen.queryByText(/markdown/i)).toBeNull();
    expect(screen.queryByRole('toolbar')).toBeNull();
  });

  it('marks the empty paragraph for the placeholder to actually render from', () => {
    renderEditor(
      <FreeformTextEditor
        value=""
        onChange={vi.fn()}
        placeholder="What is this team for?"
        ariaLabel="Description"
      />,
    );

    // The `Placeholder` extension decorates the empty *paragraph*, not the `.ProseMirror` root —
    // regression guard for the gap that shipped once already: the extension was never installed,
    // so the class/attribute this depends on never appeared and the CSS had nothing to read.
    const writing = screen.getByRole('textbox', { name: 'Description' });
    const emptyNode = writing.querySelector('.is-editor-empty');
    expect(emptyNode).not.toBeNull();
    expect(emptyNode).toHaveAttribute('data-placeholder', 'What is this team for?');
  });

  it('renders saved writing as quiet readable text, rather than a disabled field', () => {
    renderEditor(<FreeformText value="A saved update." emptyText="Nothing here." />);

    const writing = screen.getByRole('document');
    expect(writing.getAttribute('contenteditable')).toBe('false');
    expect(writing).not.toHaveAttribute('aria-multiline');
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(writing.closest('.opacity-60')).toBeNull();
  });

  it('renders GFM checklist markdown as real, interactive checkboxes rather than literal [ ] text', () => {
    renderEditor(<FreeformText value={'- [ ] first\n- [x] second'} emptyText="Nothing here." />);

    const boxes = screen.getAllByRole('checkbox');
    expect(boxes).toHaveLength(2);
    expect(boxes[0]).not.toBeChecked();
    expect(boxes[1]).toBeChecked();
    expect(screen.queryByText('[ ]', { exact: false })).toBeNull();
    expect(screen.queryByText('[x]', { exact: false })).toBeNull();
  });
});
