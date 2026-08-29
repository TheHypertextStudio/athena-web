import { signUpAndOnboard } from '../helpers/app';
import { orgHref, TIMEOUTS } from '../helpers/constants';
import { expect, test } from '../helpers/fixtures';
import {
  assertLocalAuditOrigins,
  createMobileAuditFixture,
  verifyMobileAuditFixture,
} from '../helpers/mobile-audit-fixture';

test('the mobile audit fixture rejects a non-local origin before it can create data', () => {
  expect(() => {
    assertLocalAuditOrigins({
      apiOrigin: 'https://api.docket.hypertext.studio',
      webOrigin: 'http://docket.localhost:4313',
    });
  }).toThrow(/local host/u);
});

test('the mobile audit fixture accepts loopback and localhost origins', () => {
  expect(() => {
    assertLocalAuditOrigins({
      apiOrigin: 'http://127.0.0.1:4413',
      webOrigin: 'http://docket.localhost:4313',
    });
  }).not.toThrow();
});

test('the mobile audit fixture creates every responsive-audit record through local APIs', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await signUpAndOnboard(page, 'MobileAuditFixture');
  const fixture = await createMobileAuditFixture(page);
  await verifyMobileAuditFixture(page, fixture);

  const response = await page.goto(orgHref(fixture.orgId, `projects/${fixture.projectId}`), {
    waitUntil: 'domcontentloaded',
  });
  expect(response?.ok(), 'the seeded project route should load').toBe(true);
  await expect(page.getByRole('main').first()).toBeVisible({ timeout: TIMEOUTS.pageReady });
});
