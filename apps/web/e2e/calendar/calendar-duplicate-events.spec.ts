/**
 * One block per event, however many accounts it arrives from.
 *
 * @remarks
 * *"Surely there's some way to deduplicate shit like holiday calendars or personal calendars
 * appearing on work accounts."* Linking a work account and a personal account puts the same holiday
 * and the same shared meeting on the grid twice; the overlap machinery then correctly lays the two
 * copies side by side and the day reads as twice as busy as it is.
 *
 * This drives the real grid in a browser and asserts both halves of the fix: exactly **one** rendered
 * block for the duplicated event, and the folded-away copy still **discoverable** in that block's own
 * detail view. A collapse the reader cannot see through is not a fix, it is a lie about what synced.
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
import { scheduleItem } from '../helpers/calendar-ui';
import { expect, test } from '../helpers/fixtures';
import { assertDefined } from '@docket/test-utils';

const ANCHOR_DATE = '2026-07-13';
const WORK_LAYER = CalendarLayerId.parse('01BX5ZZKBKACTAV9WEVGEMMVA1');
const PERSONAL_LAYER = CalendarLayerId.parse('01BX5ZZKBKACTAV9WEVGEMMVA2');
const WORK_COPY = CalendarItemId.parse('01BX5ZZKBKACTAV9WEVGEMMVD1');
const PERSONAL_COPY = CalendarItemId.parse('01BX5ZZKBKACTAV9WEVGEMMVD2');
const WORK_ONLY = CalendarItemId.parse('01BX5ZZKBKACTAV9WEVGEMMVD3');
const PERSONAL_ONLY = CalendarItemId.parse('01BX5ZZKBKACTAV9WEVGEMMVD4');

test.use({ timezoneId: 'UTC', viewport: { width: 1440, height: 900 } });

test('renders one block for an event that synced from two accounts, and says where it came from', async ({
  page,
}) => {
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

  /** The same meeting, invited at both addresses: one provider event id, two calendars. */
  const sharedMeeting = (id: string, layerId: string) =>
    makeCalendarItem({
      id,
      layerId,
      kind: 'provider_event',
      provider: 'google',
      connectionId: CALENDAR_IDS.googleConnection,
      externalEventId: 'evt-shared-9',
      title: 'Quarterly planning',
      startsAt: utcAt(ANCHOR_DATE, 10),
      endsAt: utcAt(ANCHOR_DATE, 11),
      permissions: { canEditCore: false, canDelete: false, readOnlyReason: 'provider_scope' },
    });

  const state = calendarRouteState({
    layers: [work, personal],
    items: [
      sharedMeeting(WORK_COPY, WORK_LAYER),
      sharedMeeting(PERSONAL_COPY, PERSONAL_LAYER),
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

  // The copy that was folded away is discoverable from the block that survived.
  const survivor = (
    await main
      .locator('[data-schedule-item]')
      .evaluateAll((nodes) =>
        nodes
          .map((node) => node.getAttribute('data-schedule-item'))
          .filter((id): id is string => id !== null),
      )
  ).find((id) => id === WORK_COPY || id === PERSONAL_COPY);
  expect(survivor, 'one copy of the duplicated meeting survived').toBeDefined();

  await scheduleItem(page, assertDefined(survivor)).body.click();
  const drawer = page.getByRole('dialog');
  await expect(drawer.getByRole('heading', { name: 'Also on' })).toBeVisible();
  await expect(
    drawer.getByText('This event also synced from one other calendar. It is drawn once here.'),
  ).toBeVisible();
});
