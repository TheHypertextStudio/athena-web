/** A personal work-location journey through arbitrary places, planning, and one occurrence. */
import { signUpAndOnboard } from '../helpers/app';
import { TIMEOUTS } from '../helpers/constants';
import { expect, test } from '../helpers/fixtures';

test('a person can plan across multiple regular places with home kept separate', async ({
  page,
}) => {
  await signUpAndOnboard(page, 'WorkLocations');
  await page.goto('/settings/work-locations', { waitUntil: 'domcontentloaded' });

  await expect(page.getByRole('heading', { name: 'Work locations' })).toBeVisible({
    timeout: TIMEOUTS.pageReady,
  });
  const regularPlaces = page.getByRole('region', { name: 'Regular places' });
  const savedPlaceNames = regularPlaces.getByRole('textbox', { name: 'Name', exact: true });
  const placeName = regularPlaces.getByLabel('Place name');
  await placeName.fill('Main library');
  await regularPlaces.getByRole('button', { name: 'Add place' }).click();
  await expect(savedPlaceNames).toHaveCount(1);
  await expect(savedPlaceNames.first()).toHaveValue('Main library');
  await placeName.fill('Ceramics studio');
  await regularPlaces.getByRole('button', { name: 'Add place' }).click();
  await expect(savedPlaceNames).toHaveCount(2);
  await expect(savedPlaceNames.last()).toHaveValue('Ceramics studio');

  // The first arbitrary place becomes home by designation, not by changing its place type.
  await regularPlaces.getByRole('button', { name: 'Designate home' }).first().click();
  await expect(regularPlaces.getByRole('button', { name: 'Clear home' })).toBeVisible();
  await regularPlaces.getByRole('button', { name: 'I’m here now' }).first().click();
  await expect(page.getByRole('alert')).toHaveCount(0);

  await page
    .getByRole('combobox', { name: 'Place', exact: true })
    .selectOption({ label: 'Ceramics studio' });
  await page.getByRole('combobox', { name: 'Schedule' }).selectOption('weekly_all_day');
  await page.getByRole('button', { name: /Effective from/ }).click();
  await page.getByRole('button', { name: '2026-08-17' }).click();
  await page.getByRole('button', { name: 'Add expected location' }).click();

  const series = page.locator('article').filter({ hasText: 'Ceramics studio' });
  await expect(series).toBeVisible();
  await series.getByRole('button', { name: /One occurrence/ }).click();
  await page.getByRole('button', { name: '2026-08-24' }).click();
  await series.getByRole('button', { name: 'Cancel occurrence' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(savedPlaceNames).toHaveCount(2, { timeout: TIMEOUTS.pageReady });
  await expect(savedPlaceNames.first()).toHaveValue('Main library');
  await expect(savedPlaceNames.last()).toHaveValue('Ceramics studio');
  await expect(regularPlaces.getByRole('button', { name: 'Clear home' })).toBeVisible();
  await expect(page.locator('article').filter({ hasText: 'Ceramics studio' })).toBeVisible();
});
