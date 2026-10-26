import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useDetailHeaderCollapse } from '../../src/components/views/entity-detail-collapse';

function DetailFixture() {
  const { scrollRef, headerRef } = useDetailHeaderCollapse({ hasCover: false });
  return (
    <div ref={scrollRef} data-testid="scroll">
      <header ref={headerRef} data-testid="header" />
    </div>
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('lets an oversized masthead scroll away and restores sticky behavior when it fits', () => {
  let resize = (): void => undefined;
  class Observer implements ResizeObserver {
    readonly observe = vi.fn();
    readonly unobserve = vi.fn();
    readonly disconnect = vi.fn();
    constructor(callback: ResizeObserverCallback) {
      resize = () => {
        callback([], this);
      };
    }
  }
  vi.stubGlobal('ResizeObserver', Observer);
  render(<DetailFixture />);
  const header = screen.getByTestId('header');
  const scroller = screen.getByTestId('scroll');
  let height = 1000;
  let viewport = 700;
  Object.defineProperty(header, 'offsetHeight', { get: () => height });
  Object.defineProperty(scroller, 'clientHeight', { get: () => viewport });
  act(resize);
  expect(header.style.position).toBe('relative');
  expect(scroller.style.getPropertyValue('--detail-header-height')).toBe('0px');
  height = 400;
  act(resize);
  expect(header.style.position).toBe('relative');
  height = 100;
  act(resize);
  expect(header.style.position).toBe('');
  expect(scroller.style.getPropertyValue('--detail-header-height')).toBe('100px');
  viewport = 80;
  act(resize);
  expect(header.style.position).toBe('relative');
});
