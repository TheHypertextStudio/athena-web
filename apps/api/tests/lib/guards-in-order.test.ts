import { describe, expect, it, vi } from 'vitest';

import { guardsInOrder } from '../../src/lib/guards-in-order';

/** A guard that resolves/rejects after `ms`, recording when it started. */
function guard(ms: number, outcome: 'pass' | Error, started: string[], name: string) {
  started.push(name);
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      if (outcome === 'pass') resolve(undefined);
      else reject(outcome);
    }, ms);
  });
}

describe('guardsInOrder', () => {
  it('resolves when every guard passes', async () => {
    const started: string[] = [];

    await expect(
      guardsInOrder([guard(1, 'pass', started, 'a'), guard(1, 'pass', started, 'b')]),
    ).resolves.toBeUndefined();
  });

  it('runs the guards concurrently rather than one after another', async () => {
    vi.useFakeTimers();
    const started: string[] = [];
    try {
      const pending = guardsInOrder([
        guard(1000, 'pass', started, 'a'),
        guard(1000, 'pass', started, 'b'),
        guard(1000, 'pass', started, 'c'),
      ]);
      // All three are already in flight, so one tick past a single guard's duration finishes
      // every one of them. Serial awaits would need three.
      await vi.advanceTimersByTimeAsync(1000);
      await expect(pending).resolves.toBeUndefined();
      expect(started).toEqual(['a', 'b', 'c']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports the earliest-declared failure even when a later guard fails first', async () => {
    const started: string[] = [];
    const first = new Error('Lead not found');
    const second = new Error('Team not found');

    // The second guard loses no time and would win a plain `Promise.all` race; declaration order
    // is what decides which rule the caller is told about.
    await expect(
      guardsInOrder([guard(20, first, started, 'a'), guard(1, second, started, 'b')]),
    ).rejects.toBe(first);
  });

  it('reports a lone failure regardless of its position', async () => {
    const started: string[] = [];
    const boom = new Error('Program not found');

    await expect(
      guardsInOrder([guard(1, 'pass', started, 'a'), guard(1, boom, started, 'b')]),
    ).rejects.toBe(boom);
  });

  it('accepts an empty guard list', async () => {
    await expect(guardsInOrder([])).resolves.toBeUndefined();
  });
});
