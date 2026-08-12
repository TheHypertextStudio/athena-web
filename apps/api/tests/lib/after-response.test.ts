import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  deferAfterResponse,
  flushDeferredWork,
  pendingDeferredCount,
} from '../../src/lib/after-response';

/** A promise plus the handles to settle it, so a test controls when deferred work finishes. */
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

let logged: string[];

beforeEach(() => {
  logged = [];
  vi.spyOn(console, 'error').mockImplementation((line: unknown) => {
    logged.push(String(line));
  });
});

afterEach(async () => {
  await flushDeferredWork();
  vi.restoreAllMocks();
});

describe('deferAfterResponse', () => {
  it('returns before the work it defers has finished', async () => {
    const gate = deferred();
    let ran = false;

    deferAfterResponse('search-upsert', async () => {
      await gate.promise;
      ran = true;
    });

    // The whole point: the caller is free to answer its request now. Nothing forced it to wait.
    expect(ran).toBe(false);
    expect(pendingDeferredCount()).toBe(1);

    gate.resolve();
    await flushDeferredWork();
    expect(ran).toBe(true);
  });

  it('stops tracking work once it settles', async () => {
    deferAfterResponse('search-upsert', async () => undefined);

    await flushDeferredWork();

    expect(pendingDeferredCount()).toBe(0);
  });

  it('reports a failure instead of losing it silently', async () => {
    deferAfterResponse('search-upsert', async () => {
      throw new Error('index write failed');
    });

    await flushDeferredWork();

    // Deferred work is invisible to the request that scheduled it, so the log is the only place
    // a failure can surface. Swallowing it is how a missing search row becomes unexplainable.
    expect(logged).toHaveLength(1);
    const entry = JSON.parse(logged[0]!) as Record<string, unknown>;
    expect(entry['event']).toBe('deferred_work_failed');
    expect(entry['label']).toBe('search-upsert');
    expect(entry['message']).toBe('index write failed');
  });

  it('reports a synchronous throw from the scheduled function', async () => {
    deferAfterResponse('emit-event', () => {
      throw new Error('bad input');
    });

    await flushDeferredWork();

    expect(JSON.parse(logged[0]!)).toMatchObject({
      event: 'deferred_work_failed',
      label: 'emit-event',
    });
  });

  it('keeps one failure from cancelling the rest', async () => {
    let secondRan = false;

    deferAfterResponse('emit-event', async () => {
      throw new Error('first');
    });
    deferAfterResponse('search-upsert', async () => {
      secondRan = true;
    });

    await flushDeferredWork();

    expect(secondRan).toBe(true);
    expect(pendingDeferredCount()).toBe(0);
  });
});

describe('flushDeferredWork', () => {
  it('waits for work scheduled while an earlier item was still running', async () => {
    const gate = deferred();
    let nestedRan = false;

    deferAfterResponse('outer', async () => {
      await gate.promise;
      deferAfterResponse('inner', async () => {
        nestedRan = true;
      });
    });

    gate.resolve();
    await flushDeferredWork();

    // Shutdown is the only chance this work gets. A flush that drained one generation and left
    // the next in the air would lose exactly the writes it exists to protect.
    expect(nestedRan).toBe(true);
    expect(pendingDeferredCount()).toBe(0);
  });

  it('resolves immediately when nothing is pending', async () => {
    await expect(flushDeferredWork()).resolves.toBeUndefined();
  });
});
