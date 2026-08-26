import { afterEach, describe, expect, it, vi } from 'vitest';

import { startNavigationTransition } from '../../../src/components/shell/navigation-transition';

describe('startNavigationTransition', () => {
  afterEach(() => {
    Reflect.deleteProperty(document, 'startViewTransition');
    vi.unstubAllGlobals();
  });

  it('flushes the shell update inside a browser View Transition when motion is allowed', () => {
    const update = vi.fn();
    const startViewTransition = vi.fn((callback: () => void) => {
      callback();
      return { finished: Promise.resolve() };
    });
    Object.defineProperty(document, 'startViewTransition', {
      configurable: true,
      value: startViewTransition,
    });

    startNavigationTransition(update);

    expect(startViewTransition).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('updates without a transition when the viewer prefers reduced motion', () => {
    const update = vi.fn();
    const startViewTransition = vi.fn();
    Object.defineProperty(document, 'startViewTransition', {
      configurable: true,
      value: startViewTransition,
    });
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      media: query,
    }));

    startNavigationTransition(update);

    expect(startViewTransition).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('updates without a transition when the browser lacks the API', () => {
    const update = vi.fn();

    startNavigationTransition(update);

    expect(update).toHaveBeenCalledTimes(1);
  });
});
