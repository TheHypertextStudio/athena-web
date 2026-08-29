import { signUpAndOnboard } from '../helpers/app';
import { orgHref, TIMEOUTS } from '../helpers/constants';
import { expect, test } from '../helpers/fixtures';
import {
  createMobileAuditFixture,
  verifyMobileAuditFixture,
} from '../helpers/mobile-audit-fixture';

const FAILURE_COPY = /Couldn[’']t load this page|Page unavailable|Something went wrong/iu;

test('every seeded audit route opens a usable product surface', async ({ page }) => {
  test.setTimeout(300_000);
  await signUpAndOnboard(page, 'SeededRouteHappyPaths');
  const fixture = await createMobileAuditFixture(page);
  await verifyMobileAuditFixture(page, fixture);

  const routes = [
    ['Initiative', orgHref(fixture.orgId, `initiatives/${fixture.initiativeId}`)],
    ['Program', orgHref(fixture.orgId, `programs/${fixture.programId}`)],
    ['Project', orgHref(fixture.orgId, `projects/${fixture.projectId}`)],
    ['Cycle', orgHref(fixture.orgId, `cycles/${fixture.cycleId}`)],
    ['Task', orgHref(fixture.orgId, `tasks/${fixture.taskId}`)],
    ['Team', orgHref(fixture.orgId, `teams/${fixture.teamId}`)],
    ['Person', orgHref(fixture.orgId, `people/${fixture.personId}`)],
    ['Recurring task', orgHref(fixture.orgId, `recurrence-series/${fixture.recurrenceSeriesId}`)],
    ['Athena session', orgHref(fixture.orgId, `sessions/${fixture.agentSessionId}`)],
  ] as const;

  for (const [name, href] of routes) {
    const response = await page.goto(href, { waitUntil: 'domcontentloaded' });
    expect(response?.ok(), `${name} document should load`).toBe(true);
    const surface = page.locator('main, [role="dialog"]').first();
    await expect(surface, `${name} should render an app surface`).toBeVisible({
      timeout: TIMEOUTS.pageReady,
    });
    await expect(surface, `${name} should not render an app failure`).not.toContainText(
      FAILURE_COPY,
    );
  }
});
