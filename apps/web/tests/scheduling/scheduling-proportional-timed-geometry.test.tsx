import '@testing-library/jest-dom/vitest';

import type * as UiHooks from '@docket/ui/hooks';
import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { assertDefined } from '@docket/test-utils';
import { SchedulingCanvas, type ScheduleLane } from '@/components/scheduling';

vi.mock('@docket/ui/hooks', async (importOriginal) => ({
  ...(await importOriginal<typeof UiHooks>()),
  useMediaQuery: (query: string) => query === '(pointer: coarse)',
}));
afterEach(cleanup);

const lane: ScheduleLane = {
  id: 'today',
  date: '2026-10-07',
  label: 'Today',
  items: [
    {
      id: 'first',
      title: 'Five-minute check',
      startsAt: '2026-10-07T09:00:00Z',
      endsAt: '2026-10-07T09:05:00Z',
    },
    {
      id: 'second',
      title: 'Adjacent five-minute check',
      startsAt: '2026-10-07T09:05:00Z',
      endsAt: '2026-10-07T09:10:00Z',
    },
  ],
};

it('keeps adjacent five-minute geometry proportional under a coarse pointer', () => {
  render(
    <SchedulingCanvas
      displayTimezone="UTC"
      lanes={[lane]}
      pixelsPerHour={84}
      viewportWidth={390}
      preserveTimedGeometry
    />,
  );
  const first = assertDefined(document.querySelector<HTMLElement>('[data-schedule-item="first"]'));
  const second = assertDefined(
    document.querySelector<HTMLElement>('[data-schedule-item="second"]'),
  );
  expect(first.style.height).toBe('7px');
  expect(second.style.height).toBe('7px');
  expect(Number.parseFloat(second.style.top) - Number.parseFloat(first.style.top)).toBe(7);
  expect(first).toHaveAttribute('data-layout-column-count', '1');
  expect(second).toHaveAttribute('data-layout-column-count', '1');
});

it('retains the existing coarse-pointer floor unless the consumer opts in', () => {
  render(
    <SchedulingCanvas
      displayTimezone="UTC"
      lanes={[lane]}
      pixelsPerHour={84}
      viewportWidth={390}
    />,
  );
  const first = assertDefined(document.querySelector<HTMLElement>('[data-schedule-item="first"]'));
  expect(first.style.height).toBe('40px');
  expect(first).toHaveAttribute('data-layout-column-count', '2');
});
