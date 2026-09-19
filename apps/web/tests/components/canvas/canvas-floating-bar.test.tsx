import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import CanvasFloatingBar from '@/components/canvas/canvas-floating-bar';

describe('CanvasFloatingBar', () => {
  it('is a named region carrying the title, controls, and counts', () => {
    render(
      <CanvasFloatingBar
        title="Spring giving campaign"
        ariaLabel="Plan"
        navigation={<button type="button">Back</button>}
        controls={<input aria-label="Search the plan" />}
        trailing={<span data-testid="counts">3 projects</span>}
        actions={<button type="button">Athena</button>}
      />,
    );
    const region = screen.getByRole('region', { name: 'Plan' });
    expect(region).toContainElement(screen.getByRole('heading', { level: 1 }));
    expect(region).toContainElement(screen.getByRole('textbox', { name: 'Search the plan' }));
    expect(region).toContainElement(screen.getByTestId('counts'));
    expect(screen.queryByTestId('canvas-selection-bar')).toBeNull();
  });

  it('swaps the counts for the selection actions while something is selected', () => {
    render(
      <CanvasFloatingBar
        title="Plan"
        ariaLabel="Plan"
        trailing={<span data-testid="counts">3 projects</span>}
        selection={<button type="button">Confirm project</button>}
      />,
    );
    expect(screen.queryByTestId('counts')).toBeNull();
    const group = screen.getByTestId('canvas-selection-bar');
    expect(group).toHaveClass('flex-nowrap');
    expect(group).toContainElement(screen.getByRole('button', { name: 'Confirm project' }));
  });

  it('names its title for a shared-element transition, and only while the title shows', () => {
    const { rerender } = render(
      <CanvasFloatingBar title="Projects" ariaLabel="Projects" titleTransitionName="lens-title" />,
    );
    expect(screen.getByRole('heading', { level: 1 }).style.viewTransitionName).toBe('lens-title');

    rerender(
      <CanvasFloatingBar
        title="Projects"
        ariaLabel="Projects"
        titleTransitionName="lens-title"
        selection={<button type="button">Open</button>}
      />,
    );
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
  });

  it('keeps clear of floating columns and reports its height', () => {
    const onHeightChange = vi.fn();
    render(
      <CanvasFloatingBar
        title="Plan"
        ariaLabel="Plan"
        insetRight={292}
        onHeightChange={onHeightChange}
      />,
    );
    const wrapper = screen.getByRole('region', { name: 'Plan' }).parentElement;
    expect(wrapper?.style.right).toBe('300px');
    expect(onHeightChange).toHaveBeenCalledWith(expect.any(Number));
  });
});
