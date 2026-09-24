import '@testing-library/jest-dom/vitest';

import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SchedulingTimeGrid } from '../../src/components/scheduling/scheduling-time-grid';

describe('SchedulingTimeGrid boundary labels', () => {
  it('keeps midnight and the end-of-day label inside the grid without moving their ticks', () => {
    const { container } = render(
      <SchedulingTimeGrid
        lanes={[]}
        displayTimezone="UTC"
        pixelsPerHour={60}
        gutterWidth={88}
        contentWidth={200}
        laneWidth={200}
      >
        {null}
      </SchedulingTimeGrid>,
    );

    expect(container.querySelector('[data-schedule-label="0"]')).toHaveClass('translate-y-0');
    expect(container.querySelector('[data-schedule-label="1440"]')).toHaveClass(
      '-translate-y-full',
    );
    expect(container.querySelector('[data-schedule-label="60"]')).toHaveClass('-translate-y-1/2');
    expect(container.querySelector('[data-schedule-tick-minutes="0"]')).toHaveStyle({ top: '0px' });
  });
});
