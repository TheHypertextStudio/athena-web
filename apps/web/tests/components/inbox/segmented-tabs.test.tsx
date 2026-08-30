import '@testing-library/jest-dom/vitest';

import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SegmentedTabs } from '@/components/inbox/segmented-tabs';

let resize: (() => void) | undefined;

class ResizeObserverMock implements ResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}

  observe(): void {
    resize = () => {
      this.callback([], this);
    };
  }

  unobserve(): void {
    resize = undefined;
  }

  disconnect(): void {
    resize = undefined;
  }
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverMock);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function rect(
    this: HTMLElement,
  ) {
    const item = this.getAttribute('data-responsive-item');
    const itemWidth = item === 'announcements' ? 156 : item === 'mentions' ? 176 : 80;
    return {
      bottom: 0,
      height: 40,
      left: 0,
      right: item ? itemWidth : 0,
      top: 0,
      width: item ? itemWidth : 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    };
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  resize = undefined;
});

describe('SegmentedTabs', () => {
  it('keeps the selected feed inline and exposes hidden feeds by name in one menu', async () => {
    const onChange = vi.fn();
    render(
      <SegmentedTabs
        label="Inbox feeds"
        value="announcements"
        onChange={onChange}
        segments={[
          { id: 'all', label: 'All' },
          { id: 'announcements', label: 'Announcements' },
          { id: 'mentions', label: 'Mentions & assignments' },
        ]}
      />,
    );
    Object.defineProperty(screen.getByTestId('segmented-tabs'), 'clientWidth', {
      configurable: true,
      value: 280,
    });
    act(() => resize?.());

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'Announcements' })).toBeVisible();
      expect(screen.queryByRole('tab', { name: 'Mentions & assignments' })).not.toBeInTheDocument();
    });

    await userEvent.setup().click(screen.getByRole('button', { name: 'More inbox feeds' }));
    await userEvent.setup().click(screen.getByRole('menuitem', { name: 'Mentions & assignments' }));
    expect(onChange).toHaveBeenCalledWith('mentions');
  });
});
