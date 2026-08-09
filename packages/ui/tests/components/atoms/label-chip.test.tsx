import '@testing-library/jest-dom/vitest';

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { LabelChip, LabelChipRow, labelColorKey } from '../../../src/components/atoms/LabelChip';

describe('labelColorKey', () => {
  it('passes a known palette key through', () => {
    expect(labelColorKey('amber')).toBe('amber');
  });

  it('falls back to the neutral for a legacy hex from a mirrored label', () => {
    // Labels imported from a connected tool carry that provider's hex. Rendering them
    // colourless (or throwing) would punish the user for our own import.
    expect(labelColorKey('#ff0055')).toBe('slate');
    expect(labelColorKey(null)).toBe('slate');
    expect(labelColorKey(undefined)).toBe('slate');
  });
});

describe('LabelChip', () => {
  it('emits the colour as a data attribute rather than an inline style', () => {
    // The stylesheet owns what a key means, which is the only way one label can read
    // correctly against both a near-white and a near-black surface.
    const { container } = render(<LabelChip name="design" color="violet" />);
    const chip = container.querySelector('[data-label-color]');
    expect(chip).toHaveAttribute('data-label-color', 'violet');
    expect(chip).not.toHaveAttribute('style');
  });

  it('renders read variant as a non-interactive round badge', () => {
    const { container } = render(<LabelChip name="bug" color="coral" />);
    expect(container.querySelector('button')).toBeNull();
    expect(container.firstElementChild).toHaveClass('rounded-full');
  });

  it('renders action variant as a pressable 8px-cornered chip', () => {
    // `rounded-full` is reserved for things you read; a pressable label must not wear it.
    const onActivate = vi.fn();
    const { container } = render(
      <LabelChip name="bug" color="coral" variant="action" onActivate={onActivate} />,
    );
    const button = screen.getByRole('button', { name: 'bug' });
    expect(container.firstElementChild).toHaveClass('rounded-lg');
    expect(container.firstElementChild).not.toHaveClass('rounded-full');
    fireEvent.click(button);
    expect(onActivate).toHaveBeenCalledOnce();
  });

  it('ignores onActivate on the read variant', () => {
    const onActivate = vi.fn();
    render(<LabelChip name="bug" onActivate={onActivate} />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('splits activate and remove into two controls', () => {
    // One click target could not distinguish "filter by this" from "take this off", and a
    // nested button is invalid markup.
    const onActivate = vi.fn();
    const onRemove = vi.fn();
    render(
      <LabelChip name="design" variant="action" onActivate={onActivate} onRemove={onRemove} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remove label design' }));
    expect(onRemove).toHaveBeenCalledOnce();
    expect(onActivate).not.toHaveBeenCalled();
  });

  it('always renders a leading dot, so a label is never a bare text pill', () => {
    const { container } = render(<LabelChip name="bug" color="green" />);
    expect(container.querySelector('.bg-\\(--label-dot\\)')).not.toBeNull();
  });
});

describe('LabelChipRow', () => {
  const labels = [
    { id: '1', name: 'bug', color: 'coral' },
    { id: '2', name: 'design', color: 'violet' },
    { id: '3', name: 'urgent', color: 'amber' },
    { id: '4', name: 'q3', color: 'teal' },
  ];

  it('renders nothing when there are no labels', () => {
    const { container } = render(<LabelChipRow labels={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('collapses past the cap so a row keeps its title', () => {
    render(<LabelChipRow labels={labels} />);
    expect(screen.getByText('bug')).toBeInTheDocument();
    expect(screen.getByText('design')).toBeInTheDocument();
    expect(screen.queryByText('urgent')).toBeNull();
    expect(screen.getByText('+2')).toBeInTheDocument();
  });

  it('keeps the hidden names recoverable without navigating', () => {
    render(<LabelChipRow labels={labels} />);
    expect(screen.getByText('+2')).toHaveAttribute('title', 'urgent, q3');
  });

  it('shows no overflow marker when everything fits', () => {
    render(<LabelChipRow labels={labels.slice(0, 2)} />);
    expect(screen.queryByText(/^\+/)).toBeNull();
  });
});
