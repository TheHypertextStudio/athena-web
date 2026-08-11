import { act, cleanup, render } from '@testing-library/react';
import { type JSX, type ReactNode, useEffect } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  InteractionReceiptProvider,
  type InteractionReceiptContextValue,
  useInteractionReceipts,
} from '@/lib/interactions/receipt-context';

afterEach(cleanup);

const invocation = {
  interactionId: 'app.mutation' as const,
  category: 'mutation' as const,
  routeTemplateId: '/tasks/[taskId]' as const,
};

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

function ContextProbe({
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

function provider(
  frames: FrameQueue,
  children: ReactNode,
  now: () => number = () => 0,
): JSX.Element {
  let sequence = 0;
  return (
    <InteractionReceiptProvider
      now={now}
      requestFrame={frames.requestFrame}
      cancelFrame={frames.cancelFrame}
      createInvocationId={() => `ephemeral-context-invocation-${++sequence}`}
    >
      {children}
    </InteractionReceiptProvider>
  );
}

describe('InteractionReceiptProvider', () => {
  it('starts a receipt synchronously before asynchronous work begins', () => {
    const frames = createFrameQueue();
    let context: InteractionReceiptContextValue | undefined;
    render(provider(frames, <ContextProbe onReady={(value) => (context = value)} />));

    const started = context?.startInteraction(invocation);

    expect(started).toMatchObject({
      ...invocation,
      invocationId: 'ephemeral-context-invocation-1',
    });
  });

  it('does not acknowledge until a semantic predicate is true through two painted frames', async () => {
    const frames = createFrameQueue();
    let context: InteractionReceiptContextValue | undefined;
    let now = 10;
    render(provider(frames, <ContextProbe onReady={(value) => (context = value)} />, () => now));

    const started = context?.startInteraction(invocation);
    if (!started || !context) throw new Error('Provider context did not mount.');

    let committed = false;
    const refused = context.acknowledgeAfterPaint(started.invocationId, () => committed);
    await expect(refused.done).resolves.toBeUndefined();

    committed = true;
    now = 20;
    const acknowledgement = context.acknowledgeAfterPaint(started.invocationId, () => committed);
    act(frames.runNext);
    expect(context.receiptFor(started.invocationId)?.phase).toBe('activated');
    committed = false;
    act(frames.runNext);
    await expect(acknowledgement.done).resolves.toBeUndefined();
    expect(context.receiptFor(started.invocationId)?.phase).toBe('activated');

    committed = true;
    now = 30;
    const painted = context.acknowledgeAfterPaint(started.invocationId, () => committed);
    act(frames.runNext);
    act(frames.runNext);
    await expect(painted.done).resolves.toMatchObject({
      phase: 'acknowledged',
      acknowledgedAt: 30,
    });
  });

  it('records an application-owned recovery outcome and abandons unresolved work on cleanup', () => {
    const frames = createFrameQueue();
    let context: InteractionReceiptContextValue | undefined;
    const view = render(provider(frames, <ContextProbe onReady={(value) => (context = value)} />));
    const started = context?.startInteraction(invocation);
    if (!started || !context) throw new Error('Provider context did not mount.');

    context.acknowledgeAfterPaint(started.invocationId, () => true);
    act(frames.runNext);
    act(frames.runNext);
    context.recoverInteraction(started.invocationId, 'retry');
    expect(context.receiptFor(started.invocationId)).toMatchObject({
      phase: 'settled',
      outcome: 'needs_attention',
      recovery: 'retry',
    });

    const unresolved = context.startInteraction({
      ...invocation,
      interactionId: 'app.read',
      category: 'read',
    });
    view.unmount();
    expect(context.receiptFor(unresolved.invocationId)).toMatchObject({
      phase: 'settled',
      outcome: 'abandoned',
    });
  });
});
