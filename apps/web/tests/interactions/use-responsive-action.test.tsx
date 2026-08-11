import { act, cleanup, render, renderHook } from '@testing-library/react';
import { type JSX, type ReactNode, useEffect, useRef, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  InteractionReceiptProvider,
  type InteractionReceiptContextValue,
  type InteractionTimeout,
  useInteractionReceipts,
} from '@/lib/interactions/receipt-context';
import { useResponsiveAction } from '@/lib/interactions/use-responsive-action';

afterEach(cleanup);

interface FrameQueue {
  readonly requestFrame: (callback: FrameRequestCallback) => number;
  readonly cancelFrame: (handle: number) => void;
  readonly runNext: () => void;
}

function createFrameQueue(): FrameQueue {
  const callbacks = new Map<number, FrameRequestCallback>();
  let nextHandle = 1;

  return {
    requestFrame: (callback) => {
      const handle = nextHandle;
      nextHandle += 1;
      callbacks.set(handle, callback);
      return handle;
    },
    cancelFrame: (handle) => {
      callbacks.delete(handle);
    },
    runNext: () => {
      const next = callbacks.entries().next().value;
      if (!next) throw new Error('No animation frame is scheduled.');
      callbacks.delete(next[0]);
      next[1](0);
    },
  };
}

function wrapper(
  frames: FrameQueue,
  scheduleTimeout: (callback: () => void, delay: number) => InteractionTimeout,
  clearScheduledTimeout: (handle: InteractionTimeout) => void,
): ({ children }: { readonly children: ReactNode }) => JSX.Element {
  let sequence = 0;
  return function ResponsiveActionProvider({
    children,
  }: {
    readonly children: ReactNode;
  }): JSX.Element {
    return (
      <InteractionReceiptProvider
        requestFrame={frames.requestFrame}
        cancelFrame={frames.cancelFrame}
        scheduleTimeout={scheduleTimeout}
        clearScheduledTimeout={clearScheduledTimeout}
        createInvocationId={() => `ephemeral-hook-${++sequence}`}
      >
        {children}
      </InteractionReceiptProvider>
    );
  };
}

