import { describe, expect, it } from 'vitest';

import {
  supportsWorkViewRenderer,
  workViewRendererLayouts,
} from '../../src/components/work-views/work-view-renderers';
import { formatWorkViewValue } from '../../src/components/work-views/renderer-types';

describe('work-view renderer registry', () => {
  it('keeps reusable renderer choices out of object field contracts', () => {
    expect(workViewRendererLayouts('program')).toEqual(['list', 'board', 'cards']);
    expect(workViewRendererLayouts('initiative')).toEqual(['list', 'board', 'cards', 'timeline']);
    expect(supportsWorkViewRenderer('program', 'timeline')).toBe(false);
  });

  it('renders a semantic timeframe label in every shared roster renderer', () => {
    expect(formatWorkViewValue({ key: '2027-06-30|halfYear|6', label: 'H2 FY 2027' }, 'enum')).toBe(
      'H2 FY 2027',
    );
  });

  it('keeps the time on a datetime so two same-day instants stay distinguishable', () => {
    const morning = formatWorkViewValue('2026-08-23T09:00:00.000Z', 'datetime');
    const evening = formatWorkViewValue('2026-08-23T17:00:00.000Z', 'datetime');

    expect(morning).not.toBe(evening);
    // A bare `YYYY-MM-DD` is a calendar day and carries no instant, so it keeps the day-only form.
    expect(formatWorkViewValue('2026-08-23', 'date')).not.toMatch(/\d:\d/);
    // Neither shape may leak the raw wire value.
    expect(morning).not.toContain('T');
    expect(formatWorkViewValue('not-a-date', 'datetime')).toBe('—');
  });
});
