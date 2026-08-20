import { describe, expect, it } from 'vitest';

import {
  scheduleAvailabilityFill,
  scheduleBusyFill,
  scheduleEventFill,
  scheduleTimeboxFill,
} from '../../src/components/scheduling/scheduling-item-surface';

describe('scheduling item surface fills', () => {
  it('uses an event calendar color directly and falls back to the semantic primary', () => {
    expect(scheduleEventFill('#316eb4')).toBe('#316eb4');
    expect(scheduleEventFill()).toBe('var(--color-primary)');
    expect(scheduleEventFill('   ')).toBe('var(--color-primary)');
  });

  it('keeps timebox and availability color subordinate', () => {
    expect(scheduleTimeboxFill('#316eb4')).toBe('color-mix(in oklab, #316eb4 14%, transparent)');
    expect(scheduleAvailabilityFill('#316eb4')).toBe(
      'color-mix(in oklab, #316eb4 9%, transparent)',
    );
  });

  it('uses semantic fallbacks for uncolored subordinate states', () => {
    expect(scheduleTimeboxFill()).toContain('var(--color-primary) 14%');
    expect(scheduleAvailabilityFill()).toContain('var(--color-tertiary) 9%');
    expect(scheduleBusyFill()).toBe('color-mix(in oklab, var(--color-on-surface) 7%, transparent)');
  });
});
