import { act } from '@testing-library/react';
import type * as WallTime from '@docket/planning/wall-time';
import type { JSX } from 'react';
import { hydrateRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useTodayData } from '../../src/app/(app)/today/use-today-data';

const fixture = vi.hoisted<{ timezone: string; preferredTimezone: string | undefined }>(() => ({
  timezone: 'UTC',
  preferredTimezone: undefined,
}));
vi.mock('@docket/ui/components', () => ({ useContextState: () => ({ activeOrgId: null }) }));
vi.mock('../../src/components/active-org', () => ({
  useActiveOrg: () => ({ orgName: () => 'Personal' }),
}));
vi.mock('@docket/planning/wall-time', async (importOriginal) => ({
  ...(await importOriginal<typeof WallTime>()),
  resolveScheduleTimezone: (timezone: string | undefined) => timezone ?? fixture.timezone,
}));
vi.mock('../../src/components/scheduling', async () => ({
  useHydratedScheduleTimezone: (
    await import('../../src/components/scheduling/use-hydrated-schedule-timezone')
  ).useHydratedScheduleTimezone,
  dateKeyForInstant: (await import('../../src/components/scheduling/scheduling-date-lanes'))
    .dateKeyForInstant,
}));
vi.mock('../../src/lib/api', () => ({ api: {} }));
vi.mock('../../src/lib/query', () => ({
  queryKeys: { hubPreferences: () => ['preferences'], today: () => ['today'] },
  apiQueryOptions: () => ({}),
  useApiQuery: () => ({
    data: fixture.preferredTimezone ? { timezone: fixture.preferredTimezone } : undefined,
    isPending: true,
    error: null,
    refetch: vi.fn(),
  }),
}));

function DateHeading(): JSX.Element {
  const data = useTodayData();
  return <p data-date={data.date}>{data.heading}</p>;
}

let root: Root | undefined;
afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  root = undefined;
  document.body.replaceChildren();
  vi.useRealTimers();
  fixture.preferredTimezone = undefined;
});

describe('Today date hydration', () => {
  it.each([
    { timezone: 'America/Los_Angeles', preferred: undefined, date: '2026-10-10' },
    { timezone: 'Asia/Tokyo', preferred: undefined, date: '2026-10-11' },
    { timezone: 'America/Los_Angeles', preferred: 'Asia/Tokyo', date: '2026-10-11' },
  ])(
    'preserves timezone/date selection after hydration: $timezone with preference $preferred',
    async ({ timezone, preferred, date }) => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-10-11T05:00:00Z'));
      fixture.timezone = 'UTC';
      fixture.preferredTimezone = preferred;
      const container = document.createElement('div');
      container.innerHTML = renderToString(<DateHeading />);
      document.body.append(container);
      expect(container.textContent).toBe('Sunday, October 11');

      fixture.timezone = timezone;
      const errors: unknown[] = [];
      await act(async () => {
        root = hydrateRoot(container, <DateHeading />, {
          onRecoverableError: (error) => errors.push(error),
        });
      });
      expect(errors).toEqual([]);
      expect(container.firstElementChild?.getAttribute('data-date')).toBe(date);
      expect(container.textContent).toBe(
        date === '2026-10-10' ? 'Saturday, October 10' : 'Sunday, October 11',
      );
    },
  );
});
