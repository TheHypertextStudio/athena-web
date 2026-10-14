import '@testing-library/jest-dom/vitest';

import { createRef } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ComposerIdentityHeader } from '@/components/composer/composer-shell-regions';

afterEach(cleanup);

const props = {
  embedded: true,
  legacyContextVisible: false,
  editDisabled: false,
  title: 'Monthly review',
  onTitleChange: vi.fn(),
  titlePlaceholder: 'Project name (optional)',
  summary: 'Agree on the next actions.',
  onSummaryChange: vi.fn(),
  summaryPlaceholder: 'Short description (optional)',
  summaryMaxLength: 280,
  hasSectionSwitcher: false,
  activeSectionValue: 'description',
  onSectionValueChange: vi.fn(),
  supplementalSections: [],
  sectionValue: (id: string) => id,
};

describe('Composer identity fields', () => {
  it('labels form controls, preserves the input ref, and reports edits', () => {
    const titleInputRef = createRef<HTMLInputElement>();
    render(
      <ComposerIdentityHeader {...props} fieldPresentation="form" titleInputRef={titleInputRef} />,
    );
    const title = screen.getByRole('textbox', { name: 'Project name (optional)' });
    const summary = screen.getByRole('textbox', { name: 'Short description (optional)' });
    expect(titleInputRef.current).toBe(title);
    expect(title).toHaveFocus();
    expect(title).toHaveValue('Monthly review');
    expect(summary).toHaveAttribute('maxlength', '280');
    fireEvent.change(title, { target: { value: 'Quarterly review' } });
    fireEvent.change(summary, { target: { value: 'Review the budget.' } });
    expect(props.onTitleChange).toHaveBeenCalledWith('Quarterly review');
    expect(props.onSummaryChange).toHaveBeenCalledWith('Review the budget.');
  });

  it('locks both form fields while the host saves', () => {
    render(<ComposerIdentityHeader {...props} fieldPresentation="form" editDisabled />);
    for (const control of screen.getAllByRole('textbox')) expect(control).toBeDisabled();
  });

  it('keeps the ordinary document presentation as the default', () => {
    render(<ComposerIdentityHeader {...props} />);
    expect(screen.getByPlaceholderText('Project name (optional)')).toHaveValue('Monthly review');
    expect(screen.getByPlaceholderText('Short description (optional)')).toHaveValue(
      'Agree on the next actions.',
    );
  });
});
