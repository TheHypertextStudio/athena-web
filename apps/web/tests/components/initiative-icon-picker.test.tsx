import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { InitiativeIconPicker } from '../../src/components/initiatives/initiative-icon-picker';

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
});

afterEach(cleanup);

describe('InitiativeIconPicker', () => {
  it('opens from the anchored icon and reports Material icon and semantic color changes', () => {
    const onChange = vi.fn();
    render(
      <InitiativeIconPicker
        display={{
          subjectType: 'initiative',
          subjectId: 'initiative-1',
          iconKey: 'target',
          colorKey: 'neutral',
          customColor: null,
          customized: false,
        }}
        initiativeName="Transit coalition"
        editable
        pending={false}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Customize Transit coalition icon' }));
    expect(screen.getByLabelText('Initiative icon')).toBeTruthy();
    expect(screen.getByLabelText('Initiative color')).toBeTruthy();
    expect(screen.getAllByTestId('initiative-icon-option').length).toBeGreaterThan(40);
    // The glyph is a stable 32px circle sized through EntityIconGlyph's numeric `size` prop (inline
    // style) — nested inside the 40px customization tap target — rather than a Tailwind size class.
    const iconCircle = screen.getByTestId('initiative-icon-circle');
    expect(iconCircle.className).toContain('rounded-full');
    expect(iconCircle.style.width).toBe('32px');
    expect(iconCircle.style.height).toBe('32px');

    fireEvent.click(screen.getByRole('button', { name: 'Flag' }));
    expect(onChange).toHaveBeenCalledWith('flag', 'neutral', null);
    fireEvent.click(screen.getByRole('button', { name: 'Primary' }));
    expect(onChange).toHaveBeenCalledWith('target', 'primary', null);
  });

  it('searches the rounded icon catalog by label and keyword', () => {
    render(
      <InitiativeIconPicker
        display={{
          subjectType: 'initiative',
          subjectId: 'initiative-3',
          iconKey: 'target',
          colorKey: 'neutral',
          customColor: null,
          customized: false,
        }}
        initiativeName="Transit education"
        editable
        pending={false}
        onChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Customize Transit education icon' }));
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search icons' }), {
      target: { value: 'transit' },
    });

    expect(screen.getByRole('button', { name: 'Bus' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Train' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Subway' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Flag' })).toBeNull();
  });

  it('renders a non-interactive icon for a read-only cross-workspace reference', () => {
    render(
      <InitiativeIconPicker
        display={{
          subjectType: 'initiative',
          subjectId: 'initiative-2',
          iconKey: 'globe',
          colorKey: 'primary',
          customColor: null,
          customized: true,
        }}
        initiativeName="Regional coalition"
        editable={false}
        pending={false}
        onChange={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByTitle('Regional coalition')).toBeTruthy();
    expect(screen.getByTestId('initiative-icon-circle').className).toContain('rounded-full');
  });
});
