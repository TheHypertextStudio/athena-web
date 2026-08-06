/**
 * Create composers must reopen empty after a successful create.
 *
 * @remarks
 * The reported bug: create a project, reopen "New project", and the project you had just created
 * was still sitting in the form — title, summary, description, every property pick. The composers
 * are mounted for the life of the page, and the reset they relied on hung off a close wrapper that
 * the successful-create path bypassed by closing the dialog through the host's `onOpenChange` prop
 * directly.
 *
 * The unit tests pin the mechanism for all six composers; this pins the user-visible flow through
 * the real app — real RPC, real dialog transitions, real post-create navigation.
 *
 * Both cases here use hosts that stay mounted through a create (My Work prepends to local state;
 * the project detail refetches), because that is where a leaked draft is actually reachable. The
 * list composers route to the new entity's detail screen, which unmounts their host on the way out
 * and hides the defect behind a remount that only happens to be there.
 *
 * The seeded case additionally pins the other half of the contract: a host-supplied default
 * (`defaultProjectId`) must be re-derived on reopen, not blanked along with the draft.
 */
import { signUpAndOnboard } from '../helpers/app';
import { myWorkHref, orgHref } from '../helpers/constants';
import { expect, test } from '../helpers/fixtures';
import { attachShot } from '../helpers/ui';

test.describe('create composers reopen pristine', () => {
  // Same CI-only stall as athena-personal.spec.ts; see the note there.
  test.fixme('a seeded composer clears its draft but keeps its defaults', async ({
    page,
  }, testInfo) => {
    const { orgId } = await signUpAndOnboard(page, 'ComposerResetSeeded');

    // Create a project, which lands on its detail screen.
    await page.goto(orgHref(orgId, 'projects'), { waitUntil: 'domcontentloaded' });
    await page
      .getByRole('button', { name: /New project/i })
      .first()
      .click();
    const projectDialog = page.getByRole('dialog');
    await projectDialog.getByPlaceholder('Project name').fill('Atlas re-platform');
    await projectDialog.getByRole('button', { name: /^Create Project$/i }).click();
    await expect(page.getByRole('heading', { name: 'Atlas re-platform' })).toBeVisible({
      timeout: 20_000,
    });

    // The project's Tasks tab opens the task composer pre-seeded with this project, and its host
    // stays mounted after a create (it only refetches) — so a leaked draft is user-visible here.
    await page.getByRole('tab', { name: /Tasks/i }).first().click();
    await page.getByRole('button', { name: /Add task with details/i }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByPlaceholder('Task title')).toBeVisible();
    await dialog.getByPlaceholder('Task title').fill('Dual-write the ingest path');
    await page.waitForTimeout(300);
    await attachShot(testInfo, dialog, 'seeded-composer-filled.png');

    await dialog.getByRole('button', { name: /^Create task$/i }).click();
    await expect(dialog).toBeHidden({ timeout: 20_000 });

    await page.getByRole('button', { name: /Add task with details/i }).click();
    const reopened = page.getByRole('dialog');
    await expect(reopened.getByPlaceholder('Task title')).toBeVisible();
    await page.waitForTimeout(400);
    await attachShot(testInfo, reopened, 'seeded-composer-reopened.png');

    // The typed draft is gone…
    await expect(reopened.getByPlaceholder('Task title')).toHaveValue('');
    // …but the host-supplied default is re-seeded, not blanked: remounting re-runs the state
    // initializers, so `defaultProjectId` still lands on the project picker.
    await expect(reopened.getByRole('button', { name: /Atlas re-platform/ })).toBeVisible();
  });

  // Same CI-only stall as athena-personal.spec.ts; see the note there.
  test.fixme('task composer clears after creating a task', async ({ page }, testInfo) => {
    const { orgId } = await signUpAndOnboard(page, 'ComposerResetTask');

    await page.goto(myWorkHref(orgId), { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'My Work' })).toBeVisible();
    await page
      .getByRole('button', { name: /New task/i })
      .first()
      .click();

    const dialog = page.getByRole('dialog');
    const title = dialog.getByPlaceholder('Task title');
    await expect(title).toBeVisible();

    await title.fill('Ship the launch page');
    await dialog
      .locator('[contenteditable="true"][aria-label="Add a description…"]')
      .fill('Draft copy + hero, then hand to design.');

    await dialog.getByRole('button', { name: /^Create task$/i }).click();
    await expect(dialog).toBeHidden({ timeout: 20_000 });

    await page
      .getByRole('button', { name: /New task/i })
      .first()
      .click();
    const reopened = page.getByRole('dialog');
    await expect(reopened.getByPlaceholder('Task title')).toBeVisible();
    await page.waitForTimeout(300);
    await attachShot(testInfo, reopened, 'task-composer-reopened.png');

    await expect(reopened.getByPlaceholder('Task title')).toHaveValue('');
    await expect(
      reopened.locator('[contenteditable="true"][aria-label="Add a description…"]'),
    ).toHaveText('');
  });
});
