/**
 * A planned task's timing: its timebox start when scheduled, else its time estimate as `h:mm`.
 */
import '@testing-library/jest-dom/vitest';

import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { planTiming, PlanTimingLabel } from '@/components/today/plan-timing';

describe('planTiming', () => {
  it('prefers the timebox start', () => {
    expect(
      planTiming({ timeboxStartsAt: '2026-09-22T14:30:00.000Z', estimateMinutes: 30 }, 'UTC'),
    ).toEqual({ kind: 'start', label: expect.stringMatching(/2:30/) });
  });

  it('falls back to the time estimate', () => {
    expect(planTiming({ timeboxStartsAt: null, estimateMinutes: 90 }, undefined)).toEqual({
      kind: 'estimate',
      label: '1:30',
    });
  });

  it('has nothing to show without either', () => {
    expect(planTiming({ timeboxStartsAt: null, estimateMinutes: null }, 'UTC')).toBeNull();
  });
});

describe('PlanTimingLabel', () => {
  it('renders the label beside a decorative glyph', () => {
    const { container } = render(<PlanTimingLabel timing={{ kind: 'estimate', label: '0:45' }} />);

    expect(container).toHaveTextContent('0:45');
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });
});
