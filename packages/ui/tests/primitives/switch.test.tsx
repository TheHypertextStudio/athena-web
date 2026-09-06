import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Switch } from '../../src/primitives/switch';

afterEach(cleanup);

describe('Switch', () => {
  it('exposes its state and reports one requested change', () => {
    const onCheckedChange = vi.fn();
    render(
      <Switch aria-label="Automatic location" checked={false} onCheckedChange={onCheckedChange} />,
    );

    const control = screen.getByRole('switch', { name: 'Automatic location' });
    expect(control).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(control);
    expect(onCheckedChange).toHaveBeenCalledOnce();
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it('uses semantic tokens for its MD3 track and handle', () => {
    render(<Switch aria-label="Automatic location" checked />);

    const control = screen.getByRole('switch', { name: 'Automatic location' });
    expect(control).toHaveClass('bg-primary', 'rounded-full');
    expect(control.className).toContain('focus-visible:ring-ring');
    expect(control.firstElementChild).toHaveClass('bg-on-primary');
  });

  it('does not request changes while disabled', () => {
    const onCheckedChange = vi.fn();
    render(
      <Switch
        aria-label="Automatic location"
        checked={false}
        disabled
        onCheckedChange={onCheckedChange}
      />,
    );

    fireEvent.click(screen.getByRole('switch', { name: 'Automatic location' }));
    expect(onCheckedChange).not.toHaveBeenCalled();
  });
});
