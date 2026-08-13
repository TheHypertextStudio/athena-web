/**
 * Copy and paste fidelity through real persisted document and comment surfaces.
 *
 * @remarks
 * The unit suites prove each serializer in isolation. What only a browser can prove is that the
 * *system clipboard* actually ends up holding Markdown — the serializer, ProseMirror's clipboard
 * pipeline, and the app's own `copy` listener all have to cooperate, and any one of them silently
 * winning is the difference between "copy preserved my formatting" and a wall of flattened prose.
 *
 * One journey, because the passkey setup is expensive: author structure in a project body, copy it
 * out as Markdown, paste Markdown back in and watch it become structure, then copy from a posted
 * comment — the read-only surface that has no editor behind it and so takes a different path
 * entirely.
 */
import { signUpAndOnboard } from '../helpers/app';
import { ORIGIN, orgHref, TIMEOUTS } from '../helpers/constants';
import { expect, test } from '../helpers/fixtures';
import { seedMentionFixtures } from '../helpers/mentions';

/** What the clipboard's plain flavor currently holds. */
async function clipboardText(page: Parameters<typeof signUpAndOnboard>[0]): Promise<string> {
  return page.evaluate(() => navigator.clipboard.readText());
}

test.describe('Clipboard fidelity', () => {
  test('copies bodies out as Markdown, pastes Markdown back in, and copies posted comments', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const { orgId } = await signUpAndOnboard(page, 'ClipboardFidelity');
    const { projectId, taskId } = await seedMentionFixtures(page, orgId);
    await page
      .context()
      .grantPermissions(['clipboard-read', 'clipboard-write'], { origin: ORIGIN });

    // --- Copying out of a body -------------------------------------------------------------
    await page.goto(orgHref(orgId, `projects/${projectId}`), { waitUntil: 'domcontentloaded' });
    const prose = page.locator('section[aria-label="Project document"] [contenteditable="true"]');
    await expect(prose).toBeVisible({ timeout: TIMEOUTS.pageReady });

    await prose.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('Delete');
    await prose.pressSequentially('# Rollout plan');
    await page.keyboard.press('Enter');
    await prose.pressSequentially('- [ ] Flip the flag');
    await expect(prose.locator('li[data-checked]')).toHaveCount(1);

    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('ControlOrMeta+c');

    // The plain flavor is Markdown, not `textBetween`'s flattened characters. Without this the
    // heading and the checkbox would arrive anywhere else as "Rollout plan Flip the flag".
    await expect
      .poll(() => clipboardText(page), {
        timeout: TIMEOUTS.ui,
        message: 'the clipboard should hold the body as Markdown',
      })
      .toContain('# Rollout plan');
    expect(await clipboardText(page)).toContain('[ ] Flip the flag');

    // --- Pasting Markdown back in ----------------------------------------------------------
    await page.evaluate(() =>
      navigator.clipboard.writeText('## From another tool\n\n- One\n- Two'),
    );
    await prose.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('ControlOrMeta+v');

    // Real structure, not three lines of literal syntax.
    await expect(prose.locator('h2')).toHaveText('From another tool', { timeout: TIMEOUTS.ui });
    await expect(prose.locator('ul > li')).toHaveCount(2);

    // --- Copying out of a posted comment ---------------------------------------------------
    await page.goto(orgHref(orgId, `tasks/${taskId}`), { waitUntil: 'domcontentloaded' });
    const conversation = page.locator('section[aria-labelledby="conversation-heading"]');
    const composer = conversation.getByRole('textbox', { name: 'Add a comment' });
    await expect(composer).toBeVisible({ timeout: TIMEOUTS.pageReady });

    await composer.click();
    await composer.pressSequentially('## Findings');
    await page.keyboard.press('Enter');
    await composer.pressSequentially('- Checked the logs');
    await conversation.getByRole('button', { name: 'Comment', exact: true }).click();

    const posted = conversation.locator('[data-static-markdown]').last();
    await expect(posted.locator('h2')).toHaveText('Findings', { timeout: TIMEOUTS.pageReady });

    // A posted comment is rendered from tokens with no editor behind it, so this exercises the
    // app's own `copy` listener and the DOM-to-Markdown walker rather than ProseMirror.
    await posted.evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    });
    await page.keyboard.press('ControlOrMeta+c');

    await expect
      .poll(() => clipboardText(page), {
        timeout: TIMEOUTS.ui,
        message: 'a copied comment should come back as Markdown',
      })
      .toBe('## Findings\n\n- Checked the logs');
  });
});
