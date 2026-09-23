/**
 * Unit tests for {@link formatEstimate}: a task's time estimate as `h:mm`, with zero a real
 * estimate and an unset or invalid value collapsing to `null` for the caller's placeholder.
 */
import { describe, expect, it } from 'vitest';

import { formatEstimate } from '../../src/lib/format-estimate';

describe('formatEstimate', () => {
  it('formats an estimate as hours and two-digit minutes', () => {
    expect(formatEstimate(90)).toBe('1:30');
    expect(formatEstimate(45)).toBe('0:45');
    expect(formatEstimate(5)).toBe('0:05');
    expect(formatEstimate(120)).toBe('2:00');
    expect(formatEstimate(725)).toBe('12:05');
  });

  it('shows zero as a real estimate', () => {
    expect(formatEstimate(0)).toBe('0:00');
    expect(formatEstimate(0.4)).toBe('0:00');
  });

  it('rounds a fractional minute count to the nearest whole minute', () => {
    expect(formatEstimate(90.4)).toBe('1:30');
    expect(formatEstimate(44.6)).toBe('0:45');
  });

  it('returns null for an unset, negative, or non-finite estimate', () => {
    expect(formatEstimate(null)).toBeNull();
    expect(formatEstimate(undefined)).toBeNull();
    expect(formatEstimate(-30)).toBeNull();
    expect(formatEstimate(Number.NaN)).toBeNull();
    expect(formatEstimate(Number.POSITIVE_INFINITY)).toBeNull();
  });
});
