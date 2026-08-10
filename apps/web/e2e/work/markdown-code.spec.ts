/**
 * Markdown code formatting through real persisted project and comment surfaces.
 *
 * @remarks
 * This is deliberately one end-to-end journey: the expensive passkey setup earns proof that the
 * third backtick transforms immediately, language selection survives the API round trip, the
 * grammar chunk paints tokens, and exact source can still be copied after a reload in both the
 * editable document and lightweight read-only conversation renderer.
 */
import { signUpAndOnboard } from '../helpers/app';
import { ORIGIN, orgHref, TIMEOUTS } from '../helpers/constants';
import { expect, test } from '../helpers/fixtures';
import { apiFetch } from '../helpers/net';
import { seedMentionFixtures } from '../helpers/mentions';

test.describe('Markdown code formatting', () => {
  test('inline and fenced code persist, highlight lazily, reload, and copy exactly', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const { orgId } = await signUpAndOnboard(page, 'MarkdownCode');
    const { projectId, taskId, taskTitle } = await seedMentionFixtures(page, orgId);
    await page
      .context()
      .grantPermissions(['clipboard-read', 'clipboard-write'], { origin: ORIGIN });

    await page.goto(orgHref(orgId, `projects/${projectId}`), {
      waitUntil: 'domcontentloaded',
    });
    const prose = page.locator('section[aria-label="Project document"] [contenteditable="true"]');
    await expect(prose).toBeVisible({ timeout: TIMEOUTS.pageReady });

    await prose.click();
    await page.keyboard.press('End');
    await prose.pressSequentially(' Run `pnpm test`. ');
    await expect(prose.locator('[data-inline-code]')).toHaveText('pnpm test');

    await page.keyboard.press('Enter');
    await prose.pressSequentially('```');
    const block = prose.locator('[data-code-block]');
    await expect(block).toBeVisible();
    await expect(block).not.toContainText('```');
    await prose.pressSequentially('const ready = true');

    const language = block.getByRole('combobox', { name: 'Code language' });
    await language.selectOption('typescript');
    await expect(block.locator('.hljs-keyword')).toHaveText('const');

    await expect
      .poll(
        async () => {
          const result = await apiFetch(page, `/v1/orgs/${orgId}/projects/${projectId}`);
          return (result.body as { description: string | null }).description ?? '';
        },
        { timeout: TIMEOUTS.sweep, message: 'the project should store both code formats' },
      )
      .toContain('```typescript\nconst ready = true\n```');

    await page.waitForTimeout(2000);
    await page.reload({ waitUntil: 'domcontentloaded' });
    const reloaded = page.locator(
      'section[aria-label="Project document"] [contenteditable="true"]',
    );
    await expect(reloaded.locator('[data-inline-code]')).toHaveText('pnpm test', {
      timeout: TIMEOUTS.pageReady,
    });
    const reloadedBlock = reloaded.locator('[data-code-block]');
    await expect(reloadedBlock.getByRole('combobox', { name: 'Code language' })).toHaveValue(
      'typescript',
    );
    await expect(reloadedBlock.locator('.hljs-keyword')).toHaveText('const');

    const copy = reloadedBlock.getByRole('button', { name: 'Copy code' });
    await copy.click();
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe('const ready = true');
    await expect(copy).toHaveAttribute('data-copy-state', 'copied', { timeout: TIMEOUTS.ui });

    await page.goto(orgHref(orgId, `tasks/${taskId}`), { waitUntil: 'domcontentloaded' });
    const conversation = page.locator('section[aria-labelledby="conversation-heading"]');
    const composer = conversation.getByRole('textbox', { name: 'Add a comment' });
    await expect(composer).toBeVisible({ timeout: TIMEOUTS.pageReady });
    await composer.click();
    await composer.pressSequentially('Review with `pnpm test`.');
    await page.keyboard.press('Enter');
    await composer.pressSequentially('```');
    const draftBlock = composer.locator('[data-code-block]');
    await expect(draftBlock).toBeVisible();
    await composer.pressSequentially('const commentReady = true');
    await draftBlock.getByRole('combobox', { name: 'Code language' }).selectOption('typescript');
    await conversation.getByRole('button', { name: 'Comment', exact: true }).click();

    const posted = conversation.locator('[data-static-markdown]');
    await expect(posted.locator('[data-inline-code]')).toHaveText('pnpm test', {
      timeout: TIMEOUTS.pageReady,
    });
    await expect(posted.getByText('TypeScript')).toBeVisible();
    await expect(posted.locator('.hljs-keyword')).toHaveText('const');
    await expect(conversation.locator('.ProseMirror')).toHaveCount(1);
    await expect
      .poll(async () => {
        const result = await apiFetch(
          page,
          `/v1/orgs/${orgId}/comments?subjectType=task&subjectId=${taskId}`,
        );
        return (result.body as { items?: { body: string }[] }).items?.at(-1)?.body ?? '';
      })
      .toContain('```typescript\nconst commentReady = true\n```');

    await page.reload({ waitUntil: 'domcontentloaded' });
    // Turbopack dev serves a catch-all for a hard reload of this dynamic route. Re-enter through
    // the workspace task list so the browser reload is still real and the App Router resolves the
    // persisted task through its production soft-navigation path.
    await page.locator(`a[href="${orgHref(orgId, 'tasks')}"]`).click();
    await page.getByText(taskTitle, { exact: true }).first().click({ timeout: TIMEOUTS.pageReady });
    await page.waitForURL(new RegExp(`/tasks/${taskId}$`), { timeout: TIMEOUTS.pageReady });
    const reloadedConversation = page.locator('section[aria-labelledby="conversation-heading"]');
    const reloadedComment = reloadedConversation.locator('[data-static-markdown]');
    await expect(reloadedComment.getByText('TypeScript')).toBeVisible({
      timeout: TIMEOUTS.pageReady,
    });
    await expect(reloadedComment.locator('.hljs-keyword')).toHaveText('const');
    const commentCopy = reloadedComment.getByRole('button', { name: 'Copy code' });
    await commentCopy.click();
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe('const commentReady = true');
    await expect(commentCopy).toHaveAttribute('data-copy-state', 'copied', {
      timeout: TIMEOUTS.ui,
    });
  });
});
