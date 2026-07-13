import { describe, expect, it, vi } from 'vitest';

import { acquireSerializedOptimisticWrite } from '../../src/lib/serialized-optimistic-write';

describe('acquireSerializedOptimisticWrite', () => {
  it('waits for the preceding same-key lease and releases idempotently', async () => {
    const owner = {};
    const first = await acquireSerializedOptimisticWrite(owner, 'calendar');
    const enteredSecond = vi.fn();
    const secondPromise = acquireSerializedOptimisticWrite(owner, 'calendar').then((lease) => {
      enteredSecond();
      return lease;
    });

    await Promise.resolve();
    expect(enteredSecond).not.toHaveBeenCalled();

    first.release();
    first.release();
    const second = await secondPromise;
    expect(enteredSecond).toHaveBeenCalledOnce();
    second.release();

    const third = await acquireSerializedOptimisticWrite(owner, 'calendar');
    third.release();
  });

  it('does not couple independent logical keys on the same weak owner', async () => {
    const owner = {};
    const calendar = await acquireSerializedOptimisticWrite(owner, 'calendar');
    const agenda = await acquireSerializedOptimisticWrite(owner, 'agenda:2026-07-01');

    agenda.release();
    calendar.release();
  });
});
