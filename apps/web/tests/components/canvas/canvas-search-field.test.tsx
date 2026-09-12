import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import CanvasSearchField from '@/components/canvas/canvas-search-field';

describe('CanvasSearchField', () => {
  it('rests as a labelled button and opens into a field', () => {
    const onChange = vi.fn();
    render(<CanvasSearchField value="" onChange={onChange} label="Search the plan" />);
    fireEvent.click(screen.getByRole('button', { name: 'Search the plan' }));
    const input = screen.getByRole('textbox', { name: 'Search the plan' });
    fireEvent.change(input, { target: { value: 'thank' } });
    expect(onChange).toHaveBeenCalledWith('thank');
  });

  it('stays a field while it holds a query and closes on an empty blur', () => {
    const onChange = vi.fn();
    const view = render(
      <CanvasSearchField value="thank" onChange={onChange} label="Search the plan" />,
    );
    expect(screen.getByRole('textbox', { name: 'Search the plan' })).toBeInTheDocument();
    view.rerender(<CanvasSearchField value="" onChange={onChange} label="Search the plan" />);
    fireEvent.blur(screen.getByRole('textbox', { name: 'Search the plan' }));
    expect(screen.getByRole('button', { name: 'Search the plan' })).toBeInTheDocument();
  });

  it('clears and closes on Escape', () => {
    const onChange = vi.fn();
    render(<CanvasSearchField value="thank" onChange={onChange} label="Search the plan" />);
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Search the plan' }), { key: 'Escape' });
    expect(onChange).toHaveBeenCalledWith('');
  });
});
