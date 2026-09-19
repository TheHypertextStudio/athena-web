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

function stubReducedMotion(reduced: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: reduced && query.includes('prefers-reduced-motion'),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
}

afterEach(() => {
  delete (document as { startViewTransition?: StartViewTransition }).startViewTransition;
  delete document.documentElement.dataset['viewTransitionScope'];
  stubReducedMotion(false);
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

  describe('with the named scope', () => {
    function stubTransition(finished: Promise<void>): { update: ReturnType<typeof vi.fn> } {
      const update = vi.fn();
      (document as { startViewTransition?: StartViewTransition }).startViewTransition = (
        callback,
      ) => {
        update(document.documentElement.dataset['viewTransitionScope']);
        callback();
        return { ready: Promise.resolve(), finished, updateCallbackDone: Promise.resolve() };
      };
      return { update };
    }

    it('marks the document as named for the life of the transition and clears it after', async () => {
      let finish: () => void = () => undefined;
      const seen = stubTransition(
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
      );
      const update = vi.fn();

      startViewTransition(update, { scope: 'named' });

      expect(update).toHaveBeenCalledTimes(1);
      expect(seen.update).toHaveBeenCalledWith('named');
      expect(document.documentElement.dataset['viewTransitionScope']).toBe('named');

      finish();
      await Promise.resolve();
      await Promise.resolve();

      expect(document.documentElement.dataset['viewTransitionScope']).toBeUndefined();
    });

    it('clears the flag when the browser skips the transition', async () => {
      stubTransition(Promise.reject(new Error('Transition was skipped')));

      startViewTransition(vi.fn(), { scope: 'named' });
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(document.documentElement.dataset['viewTransitionScope']).toBeUndefined();
    });

    it('applies the update at once and never starts a transition under reduced motion', () => {
      stubReducedMotion(true);
      const seen = stubTransition(Promise.resolve());
      const update = vi.fn();

      startViewTransition(update, { scope: 'named' });

      expect(update).toHaveBeenCalledTimes(1);
      expect(seen.update).not.toHaveBeenCalled();
      expect(document.documentElement.dataset['viewTransitionScope']).toBeUndefined();
    });

    it('runs the update at once where the browser has no transitions', () => {
      const update = vi.fn();

      startViewTransition(update, { scope: 'named' });

      expect(update).toHaveBeenCalledTimes(1);
      expect(document.documentElement.dataset['viewTransitionScope']).toBeUndefined();
    });

    it('clears the flag and still applies the update when starting the transition throws', () => {
      (document as { startViewTransition?: StartViewTransition }).startViewTransition = () => {
        throw new Error('InvalidStateError');
      };
      const update = vi.fn();

      startViewTransition(update, { scope: 'named' });

      expect(update).toHaveBeenCalledTimes(1);
      expect(document.documentElement.dataset['viewTransitionScope']).toBeUndefined();
    });
  });

  it('leaves the document unmarked for the default root scope', () => {
    let marked: string | undefined = 'unset';
    (document as { startViewTransition?: StartViewTransition }).startViewTransition = (
      callback,
    ) => {
      marked = document.documentElement.dataset['viewTransitionScope'];
      callback();
      return {
        ready: Promise.resolve(),
        finished: Promise.resolve(),
        updateCallbackDone: Promise.resolve(),
      };
    };

    startViewTransition(vi.fn());

    expect(marked).toBeUndefined();
  });
});
