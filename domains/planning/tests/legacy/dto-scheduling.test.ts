/**
 * Unit tests for the weekly auto-scheduling helpers and validators.
 */
import { describe, expect, it } from 'vitest';

import {
  AvailabilityWindow,
  WORK_SHAPES,
  WORK_SHAPE_PROFILES,
  workShapeProfile,
} from '../../src/contracts/scheduling';

describe('workShapeProfile', () => {
  it('looks up the constraint profile for every declared work shape', () => {
    for (const shape of WORK_SHAPES) {
      expect(workShapeProfile(shape)).toBe(WORK_SHAPE_PROFILES[shape]);
      expect(workShapeProfile(shape).shape).toBe(shape);
    }
  });
});

describe('AvailabilityWindow', () => {
  it('accepts a window that ends after it starts', () => {
    expect(
      AvailabilityWindow.safeParse({
        weekday: 1,
        startMinute: 540,
        endMinute: 720,
        kind: 'desk',
        label: 'Morning pages',
      }).success,
    ).toBe(true);
  });

  it('refuses a window that ends before or at its own start', () => {
    expect(
      AvailabilityWindow.safeParse({
        weekday: 1,
        startMinute: 720,
        endMinute: 540,
        kind: 'desk',
        label: null,
      }).success,
    ).toBe(false);
    expect(
      AvailabilityWindow.safeParse({
        weekday: 1,
        startMinute: 540,
        endMinute: 540,
        kind: 'desk',
        label: null,
      }).success,
    ).toBe(false);
  });
});
