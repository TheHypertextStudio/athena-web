import type {
  WorkTemplateCopyBundle,
  WorkTemplateCopyReceipt,
  WorkTemplateGalleryPreview,
} from '@docket/work/template-gallery-contract';
import type { Locator } from '@playwright/test';
import { expect, test } from './helpers/fixtures';
import { apiJson, waitForApiResponse } from './helpers/net';
import { blueprintWorkspace } from './helpers/work-template-blueprints';
import { TIMEOUTS } from './helpers/constants';
import { hasVisibleKeyboardFocus, renderedContrastRatio } from './helpers/calendar-ui';

const session = process.env['E2E_WORK_TEMPLATE_SESSION'];
if (session) test.use({ storageState: session });

/** Keep wrapped choice labels inside their real touch target and clear of the following choice. */
async function assertChoiceContainment(choice: Locator, next?: Locator): Promise<void> {
  await choice.scrollIntoViewIfNeeded();
  const target = await choice.boundingBox();
  if (!target) throw new Error('The starting-point touch target is unavailable.');
  expect(Math.min(target.width, target.height)).toBeGreaterThanOrEqual(40);
  for (const label of await choice.locator('span').all()) {
    const text = await label.boundingBox();
    if (!text) throw new Error('The starting-point label is unavailable.');
    expect(text.y).toBeGreaterThanOrEqual(target.y - 1);
    expect(text.y + text.height).toBeLessThanOrEqual(target.y + target.height + 1);
  }
  if (next) expect((await next.boundingBox())?.y).toBeGreaterThanOrEqual(target.y + target.height);
}

test('keeps a reviewed Event privately, restores its outcome on reload, then undoes the actual copy', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  const { orgId } = await blueprintWorkspace(page);
  const base = `/orgs/${orgId}/work-templates`;
  await page.goto(`${base}/gallery`, { waitUntil: 'commit', timeout: TIMEOUTS.pageReady });
  const nonprofit = page.getByRole('button', { name: /^Nonprofits/ });
  await nonprofit.focus();
  await nonprofit.press('Enter');
  const event = page.getByRole('link', { name: 'Event', exact: true });
  await event.focus();
  await event.press('Enter');
  await expect(page.getByRole('heading', { name: 'Event', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Select this template', exact: true }).click();
  await page.getByRole('button', { name: 'Back to gallery', exact: true }).click();
  const selected = page.getByRole('checkbox', { name: 'Select Event', exact: true });
  await expect(selected).toBeChecked();
  await selected.focus();
  await selected.press('Space');
  await expect(selected).not.toBeChecked();
  await expect(selected).toBeFocused();
  await selected.press('Space');
  await expect(selected).toBeChecked();
  await page.getByRole('button', { name: 'Review selection', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Review selected templates', exact: true }),
  ).toBeVisible();
  const inspect = page.getByRole('button', { name: 'Inspect Event', exact: true });
  expect(await hasVisibleKeyboardFocus(page, inspect)).toBe(true);
  await inspect.press('Enter');
  await expect(page.getByRole('list', { name: 'Included work', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Book venue', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back to review', exact: true }).press('Enter');
  await expect(inspect).toBeFocused();
  const keep = page.getByRole('button', { name: 'Keep private drafts', exact: true });
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 320, height: 600 });
    expect(await hasVisibleKeyboardFocus(page, keep)).toBe(true);
    expect(await renderedContrastRatio(keep)).toBeGreaterThanOrEqual(4.5);
    const bounds = await keep.boundingBox();
    expect(Math.min(bounds?.width ?? 0, bounds?.height ?? 0)).toBeGreaterThanOrEqual(40);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  const saved = waitForApiResponse(page, /\/gallery\/copies\/?$/, { method: 'POST' });
  await keep.press('Enter');
  const response = await saved;
  expect(response.ok()).toBe(true);
  const receipt = (await response.json()) as WorkTemplateCopyReceipt;
  expect(receipt.roots).toHaveLength(1);
  expect(receipt.roots[0]?.workTypeVersionId).toBeNull();
  await expect(
    page.getByRole('heading', { name: 'Private drafts kept', exact: true }),
  ).toBeVisible();
  await page.reload({ waitUntil: 'commit' });
  await expect(
    page.getByRole('heading', { name: 'Private drafts kept', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Open drafts', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/gallery/copies/${receipt.bundleId}$`));
  await expect(
    page.getByRole('link', { name: 'Review Vendor booking', exact: true }),
  ).toBeVisible();
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 320, height: 600 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await expect(page.getByRole('button', { name: 'Undo this copy', exact: true })).toBeVisible();
  }
  const reversed = waitForApiResponse(page, /\/gallery\/copies\/[^/]+\/undo$/, { method: 'POST' });
  await page.getByRole('button', { name: 'Undo this copy', exact: true }).click();
  expect((await reversed).ok()).toBe(true);
  await expect(
    page.getByRole('heading', { name: 'This copy was undone', exact: true }),
  ).toBeVisible();
  await page.reload({ waitUntil: 'commit' });
  await expect(
    page.getByRole('heading', { name: 'This copy was undone', exact: true }),
  ).toBeVisible();
  const actual = await apiJson<WorkTemplateCopyBundle>(
    page,
    `/v1/orgs/${orgId}/templates/definitions/gallery/copies/${receipt.bundleId}`,
  );
  expect(actual.receipt.state).toBe('undone');
  expect(actual.entries.every((entry) => entry.template === null)).toBe(true);
  expect(pageErrors).toEqual([]);
});

test('reviews all sixty startup roots without truncating selection or mounting sixty outlines', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  const { orgId } = await blueprintWorkspace(page);
  const base = `/orgs/${orgId}/work-templates`;
  await page.goto(`${base}/gallery`, { waitUntil: 'commit', timeout: TIMEOUTS.pageReady });
  await page.getByRole('button', { name: /^Startups/ }).click();
  await page.getByRole('button', { name: 'All startup work (60)', exact: true }).click();
  const prepared = waitForApiResponse(page, /\/gallery\/copy-preview$/, { method: 'POST' });
  await page.getByRole('button', { name: 'Review selection', exact: true }).click();
  const response = await prepared;
  expect(response.ok()).toBe(true);
  const review = (await response.json()) as WorkTemplateGalleryPreview;
  expect(review.roots).toHaveLength(60);
  expect(new Set(review.roots.map((root) => root.workTypeId)).size).toBe(60);
  expect(review.copies.length).toBeGreaterThanOrEqual(60);
  await expect(
    page.getByRole('heading', { name: 'Review selected templates', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Keep private drafts', exact: true }),
  ).toBeEnabled();
  await expect(page.getByRole('list', { name: 'Included work', exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 320, height: 600 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(pageErrors).toEqual([]);
});

test.describe('touch starting-point choices', () => {
  test.use({ hasTouch: true });

  test('keeps every starting-point label inside its touch target at 320px in both themes', async ({
    page,
  }) => {
    const { orgId } = await blueprintWorkspace(page);
    await page.goto(`/orgs/${orgId}/work-templates/gallery`, {
      waitUntil: 'commit',
      timeout: TIMEOUTS.pageReady,
    });
    await page.setViewportSize({ width: 320, height: 600 });
    const choices = page.getByRole('button', {
      name: /^(Startups|Nonprofits|Agencies|Personal work)/,
    });
    await expect(choices).toHaveCount(4);
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
      for (let index = 0; index < 4; index++) {
        await assertChoiceContainment(
          choices.nth(index),
          index < 3 ? choices.nth(index + 1) : undefined,
        );
      }
    }
  });
});
