/** A personal work-location journey through arbitrary places, planning, and one occurrence. */
import { signUpAndOnboard } from '../helpers/app';
import { TIMEOUTS } from '../helpers/constants';
import { expect, test } from '../helpers/fixtures';

test('a person can plan across multiple regular places with home kept separate', async ({
  page,
}) => {
  await page.clock.setFixedTime('2026-08-10T17:00:00.000Z');
  await signUpAndOnboard(page, 'WorkLocations');
  await page.goto('/settings/work-locations', { waitUntil: 'domcontentloaded' });

  await expect(page.getByRole('heading', { name: 'Work locations' })).toBeVisible({
    timeout: TIMEOUTS.pageReady,
  });
  const savedPlaces = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Saved places' }) });
  await page.getByRole('button', { name: 'Add place' }).click();
  let placeDialog = page.getByRole('dialog', { name: 'Add place' });
  await placeDialog.getByRole('textbox', { name: 'Name' }).fill('Main library');
  await placeDialog.getByRole('textbox', { name: 'Address' }).fill('10 Library Lane');
  await placeDialog.getByRole('button', { name: 'Save place' }).click();
  await expect(placeDialog).not.toBeVisible();
  await expect(savedPlaces.getByText('Main library', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Add place' }).click();
  placeDialog = page.getByRole('dialog', { name: 'Add place' });
  await placeDialog.getByRole('textbox', { name: 'Name' }).fill('Ceramics studio');
  await placeDialog.getByRole('button', { name: 'Save place' }).click();
  await expect(placeDialog).not.toBeVisible();
  await expect(savedPlaces.getByText('Ceramics studio', { exact: true })).toBeVisible();

  // The first arbitrary place becomes home by designation, not by changing its place type.
  await savedPlaces.getByRole('button', { name: 'Actions for Main library' }).click();
  await page.getByRole('menuitem', { name: 'Make home' }).click();
  await expect(savedPlaces.getByText('Home', { exact: true })).toBeVisible();
  await savedPlaces.getByRole('button', { name: 'Set Main library as current location' }).click();
  await expect(savedPlaces.getByText('Current', { exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);

  await page.getByRole('button', { name: 'Add schedule' }).click();
  const scheduleDialog = page.getByRole('dialog', { name: 'Add schedule' });
  await scheduleDialog
    .getByRole('combobox', { name: 'Place', exact: true })
    .selectOption({ label: 'Ceramics studio' });
  await scheduleDialog.getByRole('combobox', { name: 'Schedule' }).selectOption('weekly_all_day');
  await scheduleDialog.getByRole('button', { name: /Effective from/ }).click();
  await page.getByRole('button', { name: '2026-08-17' }).click();
  await scheduleDialog.getByRole('button', { name: 'Save schedule' }).click();
  await expect(scheduleDialog).not.toBeVisible();

  const weekdaySchedule = page.getByText('Mon, Tue, Wed, Thu, Fri · All day', { exact: true });
  await expect(weekdaySchedule).toBeVisible();
  await page.getByRole('button', { name: 'Actions for Ceramics studio schedule' }).click();
  await page.getByRole('menuitem', { name: 'Change one occurrence' }).click();
  const occurrenceDialog = page.getByRole('dialog', { name: 'Change one occurrence' });
  await occurrenceDialog.getByRole('button', { name: /Occurrence date/ }).click();
  await page.getByRole('button', { name: '2026-08-24' }).click();
  await occurrenceDialog.getByRole('combobox', { name: 'Change' }).selectOption('cancel');
  await occurrenceDialog.getByRole('button', { name: 'Save occurrence' }).click();
  await expect(occurrenceDialog).not.toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(savedPlaces.getByText('Main library', { exact: true })).toBeVisible({
    timeout: TIMEOUTS.pageReady,
  });
  await expect(savedPlaces.getByText('Ceramics studio', { exact: true })).toBeVisible();
  await expect(savedPlaces.getByText('Home', { exact: true })).toBeVisible();
  await expect(weekdaySchedule).toBeVisible();
});
