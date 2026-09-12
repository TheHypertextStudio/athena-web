/**
 * Browser proof that a detail page opened from a list states what it already knows.
 *
 * @remarks
 * Clicking a list row seeds a navigation snapshot carrying the entity's name, status, priority and
 * health, and the detail page paints before its aggregate arrives. That masthead used to print the
 * stored keys — `proposed · medium` — in a bare span, and supplying it deleted every placeholder in
 * the property row, so a reader saw one line of lowercase identifiers beside a column of grey bars.
 *
 * A unit test can assert the row's shape, but only a browser can prove the seam: that the snapshot
 * actually reaches the page on a real click, and that the chips it paints survive the aggregate
 * landing without the masthead moving.
 */
import { signUpAndOnboard } from '../helpers/app';
import { createMobileAuditFixture } from '../helpers/mobile-audit-fixture';
import { orgHref, TIMEOUTS } from '../helpers/constants';
import { expect, test } from '../helpers/fixtures';
import { apiJson } from '../helpers/net';

// The snapshot path is a live-application behaviour; a cached offline shell would prove nothing.
test.use({ serviceWorkers: 'block' });

test('an Initiative opened from its list states its properties while the rest loads', async ({
  page,
}) => {
  await signUpAndOnboard(page, 'detail-loading-masthead');
  const fixture = await createMobileAuditFixture(page);

  // Pin all three snapshot properties, so the masthead's values are the ones asserted below and
  // `proposed` is genuinely the stored key whose leaking this guards against.
  await apiJson(page, `/v1/orgs/${fixture.orgId}/initiatives/${fixture.initiativeId}`, {
    method: 'PATCH',
    body: { status: 'proposed', priority: 'medium', health: 'on_track' },
  });

  // Hold the detail aggregate open so the loading masthead is observable rather than a flash.
  let releaseAggregate: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    releaseAggregate = resolve;
  });
  await page.route('**/initiatives/*/aggregate-detail*', async (route) => {
    await held;
    await route.continue();
  });

  await page.goto(orgHref(fixture.orgId, 'initiatives'));
  const row = page.getByRole('link', { name: /Mobile audit initiative/ }).first();
  await row.click();

  const busy = page.getByRole('status', { name: /detail$/ });
  await expect(busy).toBeVisible({ timeout: TIMEOUTS.ui });

  // The name is known, so it is shown rather than placeheld.
  await expect(busy.getByRole('heading', { level: 1 })).toContainText('Mobile audit initiative');

  // Each known property is stated as its own chip, resolved rather than printed as its key.
  await expect(busy.locator('[aria-label^="Status"]')).toContainText('Proposed');
  await expect(busy.locator('[aria-label^="Priority"]')).toContainText('Medium');
  await expect(busy.locator('[aria-label^="Initiative health"]')).toContainText('On track');

  // The regression itself: no stored key reaches the reader.
  await expect(busy).not.toContainText('proposed');
  await expect(busy).not.toContainText('on_track');

  // Properties still being read keep their slots, so the row does not claim to be complete.
  const pending = busy.locator('[data-entity-metadata-item] [data-slot="skeleton"]');
  expect(await pending.count()).toBeGreaterThan(0);

  const titleBefore = await busy.getByRole('heading', { level: 1 }).boundingBox();
  const rowBefore = await busy.locator('.entity-metadata-row').boundingBox();

  releaseAggregate();
  await expect(page.getByRole('status', { name: /detail$/ })).toBeHidden({
    timeout: TIMEOUTS.ui,
  });

  // The title is anchored: its glyph is the real one and its own line box never changed.
  const titleAfter = await page.getByRole('heading', { level: 1 }).first().boundingBox();
  expect(titleAfter?.y).toBeCloseTo(titleBefore?.y ?? 0, 0);

  // And the property row is the height it always was, which is the invariant `SkeletonChip`
  // documents: a placeholder pill is the control step a property trigger resolves to.
  const rowAfter = await page.locator('.entity-metadata-row').first().boundingBox();
  expect(rowAfter?.height).toBeCloseTo(rowBefore?.height ?? 0, 0);
});
