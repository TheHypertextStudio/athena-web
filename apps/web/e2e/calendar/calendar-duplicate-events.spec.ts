/**
 * One block per event, however many accounts it arrives from.
 *
 * @remarks
 * *"Surely there's some way to deduplicate shit like holiday calendars or personal calendars
 * appearing on work accounts."* Linking a work account and a personal account puts the same holiday
 * and the same shared meeting on the grid twice; the overlap machinery then correctly lays the two
 * copies side by side and the day reads as twice as busy as it is.
 *
 * This drives the real grid in a browser and asserts that the web client trusts the API's canonical
 * event projection. The UI renders one event and does not reintroduce provider-copy language.
 *
 * The negative case is asserted in the same run: two genuinely different events on the two accounts
 * stay two blocks, so a passing run cannot be explained by "the grid drew fewer things".
 */
import { CalendarItemId, CalendarLayerId } from '@docket/planning/ids';

import { signUpAndOnboard } from '../helpers/app';
import {
  CALENDAR_IDS,
  makeCalendarItem,
  makeCalendarLayer,
  utcAt,
} from '../helpers/calendar-fixtures';
import { calendarRouteState, installCalendarRoutes } from '../helpers/calendar-routes';
import { openScheduleItemDetail } from '../helpers/calendar-ui';
import { expect, test } from '../helpers/fixtures';

const ANCHOR_DATE = '2026-07-13';
const WORK_LAYER = CalendarLayerId.parse('01BX5ZZKBKACTAV9WEVGEMMVA1');
const PERSONAL_LAYER = CalendarLayerId.parse('01BX5ZZKBKACTAV9WEVGEMMVA2');
const PERSONAL_COPY = CalendarItemId.parse('01BX5ZZKBKACTAV9WEVGEMMVD2');
const WORK_ONLY = CalendarItemId.parse('01BX5ZZKBKACTAV9WEVGEMMVD3');
const PERSONAL_ONLY = CalendarItemId.parse('01BX5ZZKBKACTAV9WEVGEMMVD4');

test.use({ timezoneId: 'UTC', viewport: { width: 1440, height: 900 } });

test('renders one canonical block for an event that synced from two accounts', async ({ page }) => {
  await page.clock.setFixedTime(`${ANCHOR_DATE}T17:00:00.000Z`);
  await signUpAndOnboard(page, 'DuplicateEvents');

  const work = makeCalendarLayer({
    id: WORK_LAYER,
    title: 'ada@work.example',
    connectionId: CALENDAR_IDS.googleConnection,
    provider: 'google',
    sourceKind: 'provider_calendar',
    externalLayerId: 'ada@work.example',
    color: '#2563eb',
  });
  const personal = makeCalendarLayer({
    id: PERSONAL_LAYER,
    title: 'ada@personal.example',
    connectionId: CALENDAR_IDS.googleConnection,
    provider: 'google',
    sourceKind: 'provider_calendar',
    externalLayerId: 'ada@personal.example',
    color: '#b45309',
  });

  const sharedMeeting = makeCalendarItem({
    id: PERSONAL_COPY,
    layerId: PERSONAL_LAYER,
    kind: 'provider_event',
    provider: 'google',
    connectionId: CALENDAR_IDS.googleConnection,
    externalEventId: 'evt-shared-9',
    eventIdentity: { namespace: 'google:icaluid', value: 'quarterly-planning@example.test' },
    occurrenceIdentity: utcAt(ANCHOR_DATE, 10),
    title: 'Quarterly planning',
    startsAt: utcAt(ANCHOR_DATE, 10),
    endsAt: utcAt(ANCHOR_DATE, 11),
    permissions: { canEditCore: false, canDelete: false, readOnlyReason: 'provider_scope' },
  });

  const state = calendarRouteState({
    layers: [work, personal],
    items: [
      sharedMeeting,
      // Two events that are genuinely different, one per account, so "fewer blocks" cannot pass
      // for "correct blocks".
      makeCalendarItem({
        id: WORK_ONLY,
        layerId: WORK_LAYER,
        kind: 'provider_event',
        provider: 'google',
        externalEventId: 'evt-standup',
        title: 'Standup',
        startsAt: utcAt(ANCHOR_DATE, 13),
        endsAt: utcAt(ANCHOR_DATE, 13, 30),
      }),
      makeCalendarItem({
        id: PERSONAL_ONLY,
        layerId: PERSONAL_LAYER,
        kind: 'provider_event',
        provider: 'google',
        externalEventId: 'evt-dentist',
        title: 'Dentist',
        startsAt: utcAt(ANCHOR_DATE, 15),
        endsAt: utcAt(ANCHOR_DATE, 16),
      }),
    ],
    preferences: { timezone: 'UTC', calendar: { pixelsPerHour: 72, minLaneWidth: 240 } },
  });
  await installCalendarRoutes(page, state);

  await page.goto(`/calendar?date=${ANCHOR_DATE}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('region', { name: 'Schedule' })).toBeVisible();

  const main = page.locator('main#main-content');
  // Exactly one block for the duplicated meeting.
  await expect(main.getByRole('button', { name: /^Quarterly planning/ })).toHaveCount(1);
  // …and both distinct events are still drawn: three blocks in total, not two, not four.
  await expect(main.locator('[data-schedule-item]')).toHaveCount(3);
  await expect(main.getByRole('button', { name: /^Standup/ })).toHaveCount(1);
  await expect(main.getByRole('button', { name: /^Dentist/ })).toHaveCount(1);

  const drawer = await openScheduleItemDetail(page, PERSONAL_COPY);
  await expect(drawer.getByRole('heading', { name: 'Quarterly planning' })).toBeVisible();
  await expect(drawer.getByText(/also synced from|drawn once/i)).toHaveCount(0);
});
