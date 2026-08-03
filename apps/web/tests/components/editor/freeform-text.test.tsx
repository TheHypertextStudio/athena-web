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

  it('renders saved writing as quiet readable text, rather than a disabled field', () => {
    renderEditor(<FreeformText value="A saved update." emptyText="Nothing here." />);

    const writing = screen.getByLabelText('Description');
    expect(writing.getAttribute('contenteditable')).toBe('false');
    expect(writing.closest('.opacity-60')).toBeNull();
  });
});
