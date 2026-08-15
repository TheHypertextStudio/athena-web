/**
 * Visual evidence for workspace-defined statuses.
 *
 * @remarks
 * Drives the real surface through every state it has — the four sets at rest, the editor, the
 * category move, delete-with-remap, a status that cannot be deleted, and the keyboard reorder —
 * at two widths and in both themes. Asserts only enough to prove each state was actually reached
 * before the shutter, which is what makes the archive worth looking at.
 */
import type { Page } from '@playwright/test';

import { signUpAndOnboard } from '../helpers/app';
import { settingsHref, TIMEOUTS } from '../helpers/constants';
import { expect, test } from '../helpers/fixtures';
import { setColorScheme } from '../helpers/ui';

const SHOT_DIR = new URL(
  '../../../../docs/design/audits/screenshots/2026-08-14-statuses/',
  import.meta.url,
).pathname;

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
] as const;

/** Capture the visible application frame into the durable design-audit archive. */
async function shot(page: Page, name: string): Promise<void> {
  // Dialogs fade and zoom in; shooting mid-animation captures the page bleeding through a
  // half-opaque surface, which reads as a rendering bug rather than the state under review.
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOT_DIR}${name}`, fullPage: true });
}

/** Open Settings → Statuses and wait for the sets to render. */
async function openStatuses(page: Page, orgId: string): Promise<void> {
  await page.goto(settingsHref(orgId, 'statuses'), { waitUntil: 'domcontentloaded' });
  // A seeded task status on screen means the sets resolved and the page is past its skeleton.
  await expect(page.locator('[data-status-key="in_progress"]').first()).toBeVisible({
    timeout: TIMEOUTS.pageReady,
  });
}

/**
 * The editor or confirm dialog, addressed by name.
 *
 * @remarks
 * Settings itself renders as a `role="dialog"`, so an unnamed dialog query is ambiguous by
 * construction here.
 */
function namedDialog(page: Page, name: RegExp) {
  return page.getByRole('dialog', { name });
}

/** The row for one status key, within the section that holds it. */
function statusRow(page: Page, key: string) {
  return page.locator(`[data-status-key="${key}"]`).first();
}

for (const viewport of VIEWPORTS) {
  test(`workspace statuses at rest, both themes (${viewport.name})`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const { orgId } = await signUpAndOnboard(page, `StatusRest${viewport.name}`);
    await openStatuses(page, orgId);

    // The seeded Program set is the one that carries the product decision: a Program can complete
    // and can also be archived, and both are visible here.
    await expect(statusRow(page, 'archived')).toBeVisible();

    await setColorScheme(page, 'light');
    await shot(page, `statuses-${viewport.name}-light.png`);
    await setColorScheme(page, 'dark');
    await shot(page, `statuses-${viewport.name}-dark.png`);
  });
}

test('adding a status', async ({ page }) => {
  const { orgId } = await signUpAndOnboard(page, 'StatusAdd');
  await openStatuses(page, orgId);
  await setColorScheme(page, 'light');

  // The "Add status" under the In Progress group of the Task section.
  await page.getByRole('button', { name: 'Add status' }).first().click();
  const editor = namedDialog(page, /status$/i);
  await expect(editor).toBeVisible();
  await shot(page, 'statuses-editor-empty.png');

  await editor.getByRole('textbox').first().fill('In Review');
  await editor.getByRole('textbox').nth(1).fill('Waiting on a second pair of eyes.');
  await shot(page, 'statuses-editor-filled.png');

  await editor.getByRole('button', { name: 'Add status' }).click();
  await expect(editor).toBeHidden({ timeout: TIMEOUTS.ui });
  await expect(statusRow(page, 'in_review')).toBeVisible({ timeout: TIMEOUTS.pageReady });
  await shot(page, 'statuses-after-add.png');
});

test('moving a status to another category warns about the work in it', async ({ page }) => {
  const { orgId } = await signUpAndOnboard(page, 'StatusRecat');
  await openStatuses(page, orgId);
  await setColorScheme(page, 'light');

  await statusRow(page, 'todo').hover();
  await statusRow(page, 'todo')
    .getByRole('button', { name: /^Actions for/ })
    .click();
  await page.getByRole('menuitem', { name: 'Edit' }).click();
  const editor = namedDialog(page, /^Edit status$/i);
  await expect(editor).toBeVisible();

  // Choosing a terminal category is the case worth showing: it records completion on work that
  // is already sitting in the status.
  // The radio itself is screen-reader-only; a person clicks its label, so the spec does too.
  await editor.locator('label:has(input[value="completed"])').click();
  await expect(editor.getByRole('status')).toBeVisible();
  await shot(page, 'statuses-editor-category-warning.png');
});

test('deleting a status names where its work goes', async ({ page }) => {
  const { orgId } = await signUpAndOnboard(page, 'StatusDelete');
  await openStatuses(page, orgId);
  await setColorScheme(page, 'light');

  await statusRow(page, 'todo').hover();
  await statusRow(page, 'todo')
    .getByRole('button', { name: /^Actions for/ })
    .click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  const confirm = namedDialog(page, /^Delete /i);
  await expect(confirm).toBeVisible();
  await shot(page, 'statuses-delete-remap.png');

  await confirm.getByRole('button', { name: 'Delete status' }).click();
  await expect(confirm).toBeHidden({ timeout: TIMEOUTS.ui });
  await expect(statusRow(page, 'todo')).toBeHidden({ timeout: TIMEOUTS.pageReady });
  await shot(page, 'statuses-after-delete.png');
});

test('a status the set cannot lose says so', async ({ page }) => {
  const { orgId } = await signUpAndOnboard(page, 'StatusBlocked');
  await openStatuses(page, orgId);
  await setColorScheme(page, 'light');

  // `done` is the Task set's only way to finish work, so deleting it is unavailable.
  await statusRow(page, 'done').hover();
  await statusRow(page, 'done')
    .getByRole('button', { name: /^Actions for/ })
    .click();
  await expect(page.getByRole('menuitem', { name: 'Delete' })).toBeDisabled();
  await shot(page, 'statuses-delete-blocked.png');
});

test('reordering within a category from the keyboard', async ({ page }) => {
  const { orgId } = await signUpAndOnboard(page, 'StatusReorder');
  await openStatuses(page, orgId);
  await setColorScheme(page, 'light');

  // A second status in the first category, so that group has something to reorder.
  await page.getByRole('button', { name: 'Add status' }).first().click();
  const editor = namedDialog(page, /status$/i);
  await editor.getByRole('textbox').first().fill('In Review');
  await editor.getByRole('button', { name: 'Add status' }).click();
  await expect(statusRow(page, 'in_review')).toBeVisible({ timeout: TIMEOUTS.pageReady });

  const grip = statusRow(page, 'in_review').getByRole('button', { name: /Reorder|move|drag/i });
  await grip.focus();
  await page.keyboard.press('Space');
  await expect(grip).toHaveAttribute('aria-pressed', 'true');
  await shot(page, 'statuses-reorder-grabbed.png');

  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Space');
  await expect(grip).toHaveAttribute('aria-pressed', 'false');
  await shot(page, 'statuses-reorder-committed.png');
});

test('the narrow-width squeeze belongs to the settings shell, not this page', async ({ page }) => {
  // A control. The Statuses page is cramped at 390px; so is every other settings page, because the
  // shell keeps its section nav beside the content at that width. Shooting a page this work did
  // not touch is what separates "our layout is wrong" from "the shell's is".
  await page.setViewportSize({ width: 390, height: 844 });
  const { orgId } = await signUpAndOnboard(page, 'StatusControl');
  await page.goto(settingsHref(orgId, 'labels'), { waitUntil: 'domcontentloaded' });
  // The nav row is the stable landmark; the page body varies with whether the workspace has any
  // labels yet, and this shot is about the frame rather than the content.
  await expect(page.getByRole('link', { name: 'Labels' }).first()).toBeVisible({
    timeout: TIMEOUTS.pageReady,
  });
  await page.waitForLoadState('networkidle');
  await setColorScheme(page, 'light');
  await shot(page, 'control-labels-mobile-light.png');
});

test('a team can keep its own task statuses', async ({ page }) => {
  const { orgId } = await signUpAndOnboard(page, 'StatusFork');
  await openStatuses(page, orgId);
  await setColorScheme(page, 'light');

  // A workspace with one team has nothing to fork away from, so the selector is absent. That is
  // itself a state worth recording.
  await expect(page.getByRole('button', { name: 'Workspace default' })).toHaveCount(0);
  await shot(page, 'statuses-single-team-no-scope.png');
});
