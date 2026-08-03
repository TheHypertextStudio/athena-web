/**
 * Unit tests for dispositioning one unfinished item in the end-of-day review.
 */
import { describe, expect, it } from 'vitest';

import { ReviewDispositionInput } from '../../src/scheduling-directive';

describe('ReviewDispositionInput', () => {
  it('requires a reason when dropping an item', () => {
    expect(
      ReviewDispositionInput.safeParse({ key: 'task_1', disposition: 'dropped' }).success,
    ).toBe(false);
    expect(
      ReviewDispositionInput.safeParse({
        key: 'task_1',
        disposition: 'dropped',
        reason: 'No longer relevant',
      }).success,
    ).toBe(true);
    // Whitespace-only is not a reason.
    expect(
      ReviewDispositionInput.safeParse({
        key: 'task_1',
        disposition: 'dropped',
        reason: '   ',
      }).success,
    ).toBe(false);
  });

  it('requires a date when rescheduling an item', () => {
    expect(
      ReviewDispositionInput.safeParse({ key: 'task_1', disposition: 'rescheduled' }).success,
    ).toBe(false);
    expect(
      ReviewDispositionInput.safeParse({
        key: 'task_1',
        disposition: 'rescheduled',
        rescheduledTo: '2026-08-05',
      }).success,
    ).toBe(true);
  });

  it('needs neither a reason nor a date when the item was simply completed', () => {
    expect(
      ReviewDispositionInput.safeParse({ key: 'task_1', disposition: 'completed' }).success,
    ).toBe(true);
  });
});
