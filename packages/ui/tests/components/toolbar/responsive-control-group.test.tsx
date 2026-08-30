import '@testing-library/jest-dom/vitest';

import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DropdownMenuItem } from '../../../src/primitives/dropdown-menu';

import {
  ResponsiveControlGroup,
  type ResponsiveControlItem,
} from '../../../src/components/toolbar/ResponsiveControlGroup';

let resize: (() => void) | undefined;
let width = 0;

class ResizeObserverMock {
  observe(): void {
    resize = () => this.callback([], this as unknown as ResizeObserver);
  }

  unobserve(): void {}

  disconnect(): void {}

  constructor(private readonly callback: ResizeObserverCallback) {}
}

const items: readonly ResponsiveControlItem[] = [
  {
    id: 'current',
    priority: 0,
    alwaysVisible: true,
    inline: <button type="button">Current period</button>,
    overflow: <DropdownMenuItem>Current period</DropdownMenuItem>,
  },
  {
    id: 'previous',
    priority: 1,
    inline: <button type="button">Previous period</button>,
    overflow: <DropdownMenuItem>Previous period</DropdownMenuItem>,
  },
  {
    id: 'filters',
    priority: 2,
    inline: <button type="button">Filters</button>,
    overflow: <DropdownMenuItem>Filters</DropdownMenuItem>,
  },
];

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverMock);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function rect(
    this: HTMLElement,
  ) {
    const item = this.getAttribute('data-responsive-item');
    const itemWidth = item === 'current' ? 112 : item === 'previous' ? 124 : item === 'filters' ? 72 : 112;
    return {
      bottom: 0,
      height: 32,
      left: 0,
      right: item ? itemWidth : 0,
      top: 0,
      width: item ? itemWidth : 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  resize = undefined;
});

function renderAt(nextWidth: number): void {
  width = nextWidth;
  render(<ResponsiveControlGroup label="Time controls" overflowLabel="More time controls" items={items} />);
  Object.defineProperty(screen.getByTestId('responsive-control-group'), 'clientWidth', {
    configurable: true,
    value: width,
  });
  act(() => resize?.());
}

describe('ResponsiveControlGroup', () => {
  it('keeps priority controls inline and moves lower-priority controls into one menu', async () => {
    renderAt(280);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Current period' })).toBeVisible();
      expect(screen.queryByRole('button', { name: 'Previous period' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Filters' })).not.toBeInTheDocument();
    });

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'More time controls' }));
    expect(await screen.findByRole('menuitem', { name: 'Previous period' })).toBeVisible();
    expect(await screen.findByRole('menuitem', { name: 'Filters' })).toBeVisible();
  });
});
