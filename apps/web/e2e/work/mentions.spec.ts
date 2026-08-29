/**
 * The `@`-mention round trip, end to end.
 *
 * @remarks
 * The assertion that earns its keep is insert-then-reload. A mention is stored as an ordinary
 * Markdown link carrying a machine ref in the link-title slot, so it has to survive being
 * serialized to Markdown, written to a text column, parsed back by the editor's tokenizer, and
 * rendered as a node — and every one of those steps has a failure mode that types, lint, and the
 * unit suite are blind to.
 *
 * Escape is covered for the same reason: it was a real defect that only appeared against a real
 * Radix layer, which answers Escape from a capture-phase document listener and so closes the menu
 * before the field's own key handler ever runs.
 *
 * The file runs each sign-up against one shared PGlite writer, so Playwright keeps it on one worker
 * instead of parallelizing passkey ceremonies that have nothing to do with mention behavior.
 */
import { signUpAndOnboard } from '../helpers/app';
import { myWorkHref, orgHref, TIMEOUTS } from '../helpers/constants';
import { expect, test } from '../helpers/fixtures';
import { apiFetch } from '../helpers/net';
import { openMentionMenu, seedMentionFixtures, waitForMentionable } from '../helpers/mentions';
import { descriptionEditor } from '../helpers/editors';

// This flow verifies live search and selection. The offline suite owns service-worker navigation.
test.use({ serviceWorkers: 'block' });

