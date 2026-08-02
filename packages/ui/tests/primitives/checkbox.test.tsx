import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Checkbox } from '../../src/primitives/checkbox';

afterEach(cleanup);

describe('Checkbox', () => {
  it('is a real checkbox, so native semantics come for free', () => {
    render(<Checkbox aria-label="Show holidays" defaultChecked />);

    const box = screen.getByRole('checkbox', { name: 'Show holidays' });
    expect(box).toBeChecked();
    expect(box.tagName).toBe('INPUT');
    expect(box).toHaveAttribute('type', 'checkbox');
  });

  it('draws itself from tokens instead of deferring to the platform widget', () => {
    render(<Checkbox aria-label="Show holidays" />);

    const box = screen.getByRole('checkbox', { name: 'Show holidays' });
    // `appearance-none` is what removes the OS rendering; without it `accent-*` just tints a
    // native blue square that ignores the theme and dark mode.
    expect(box).toHaveClass('appearance-none', 'border-outline', 'checked:bg-primary');
    expect(box.className).not.toContain('accent-');
    // One shared keyboard-focus convention, same as every other control.
    expect(box.className).toContain('focus-visible:ring-ring');
  });

  it('reports changes through the native event', () => {
    const onChange = vi.fn();
    render(<Checkbox aria-label="Show holidays" checked={false} onChange={onChange} />);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Show holidays' }));
    expect(onChange).toHaveBeenCalledOnce();
  });

  it('drives the indeterminate DOM property, which has no HTML attribute', () => {
    const { rerender } = render(<Checkbox aria-label="Select all" indeterminate />);

    // Typed query rather than `as HTMLInputElement`: the lint program resolves this call as
    // already returning HTMLInputElement and rejects the assertion as unnecessary, while `tsc`
    // resolves it as HTMLElement and needs the narrowing. The type argument satisfies both.
    const box = screen.getByRole<HTMLInputElement>('checkbox', { name: 'Select all' });
    expect(box.indeterminate).toBe(true);

    rerender(<Checkbox aria-label="Select all" indeterminate={false} />);
    expect(box.indeterminate).toBe(false);
  });

  it('still exposes the node to a caller-supplied ref', () => {
    const ref = React.createRef<HTMLInputElement>();
    render(<Checkbox aria-label="Show holidays" ref={ref} />);

    expect(ref.current).toBe(screen.getByRole('checkbox', { name: 'Show holidays' }));
  });
});
