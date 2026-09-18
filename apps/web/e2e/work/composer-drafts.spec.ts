/**
 * A composer draft survives closing the composer and comes back from the chip, the Drafts page,
 * and, with the preference on, a fresh open.
 *
 * @remarks
 * The journey Linear's docs describe: type, close, "Save draft"; find it again from the composer
 * and from the sidebar; turn on resuming and see it pre-filled; discard it and watch the entry go.
 * Every step goes through the real composer against the real API.
 */
import type { Page } from '@playwright/test';

import { signUpAndOnboard } from '../helpers/app';
import { myWorkHref, TIMEOUTS } from '../helpers/constants';
import { expect, test } from '../helpers/fixtures';

const DRAFT_TITLE = 'Draft the grant report';

/** Open the task composer from the current page and wait for its title field. */
async function openNewTask(page: Page): Promise<void> {
  const dialog = page.getByRole('dialog');
  const newTaskButton = page.getByRole('button', { name: 'New task' }).first();
  await expect(async () => {
    await newTaskButton.click();
    await expect(dialog.getByPlaceholder('Task title')).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: TIMEOUTS.pageReady });
}

test.use({ serviceWorkers: 'block' });

test.describe('composer drafts', () => {
  test('a closed composer keeps its draft and offers it back', async ({ page }) => {
    const { orgId } = await signUpAndOnboard(page, 'ComposerDrafts');
    await page.goto(myWorkHref(orgId), { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'My Work' })).toBeVisible();

    // Type, close, save.
    await openNewTask(page);
    const dialog = page.getByRole('dialog');
    await dialog.getByPlaceholder('Task title').fill(DRAFT_TITLE);
    await page.keyboard.press('Escape');
    const save = dialog.getByRole('button', { name: 'Save draft' });
    await expect(save).toBeVisible();
    await expect(save).toBeFocused();
    await save.click();
    await expect(dialog).toBeHidden();

    // The sidebar now lists Drafts, with the count.
    const navigation = page.getByRole('navigation', { name: 'Home' });
    await expect(navigation.getByRole('link', { name: /^Drafts, 1/ })).toBeVisible({
      timeout: TIMEOUTS.pageReady,
    });

    // The composer opens empty (the preference is off) but the chip has the draft.
    await openNewTask(page);
    await expect(dialog.getByPlaceholder('Task title')).toHaveValue('');
    await dialog.getByRole('button', { name: /^Drafts, 1/ }).click();
    const list = page.getByRole('list', { name: 'Saved drafts' });
    await list.getByRole('button', { name: new RegExp(`^${DRAFT_TITLE}`) }).click();
    await expect(dialog.getByPlaceholder('Task title')).toHaveValue(DRAFT_TITLE);
    await page.keyboard.press('Escape');
    await dialog.getByRole('button', { name: 'Save draft' }).click();
    await expect(dialog).toBeHidden();

    // The Drafts page opens it too.
    await navigation.getByRole('link', { name: /^Drafts, 1/ }).click();
    await expect(page.getByRole('heading', { name: 'Drafts' })).toBeVisible();
    await page.getByRole('row', { name: new RegExp(DRAFT_TITLE) }).click();
    await expect(dialog.getByPlaceholder('Task title')).toHaveValue(DRAFT_TITLE);
    await page.keyboard.press('Escape');
    await dialog.getByRole('button', { name: 'Save draft' }).click();
    await expect(dialog).toBeHidden();

    // With the preference on, a fresh open resumes it.
    await page.goto('/settings/profile', { waitUntil: 'domcontentloaded' });
    const resume = page.getByRole('switch', { name: /Resume drafts/ });
    await expect(resume).toBeVisible({ timeout: TIMEOUTS.pageReady });
    await resume.click();
    await expect(resume).toHaveAttribute('aria-checked', 'true');
    await page.goto(myWorkHref(orgId), { waitUntil: 'domcontentloaded' });
    await openNewTask(page);
    await expect(dialog.getByPlaceholder('Task title')).toHaveValue(DRAFT_TITLE, {
      timeout: TIMEOUTS.pageReady,
    });

    // Discard removes the draft and the sidebar entry.
    await page.keyboard.press('Escape');
    await dialog.getByRole('button', { name: 'Discard' }).click();
    await expect(dialog).toBeHidden();
    await expect(navigation.getByRole('link', { name: /^Drafts/ })).toBeHidden({
      timeout: TIMEOUTS.pageReady,
    });
  });
});
