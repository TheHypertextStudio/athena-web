import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FreeformText, FreeformTextEditor } from '../../../src/components/editor/freeform-text';

afterEach(cleanup);

describe('FreeformTextEditor', () => {
  it('renders a quiet accessible writing surface without Markdown or toolbar chrome', () => {
    render(
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
    render(<FreeformText value="A saved update." emptyText="Nothing here." />);

    const writing = screen.getByLabelText('Description');
    expect(writing.getAttribute('contenteditable')).toBe('false');
    expect(writing.closest('.opacity-60')).toBeNull();
  });
});