test.describe('mentions', () => {
  test('a full entity name stays selectable in rich and plain editors', async ({ page }) => {
    const { orgId } = await signUpAndOnboard(page, 'MentionFullName');
    const { taskTitle } = await seedMentionFixtures(page, orgId);
    await waitForMentionable(page, orgId, taskTitle, taskTitle);

    await page.goto(myWorkHref(orgId), { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'My Work' })).toBeVisible({
      timeout: TIMEOUTS.pageReady,
    });
    await page.getByRole('button', { name: 'New task' }).first().click();
    const dialog = page.getByRole('dialog');
    const prose = dialog.getByRole('textbox', { name: 'Add a description' });
    await prose.click();
    await openMentionMenu(prose, taskTitle);
    await expect(page.getByRole('option', { name: new RegExp(taskTitle) })).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(dialog.locator('[data-mention-kind]').filter({ hasText: taskTitle })).toHaveCount(
      1,
    );

    await page.goto('/today', { waitUntil: 'domcontentloaded' });
    const capture = page.getByLabel('Ask Athena about today');
    await expect(capture).toBeVisible({ timeout: TIMEOUTS.pageReady });
    await capture.click();
    await capture.pressSequentially('Follow up on ');
    await openMentionMenu(capture, taskTitle);
    await expect(page.getByRole('option', { name: new RegExp(taskTitle) })).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(capture).toHaveValue(`Follow up on @${taskTitle} `);
  });

  test('a mention in prose persists, reloads as a chip, and lands in Resources', async ({
    page,
  }) => {
    const { orgId } = await signUpAndOnboard(page, 'Mentions');
    const { projectId, taskId, taskTitle } = await seedMentionFixtures(page, orgId);
    await waitForMentionable(page, orgId, 'zep', taskTitle);

    await page.goto(orgHref(orgId, `projects/${projectId}`), { waitUntil: 'domcontentloaded' });
    const prose = descriptionEditor(page);
    await expect(prose).toBeVisible({ timeout: TIMEOUTS.pageReady });

    await prose.click();
    await page.keyboard.press('End');
    await prose.pressSequentially(' Blocked by ');
    await openMentionMenu(prose, 'zep');
    await expect(page.getByRole('option', { name: new RegExp(taskTitle) })).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-mention-kind]').filter({ hasText: taskTitle })).toHaveCount(1);

    // The editor autosaves after a beat of quiet and several PATCHes fly during one edit, so wait
    // on the stored value rather than on a request. This also pins the storage format: what lands
    // in the column is an ordinary Markdown link whose title slot carries the machine ref.
    await expect
      .poll(
        async () => {
          const row = await apiFetch(page, `/v1/orgs/${orgId}/projects/${projectId}`);
          return (row.body as { description: string | null }).description ?? '';
        },
        { timeout: TIMEOUTS.sweep, message: 'the description should store the mention marker' },
      )
      .toContain(`"docket:v1:task:${taskId}"`);

    // Reconcile rides the write-through seam post-commit, so the edge follows the save rather
    // than arriving with it. Poll the read model before asking the UI about it, or a slow tick
    // reads as a missing feature.
    await expect
      .poll(
        async () => {
          const row = await apiFetch(page, `/v1/orgs/${orgId}/projects/${projectId}/mentions`);
          const entities = (row.body as { entities?: { label: string }[] }).entities ?? [];
          return entities.some((entity) => entity.label === taskTitle);
        },
        { timeout: TIMEOUTS.sweep, message: 'reconcile should derive the edge from the prose' },
      )
      .toBe(true);

    // The app persists its query cache and writes it on a throttle, so a reload fired the instant
    // the server has the value can rehydrate the pre-edit snapshot and serve it while it is still
    // inside its staleness window. Give the client's own write a beat before reloading — this is a
    // race in the test, not in the feature, and a sleep is the honest way to describe it.
    await page.waitForTimeout(2000);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-mention-kind]').filter({ hasText: taskTitle })).toHaveCount(
      1,
      {
        timeout: TIMEOUTS.pageReady,
      },
    );

    await page.getByRole('tab', { name: /resources/i }).click();
    await expect(page.getByRole('heading', { name: 'Related records' })).toBeVisible({
      timeout: TIMEOUTS.sweep,
    });
    await expect(page.getByText(taskTitle).first()).toBeVisible();

    // The Updates composer is a plain textarea, and prose mode there writes the same link form.
    await page.getByRole('tab', { name: /updates/i }).click();
    const composer = page.locator('#program-update-body');
    await expect(composer).toBeVisible({ timeout: TIMEOUTS.pageReady });
    // Combobox semantics only where a picker exists, and expanded only once one is on screen.
    await expect(composer).toHaveAttribute('role', 'combobox');
    await expect(composer).toHaveAttribute('aria-expanded', 'false');

    await composer.click();
    await composer.pressSequentially('Blocked by ');
    await openMentionMenu(composer, 'zep');
    await expect(composer).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Enter');
    await expect(composer).toHaveValue(
      `Blocked by [${taskTitle}](/orgs/${orgId}/tasks/${taskId} "docket:v1:task:${taskId}") `,
    );
  });

  test("`@` and `/` stay out of each other's way in the same editor", async ({ page }) => {
    const { orgId } = await signUpAndOnboard(page, 'MentionsSlash');
    const { projectId, taskTitle } = await seedMentionFixtures(page, orgId);
    await waitForMentionable(page, orgId, 'zep', taskTitle);

    await page.goto(orgHref(orgId, `projects/${projectId}`), { waitUntil: 'domcontentloaded' });
    const prose = descriptionEditor(page);
    await expect(prose).toBeVisible({ timeout: TIMEOUTS.pageReady });

    // They are two separate runs on two separate plugins, so the risk worth a test is that one
    // run leaks into the other: the slash menu answering an `@`, or a mention menu still holding
    // the arrow keys once the reader has moved on to inserting a block.
    await prose.click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await prose.pressSequentially('/bul');
    await expect(page.getByRole('listbox', { name: 'Insert a block' })).toBeVisible();
    await expect(page.getByRole('listbox', { name: 'Mention a resource' })).toHaveCount(0);
    await page.keyboard.press('Enter');
    await expect(prose.locator('ul li')).toHaveCount(1);

    await openMentionMenu(prose, 'zep');
    await expect(page.getByRole('listbox', { name: 'Mention a resource' })).toBeVisible();
    await expect(page.getByRole('listbox', { name: 'Insert a block' })).toHaveCount(0);
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-mention-kind]').filter({ hasText: taskTitle })).toHaveCount(1);
  });

  test('a model-context surface dismisses cleanly and inserts a bare title', async ({ page }) => {
    const { orgId } = await signUpAndOnboard(page, 'MentionsCtx');
    const { taskTitle } = await seedMentionFixtures(page, orgId);
    await waitForMentionable(page, orgId, 'zep', taskTitle);

    await page.goto('/today', { waitUntil: 'domcontentloaded' });
    const capture = page.locator('textarea').first();
    await expect(capture).toBeVisible({ timeout: TIMEOUTS.pageReady });

    await capture.click();
    await capture.pressSequentially('Follow up on ');
    await openMentionMenu(capture, 'zep');

    await page.keyboard.press('Escape');
    await expect(page.getByRole('listbox')).toHaveCount(0);
    await expect(capture).toHaveValue('Follow up on @zep');

    // A caret move re-reads the trigger, and the dismissal has to survive that, or the menu
    // reopens under a reader who just asked it to go away.
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(400);
    await expect(page.getByRole('listbox')).toHaveCount(0);

    // A fresh attempt still opens, so one Escape never disables the field for good.
    await page.keyboard.press('End');
    await capture.pressSequentially(' and ');
    await openMentionMenu(capture, 'zep');
    await page.keyboard.press('Enter');

    // Context mode writes a bare title: Markdown link syntax in a model prompt is noise.
    await expect(capture).toHaveValue(`Follow up on @zep and @${taskTitle} `);
  });
});
