import { afterEach, describe, expect, it, vi } from 'vitest';

import { startViewTransition } from '../../src/lib/view-transition';

vi.mock('react-dom', () => ({
  flushSync: (fn: () => void) => {
    fn();
  },
}));

type StartViewTransition = (update: () => void) => {
  ready: Promise<void>;
  finished: Promise<void>;
  updateCallbackDone: Promise<void>;
};

afterEach(() => {
  delete (document as { startViewTransition?: StartViewTransition }).startViewTransition;
});

describe('startViewTransition', () => {
  it('runs the update at once where the browser has no transitions', () => {
    const update = vi.fn();
    startViewTransition(update);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('runs the update inside a transition and settles a skipped one quietly', async () => {
    const skipped = new Error('Transition was skipped');
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    (document as { startViewTransition?: StartViewTransition }).startViewTransition = (update) => {
      update();
      return {
        ready: Promise.reject(skipped),
        finished: Promise.reject(skipped),
        updateCallbackDone: Promise.resolve(),
      };
    };
    const update = vi.fn();
    startViewTransition(update);
    expect(update).toHaveBeenCalledTimes(1);
    await new Promise((resolve) => setTimeout(resolve, 0));
    process.off('unhandledRejection', unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });
});