describe('useResponsiveAction', () => {
  it('waits for the caller-owned acknowledgement predicate instead of handler settlement', async () => {
    const frames = createFrameQueue();
    const timeouts = new Map<number, () => void>();
    let nextTimeout = 1;
    const { result } = renderHook(
      () => {
        const [acknowledged, setAcknowledged] = useState(false);
        const action = useResponsiveAction({
          interactionId: 'app.mutation',
          category: 'mutation',
          routeTemplateId: '/tasks/[taskId]',
          acknowledgementPredicate: () => acknowledged,
        });
        return { action, setAcknowledged };
      },
      {
        wrapper: wrapper(
          frames,
          (callback) => {
            const handle = nextTimeout;
            nextTimeout += 1;
            timeouts.set(handle, callback);
            return handle;
          },
          (handle) => {
            if (typeof handle === 'number') timeouts.delete(handle);
          },
        ),
      },
    );

    await act(async () => {
      void result.current.action.run(async () => undefined);
    });
    expect(result.current.action.phase).toBe('activated');
    expect(result.current.action.blocksTrigger).toBe(true);
    expect(result.current.action.statusProps).toMatchObject({ 'aria-busy': true, role: 'status' });

    await act(async () => {
      result.current.setAcknowledged(true);
    });
    await act(async () => {
      frames.runNext();
    });
    expect(result.current.action.phase).toBe('activated');
    await act(async () => {
      frames.runNext();
    });
    expect(result.current.action.phase).toBe('settled');
  });

  it('escalates the local status at 300ms and five seconds without blocking another control', async () => {
    vi.useFakeTimers();
    const frames = createFrameQueue();
    const { result } = renderHook(
      () =>
        useResponsiveAction({
          interactionId: 'app.long-running',
          category: 'long-running',
          routeTemplateId: '/tasks/[taskId]',
          acknowledgementPredicate: () => true,
        }),
      { wrapper: wrapper(frames, setTimeout, clearTimeout) },
    );
    let resolve: (() => void) | undefined;

    await act(async () => {
      void result.current.run(
        () =>
          new Promise<void>((done) => {
            resolve = done;
          }),
      );
    });
    await act(async () => {
      frames.runNext();
    });
    await act(async () => {
      frames.runNext();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(result.current.phase).toBe('progressing');
    expect(result.current.blocksTrigger).toBe(true);
    expect(result.current.statusProps.children).toBe('Working…');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_700);
    });
    expect(result.current.phase).toBe('sustained');
    expect(result.current.statusProps.children).toBe('Still working');

    await act(async () => {
      resolve?.();
    });
    expect(result.current.phase).toBe('settled');
    vi.useRealTimers();
  });

  it('blocks only an exact duplicate trigger and exposes retry after a failed handler', async () => {
    const frames = createFrameQueue();
    const { result } = renderHook(
      () =>
        useResponsiveAction({
          interactionId: 'app.mutation',
          category: 'mutation',
          routeTemplateId: '/tasks/[taskId]',
          acknowledgementPredicate: () => true,
        }),
      { wrapper: wrapper(frames, setTimeout, clearTimeout) },
    );
    let reject: ((error: Error) => void) | undefined;
    let first: Promise<void> | undefined;
    let duplicate: Promise<void> | undefined;
    await act(async () => {
      first = result.current.run(
        () =>
          new Promise<void>((_resolve, fail) => {
            reject = fail;
          }),
      );
      duplicate = result.current.run(async () => undefined);
    });

    expect(duplicate).toBe(first);
    await act(async () => {
      frames.runNext();
    });
    await act(async () => {
      frames.runNext();
    });
    await act(async () => {
      reject?.(new Error('Private provider failure'));
      await first;
    });

    expect(result.current.phase).toBe('needs_attention');
    expect(result.current.blocksTrigger).toBe(false);
    expect(result.current.statusProps.children).toBe('Couldn’t complete. Try again.');
  });

  it('cancels its delayed timers and painted acknowledgement when unmounted', async () => {
    vi.useFakeTimers();
    const frames = createFrameQueue();
    const { result, unmount } = renderHook(
      () =>
        useResponsiveAction({
          interactionId: 'app.read',
          category: 'read',
          routeTemplateId: '/tasks/[taskId]',
          acknowledgementPredicate: () => true,
        }),
      { wrapper: wrapper(frames, setTimeout, clearTimeout) },
    );

    await act(async () => {
      void result.current.run(() => new Promise<void>(() => undefined));
    });
    unmount();
    expect(() => {
      act(frames.runNext);
    }).toThrow('No animation frame is scheduled.');
    vi.useRealTimers();
  });

  it('abandons acknowledged work when only its owner unmounts and ignores late settlement', async () => {
    const frames = createFrameQueue();
    let context: InteractionReceiptContextValue | undefined;
    let resolve: (() => void) | undefined;
    const work = new Promise<void>((done) => {
      resolve = done;
    });

    function ReceiptProbe({
      onReady,
    }: {
      readonly onReady: (value: InteractionReceiptContextValue) => void;
    }) {
      const value = useInteractionReceipts();
      useEffect(() => {
        onReady(value);
      }, [onReady, value]);
      return null;
    }

    function ActionOwner(): null {
      const action = useResponsiveAction({
        interactionId: 'app.read',
        category: 'read',
        routeTemplateId: '/tasks/[taskId]',
        acknowledgementPredicate: () => true,
      });
      const started = useRef(false);
      useEffect(() => {
        if (started.current) return;
        started.current = true;
        void action.run(() => work);
      }, [action]);
      return null;
    }

    function Harness({ showOwner }: { readonly showOwner: boolean }): JSX.Element {
      return (
        <InteractionReceiptProvider
          requestFrame={frames.requestFrame}
          cancelFrame={frames.cancelFrame}
          createInvocationId={() => 'ephemeral-owner-only'}
        >
          <ReceiptProbe onReady={(value) => (context = value)} />
          {showOwner ? <ActionOwner /> : null}
        </InteractionReceiptProvider>
      );
    }

    const view = render(<Harness showOwner />);
    await act(async () => {
      frames.runNext();
    });
    await act(async () => {
      frames.runNext();
    });
    expect(context?.receiptFor('ephemeral-owner-only')).toMatchObject({ phase: 'acknowledged' });

    view.rerender(<Harness showOwner={false} />);
    expect(context?.receiptFor('ephemeral-owner-only')).toMatchObject({
      phase: 'settled',
      outcome: 'abandoned',
    });

    await act(async () => {
      resolve?.();
      await work;
    });
    expect(context?.receiptFor('ephemeral-owner-only')).toMatchObject({ outcome: 'abandoned' });
  });
});
