import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import * as Components from '../../../src/components';
import { MenuActionRow, type MenuActionRowProps } from '../../../src/components';
import { TooltipProvider } from '../../../src/primitives';

const DEFAULT_PROPS: MenuActionRowProps = {
  label: 'Quarterly planning notes',
  leading: <svg data-testid="leading-icon" />,
  selected: false,
  renderPrimary: (children, className) => (
    <button type="button" className={className}>
      {children}
    </button>
  ),
  actionLabel: 'Close quarterly planning notes',
  actionIcon: <svg data-testid="action-icon" />,
  onPrimarySelect: vi.fn(),
  onAction: vi.fn(),
};

function renderRow(overrides: Partial<MenuActionRowProps> = {}): void {
  render(
    <TooltipProvider delayDuration={400}>
      <MenuActionRow {...DEFAULT_PROPS} {...overrides} />
    </TooltipProvider>,
  );
}

describe('MenuActionRow', () => {
  it('is available from the public components barrel', () => {
    expect(Components.MenuActionRow).toBeTypeOf('function');
  });

  it('exposes the selected row and both controls to assistive technology', () => {
    renderRow({ selected: true });

    const row = screen.getByRole('listitem', { name: 'Quarterly planning notes' });
    expect(row).toHaveAttribute('aria-current', 'true');
    expect(row).toHaveAttribute('data-menu-action-row');
    expect(row).toHaveClass(
      'rounded-corner-md!',
      'bg-tertiary-container',
      'text-on-tertiary-container',
    );
    expect(screen.getByRole('button', { name: 'Quarterly planning notes' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Close quarterly planning notes' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Quarterly planning notes')).toBeInTheDocument();
  });

  it('keeps the standard menu treatment while fixing the row at 44 pixels', () => {
    renderRow();

    const row = screen.getByRole('listitem');
    expect(row).toHaveClass(
      'relative',
      'h-11',
      'min-h-11',
      'py-0',
      'px-4',
      'text-on-surface',
      'hover:bg-on-surface/8',
    );
    expect(row).not.toHaveClass('py-2');
  });

  it('hands the primary renderer fixed-height content with reserved action space', () => {
    renderRow({
      renderPrimary: (children, className) => (
        <a href="/notes/quarterly" className={className} data-testid="primary-control">
          {children}
        </a>
      ),
    });

    const primary = screen.getByTestId('primary-control');
    expect(primary).toHaveClass(
      'flex',
      'h-full',
      'min-w-0',
      'flex-1',
      'items-center',
      'gap-3',
      'focus-visible:ring-[3px]',
      'focus-visible:ring-inset',
    );

    const leadingSlot = screen.getByTestId('leading-icon').parentElement;
    expect(leadingSlot).toHaveClass(
      'size-[18px]',
      'shrink-0',
      'opacity-70',
      '[&_svg]:size-[18px]!',
    );

    const label = screen.getByText('Quarterly planning notes');
    expect(label).toHaveClass('min-w-0', 'flex-1', 'truncate');
    expect(label).toHaveTextContent('Quarterly planning notes');
    expect(primary.closest('[data-menu-action-primary]')).toHaveClass('pr-10');
  });

  it('aligns a 40 pixel action target around a centered 28 pixel state layer', () => {
    renderRow();

    const action = screen.getByRole('button', { name: 'Close quarterly planning notes' });
    expect(action).toHaveClass(
      'absolute',
      'right-[5px]',
      'top-1/2',
      'size-10',
      '-translate-y-1/2',
      'items-center',
      'justify-center',
      'rounded-full',
      'focus-visible:ring-[3px]',
    );
    expect(action.className).not.toContain('bg-surface-container-high');

    const layer = action.querySelector('[data-menu-action-layer]');
    expect(layer).toHaveClass(
      'flex',
      'size-7',
      'items-center',
      'justify-center',
      'rounded-full',
      '[&_svg]:size-4!',
    );
    expect(layer).toContainElement(screen.getByTestId('action-icon'));
  });

  it('reveals the action contextually for fine pointers and persistently for coarse pointers', async () => {
    const user = userEvent.setup();
    renderRow();

    expect(screen.getByRole('listitem')).toHaveClass('group/menu-action-row');

    const action = screen.getByRole('button', { name: 'Close quarterly planning notes' });
    expect(action).toHaveClass(
      'pointer-events-none',
      'opacity-0',
      'group-hover/menu-action-row:pointer-events-auto',
      'group-hover/menu-action-row:opacity-100',
      'group-focus-within/menu-action-row:pointer-events-auto',
      'group-focus-within/menu-action-row:opacity-100',
      'coarse:pointer-events-auto',
      'coarse:opacity-100',
      'transition-opacity',
      'motion-reduce:transition-none',
    );
    expect(action).not.toHaveAttribute('tabindex', '-1');

    await user.tab();
    await user.tab();
    expect(action).toHaveFocus();
  });

  it('paints the unselected nested action with on-surface state layers', () => {
    renderRow();

    const action = screen.getByRole('button', { name: 'Close quarterly planning notes' });
    expect(action).toHaveClass('group/action');
    const layer = action.querySelector('[data-menu-action-layer]');
    expect(layer).toHaveClass(
      'group-hover/action:bg-on-surface/8',
      'group-focus-visible/action:bg-on-surface/10',
      'group-active/action:bg-on-surface/10',
    );
    expect(layer?.className).not.toContain('surface-container-high');
  });

  it('paints the selected nested action with on-tertiary-container state layers', () => {
    renderRow({ selected: true });

    const layer = screen
      .getByRole('button', { name: 'Close quarterly planning notes' })
      .querySelector('[data-menu-action-layer]');
    expect(layer).toHaveClass(
      'group-hover/action:bg-on-tertiary-container/8',
      'group-focus-visible/action:bg-on-tertiary-container/10',
      'group-active/action:bg-on-tertiary-container/10',
    );
    expect(layer).not.toHaveClass(
      'group-hover/action:bg-on-surface/8',
      'group-focus-visible/action:bg-on-surface/10',
      'group-active/action:bg-on-surface/10',
    );
  });

  it('runs only the primary handler when the primary control activates', async () => {
    const user = userEvent.setup();
    const onPrimarySelect = vi.fn();
    const onAction = vi.fn();
    renderRow({ onPrimarySelect, onAction });

    const primary = screen.getByRole('button', { name: 'Quarterly planning notes' });
    expect(primary.closest('[data-menu-action-primary]')).not.toBeNull();
    await user.click(primary);

    expect(onPrimarySelect).toHaveBeenCalledTimes(1);
    expect(onAction).not.toHaveBeenCalled();
  });

  it('prevents and stops the action click before running only the action handler', () => {
    const onPrimarySelect = vi.fn();
    const onAction = vi.fn();
    const onAncestorClick = vi.fn();
    render(
      <TooltipProvider delayDuration={400}>
        <div onClick={onAncestorClick}>
          <MenuActionRow {...DEFAULT_PROPS} onPrimarySelect={onPrimarySelect} onAction={onAction} />
        </div>
      </TooltipProvider>,
    );

    const action = screen.getByRole('button', { name: 'Close quarterly planning notes' });
    expect(fireEvent.click(action)).toBe(false);
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onPrimarySelect).not.toHaveBeenCalled();
    expect(onAncestorClick).not.toHaveBeenCalled();
  });

  it('describes the focused primary control with the delayed full-title tooltip', async () => {
    vi.useFakeTimers();
    try {
      renderRow();

      const primary = screen.getByRole('button', { name: 'Quarterly planning notes' });
      const primaryWrapper = primary.closest('[data-menu-action-primary]');
      expect(primaryWrapper).toHaveClass('flex', 'h-full', 'min-w-0', 'flex-1', 'pr-10');
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

      fireEvent.focus(primary);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(400);
      });

      const tooltip = screen.getByRole('tooltip');
      expect(tooltip).toHaveTextContent('Quarterly planning notes');
      expect(primary).toHaveAttribute('aria-describedby', tooltip.id);
      expect(primaryWrapper).not.toHaveAttribute('aria-describedby');
    } finally {
      vi.useRealTimers();
    }
  });

  it('opens the full-title tooltip safely when the primary renderer returns a fragment', async () => {
    vi.useFakeTimers();
    try {
      renderRow({
        renderPrimary: (children, className) => (
          <>
            <button type="button" className={className}>
              {children}
            </button>
          </>
        ),
      });

      const primary = screen.getByRole('button', { name: 'Quarterly planning notes' });
      expect(primary.closest('[data-menu-action-primary]')).not.toBeNull();
      fireEvent.focus(primary);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(400);
      });

      const tooltip = screen.getByRole('tooltip');
      expect(tooltip).toHaveTextContent('Quarterly planning notes');
      expect(primary).toHaveAttribute('aria-describedby', tooltip.id);
    } finally {
      vi.useRealTimers();
    }
  });

  it('inherits the caller tooltip delay before showing the trailing action label', async () => {
    const user = userEvent.setup();
    renderRow();

    await user.hover(screen.getByRole('button', { name: 'Close quarterly planning notes' }));
    await new Promise((resolve) => setTimeout(resolve, 125));
    expect(document.querySelector('.bg-surface-container-highest')).toBeNull();
    await waitFor(
      () => {
        expect(document.querySelector('.bg-surface-container-highest')).toHaveTextContent(
          'Close quarterly planning notes',
        );
      },
      { timeout: 1_000 },
    );
  });

  it('closes the title tooltip when the trailing action receives the pointer', async () => {
    vi.useFakeTimers();
    try {
      renderRow();

      const primary = screen.getByRole('button', { name: 'Quarterly planning notes' });
      fireEvent.focus(primary);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(400);
      });
      expect(screen.getByRole('tooltip')).toHaveTextContent('Quarterly planning notes');

      fireEvent.pointerEnter(
        screen.getByRole('button', { name: 'Close quarterly planning notes' }),
      );
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
