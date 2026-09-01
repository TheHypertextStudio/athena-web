/**
 * "It must be possible to drag events into time blocks" — against a real server, with no mocks.
 *
 * @remarks
 * `../scheduling/fluid-scheduling-relations.spec.ts` already exercises this gesture, but it installs
 * route fixtures and asserts on the recorded POST bodies. That proves the *request* was shaped
 * correctly and nothing else: no server ever stores anything, and the page is never reloaded, so it
 * cannot tell the difference between a working feature and one whose write is dropped on the floor.
 *
 * This spec closes that gap and is deliberately mock-free:
 *
 * 1. both items are created through the product's own `POST /v1/me/calendar/items`, in the signed-in
 *    browser context, so they exist in the database;
 * 2. the event is dragged onto the block with a real HTML5 drag;
 * 3. the association is asserted **in the UI immediately** (the block's drawer lists the event);
 * 4. the association is asserted **on the server** by re-reading the relations endpoint;
 * 5. the page is **reloaded from scratch** and the association is asserted again.
 *
 * Steps 4 and 5 are what a mocked spec structurally cannot do.
 */
import type { CalendarItemOut } from '@docket/planning/calendar-contract';
import type { Page } from '@playwright/test';

import { signUpAndOnboard } from '../helpers/app';
import { dragLocatorToLocator, scheduleItem } from '../helpers/calendar-ui';
import { ORIGIN } from '../helpers/constants';
import { expect, test } from '../helpers/fixtures';

const ANCHOR_DATE = '2026-07-13';

/** The API origin the browser context is already authenticated against. */
const API_ORIGIN = process.env['API_URL'] ?? `https://api.${new URL(ORIGIN).hostname}`;

// The rail has to be beside the grid, and both cards have to be on screen at once.
test.use({ timezoneId: 'UTC', viewport: { width: 1440, height: 900 } });

/** An exact UTC instant on the anchor date. */
function at(hour: number, minute = 0): string {
  return `${ANCHOR_DATE}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00.000Z`;
}

/** Create one calendar item through the real API, using the browser's own session. */
async function createItem(
  page: Page,
  input: { intent: 'timebox' | 'event'; title: string; startsAt: string; endsAt: string },
): Promise<CalendarItemOut> {
  const response = await page.request.post(`${API_ORIGIN}/v1/me/calendar/items`, {
    data: { ...input, timezone: 'UTC' },
  });
  expect(response.ok(), `create ${input.title}: ${String(response.status())}`).toBe(true);
  return (await response.json()) as CalendarItemOut;
}

/** Read one item's stored relations straight from the API. */
async function relationTargets(page: Page, itemId: string): Promise<readonly string[]> {
  const response = await page.request.get(`${API_ORIGIN}/v1/me/calendar/items/${itemId}/relations`);
  expect(response.ok(), `relations for ${itemId}: ${String(response.status())}`).toBe(true);
  const body = (await response.json()) as { items: readonly { targetItemId: string }[] };
  return body.items.map((relation) => relation.targetItemId);
}

test('drags an event onto a time block and the association survives a reload', async ({ page }) => {
  await page.clock.setFixedTime(`${ANCHOR_DATE}T17:00:00.000Z`);
  await signUpAndOnboard(page, 'EventIntoBlock');

  const block = await createItem(page, {
    intent: 'timebox',
    title: 'Launch window',
    startsAt: at(10),
    endsAt: at(12),
  });
  const event = await createItem(page, {
    intent: 'event',
    title: 'Research review',
    startsAt: at(13),
    endsAt: at(14),
  });

  // Nothing is associated yet — the assertion below has to be able to fail.
  expect(await relationTargets(page, block.id)).toEqual([]);

  await page.goto(`/calendar?date=${ANCHOR_DATE}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('region', { name: 'Schedule' })).toBeVisible();
  await expect(scheduleItem(page, block.id).card).toBeVisible();
  await expect(scheduleItem(page, event.id).card).toBeVisible();

  const main = page.locator('main#main-content');
  const eventDrag = main.getByRole('button', { name: `Create relationship from ${event.title}` });
  await expect(eventDrag).toBeVisible();

  await dragLocatorToLocator(page, eventDrag, scheduleItem(page, block.id).card);

  // 1. The server stored the relationship before the UI reads it back.
  await expect
    .poll(async () => relationTargets(page, block.id), { timeout: 15_000 })
    .toEqual([event.id]);

  // 2. The UI reflects the stored relationship when the block opens.
  await scheduleItem(page, block.id).body.click();
  const drawer = page.getByRole('dialog');
  await expect(drawer.getByText(event.title)).toBeVisible();

  // 3. It survives a cold reload — nothing here is optimistic cache state.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('region', { name: 'Schedule' })).toBeVisible();
  await scheduleItem(page, block.id).body.click();
  await expect(page.getByRole('dialog').getByText(event.title)).toBeVisible();
});
