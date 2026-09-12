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
import type { Page } from '@playwright/test';

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

  const before = await mastheadGeometry(page);

  releaseAggregate();
  await expect(page.getByRole('status', { name: /detail$/ })).toBeHidden({
    timeout: TIMEOUTS.ui,
  });

  // Nothing in the masthead moves or resizes when the aggregate lands. Each number below was
  // wrong at some point for its own reason, so each is asserted rather than inferred from the
  // one beneath it:
  //
  // - `title`/`subtitle` are the slots, not the fields. Both fields were always exactly their type
  //   token's line box; the slots were taller because a `<textarea>` is `inline-block`, so the
  //   slot reserved descender space under it — 8px at the title, 6px at the summary.
  // - `row` is the property row's height, the invariant `SkeletonChip` documents: a placeholder
  //   pill is the control step a property trigger resolves to.
  // - `rowY` is what a reader actually notices. It is the sum of everything above it, and it is
  //   the one that stayed wrong each time a single slot was fixed on its own.
  expect(await mastheadGeometry(page)).toEqual(before);
});

/** The masthead measurements that must survive the aggregate landing. */
interface MastheadGeometry {
  readonly title: number;
  readonly subtitle: number;
  readonly row: number;
  readonly rowY: number;
}

/**
 * Measure the masthead's slot heights and the property row's position.
 *
 * @param page - The page showing an Initiative, loading or loaded.
 * @returns The {@link MastheadGeometry}, rounded so sub-pixel text metrics do not make it flaky.
 */
async function mastheadGeometry(page: Page): Promise<MastheadGeometry> {
  const heightOf = async (selector: string): Promise<number> =>
    Math.round((await page.locator(selector).first().boundingBox())?.height ?? -1);
  const row = page.locator('.entity-metadata-row').first();
  return {
    title: await heightOf('.detail-title'),
    subtitle: await heightOf('.detail-secondary .text-body-large'),
    row: Math.round((await row.boundingBox())?.height ?? -1),
    rowY: Math.round((await row.boundingBox())?.y ?? -1),
  };
}
