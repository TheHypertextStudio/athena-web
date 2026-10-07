/** Proportional short blocks remain distinct in planning and the accepted Today agenda. */
import { instantAt, localMinuteOfDay } from '@docket/planning/zoned-time';
import { openPlan, reviewPlan, saveDraft, setupPlan, snapshot } from '../helpers/daily-planning';
import { expect, test } from '../helpers/fixtures';
import { captureShortBlockEvidence } from '../helpers/daily-planning';

test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });
test('five-minute adjacent blocks keep exact geometry before and after acceptance', async ({
  page,
}, testInfo) => {
  const context = await setupPlan(page, 'daily-short-geometry', [
    'Five-minute check',
    'Adjacent five-minute check',
  ]);
  const start = Math.ceil(localMinuteOfDay(new Date(), context.timezone)) + 10;
  const sessions = context.taskIds.map((taskId, index) => ({
    id: `short-${index}`,
    pinned: true,
    startsAt: instantAt(context.date, start + index * 5, context.timezone).toISOString(),
    endsAt: instantAt(context.date, start + (index + 1) * 5, context.timezone).toISOString(),
    allocations: [{ taskId, plannedMinutes: 5 }],
  }));
  await saveDraft(page, snapshot(context, [5, 5], sessions));
  await openPlan(page, context.date);
  const first = page.locator('[data-schedule-item="short-0"]');
  const second = page.locator('[data-schedule-item="short-1"]');
  await expect(first).toHaveCSS('height', '7px');
  await expect(second).toHaveCSS('height', '7px');
  await expect(first).toHaveAttribute('data-layout-column-count', '1');
  await expect(second).toHaveAttribute('data-layout-column-count', '1');
  const firstTop = await first.evaluate((element) =>
    Number.parseFloat((element as HTMLElement).style.top),
  );
  const secondTop = await second.evaluate((element) =>
    Number.parseFloat((element as HTMLElement).style.top),
  );
  expect(secondTop - firstTop).toBe(7);
  await captureShortBlockEvidence(page, testInfo, 'plan', 'short-0', '7px');
  await reviewPlan(page);
  await captureShortBlockEvidence(page, testInfo, 'review', 'short-0', '7px');
  await page.getByRole('button', { name: 'Confirm plan', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your plan is set' })).toBeVisible();
  await page.goto('/today', { waitUntil: 'domcontentloaded' });
  await captureShortBlockEvidence(page, testInfo, 'today', `${context.taskIds[0]}:short-0`, '4px');
});
