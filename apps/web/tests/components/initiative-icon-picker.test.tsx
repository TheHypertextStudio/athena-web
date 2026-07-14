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

    fireEvent.click(screen.getByRole('button', { name: 'Flag' }));
    expect(onChange).toHaveBeenCalledWith('flag', 'neutral');
    fireEvent.click(screen.getByRole('button', { name: 'Primary' }));
    expect(onChange).toHaveBeenCalledWith('target', 'primary');
  });

  it('renders a non-interactive icon for a read-only cross-workspace reference', () => {
    render(
      <InitiativeIconPicker
        display={{
          subjectType: 'initiative',
          subjectId: 'initiative-2',
          iconKey: 'globe',
          colorKey: 'primary',
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
  });
});
