/** Visual and DOM evidence for the Markdown code-block surface. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';

import { signUpAndOnboard } from '../helpers/app';
import { ORIGIN, orgHref, TIMEOUTS } from '../helpers/constants';
import { expect, test } from '../helpers/fixtures';
import { apiFetch } from '../helpers/net';
import { seedMentionFixtures } from '../helpers/mentions';
import { setColorScheme } from '../helpers/ui';
import { descriptionEditor, taskActivity } from '../helpers/editors';

const SHOT_ROOT = resolve(
  import.meta.dirname,
  '../../../../docs/design/audits/screenshots/2026-08-10-markdown-code',
);

/** Retry a cold dynamic route when the dev service worker briefly serves its offline fallback. */
async function openPersistedRoute(page: Page, href: string): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.goto(href, { waitUntil: 'domcontentloaded' });
    if (!(await page.getByRole('heading', { name: "You're offline" }).isVisible())) return;
    await page.waitForTimeout(1000);
  }
}

test.describe('Markdown code visual evidence', () => {
  test('captures both widths and themes with responsive and accessibility probes', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    mkdirSync(SHOT_ROOT, { recursive: true });
    const { orgId } = await signUpAndOnboard(page, 'MarkdownCodeShots');
    const { projectId, taskId } = await seedMentionFixtures(page, orgId);
    await page
      .context()
      .grantPermissions(['clipboard-read', 'clipboard-write'], { origin: ORIGIN });
    const source = [
      'Run `pnpm test` before opening a review.',
      '',
      '```typescript',
      'const ready = true',
      "const release = { channel: 'production', verification: 'complete', owner: 'operations' }",
      '```',
    ].join('\n');
    const update = await apiFetch(page, `/v1/orgs/${orgId}/projects/${projectId}`, {
      method: 'PATCH',
      body: { description: source },
    });
    expect(update.status, 'the visual fixture should persist').toBe(200);
    const commentSource = [
      'Review with `pnpm test` before release.',
      '',
      '```typescript',
      'const commentReady = true',
      "const release = { channel: 'production', verification: 'complete', owner: 'operations' }",
      '```',
    ].join('\n');
    const commentCreate = await apiFetch(page, `/v1/orgs/${orgId}/comments`, {
      method: 'POST',
      body: { subjectType: 'task', subjectId: taskId, body: commentSource },
    });
    expect(commentCreate.status, 'the comment fixture should persist').toBe(200);

    await openPersistedRoute(page, orgHref(orgId, `projects/${projectId}`));
    const prose = descriptionEditor(page);
    const block = prose.locator('[data-code-block]');
    await expect(block.locator('.hljs-keyword').first()).toHaveText('const', {
      timeout: TIMEOUTS.pageReady,
    });

    const themes: Record<string, unknown> = {};
    for (const scheme of ['light', 'dark'] as const) {
      await page.setViewportSize({ width: 1440, height: 900 });
      await setColorScheme(page, scheme);
      await page.waitForTimeout(250);
      themes[scheme] = await page.evaluate(() => {
        const keyword = document.querySelector<HTMLElement>('.hljs-keyword');
        const blockElement = document.querySelector<HTMLElement>('[data-code-block]');
        const keywordColor = keyword ? getComputedStyle(keyword).color : '';
        const blockBackground = blockElement ? getComputedStyle(blockElement).backgroundColor : '';
        const canvas = document.createElement('canvas');
        canvas.width = 1;
        canvas.height = 1;
        const context = canvas.getContext('2d');
        const luminance = (color: string): number => {
          if (!context) return 0;
          context.clearRect(0, 0, 1, 1);
          context.fillStyle = color;
          context.fillRect(0, 0, 1, 1);
          const [red = 0, green = 0, blue = 0] = context.getImageData(0, 0, 1, 1).data;
          const linear = (channel: number): number => {
            const value = channel / 255;
            return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
          };
          return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue);
        };
        const foreground = luminance(keywordColor);
        const background = luminance(blockBackground);
        return {
          keywordColor,
          blockBackground,
          keywordContrast:
            (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05),
        };
      });
      expect(
        (themes[scheme] as { keywordContrast: number }).keywordContrast,
      ).toBeGreaterThanOrEqual(4.5);
      await page.screenshot({
        path: resolve(SHOT_ROOT, `project-code-1440x900-${scheme}.png`),
        animations: 'disabled',
      });

      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(250);
      await page.screenshot({
        path: resolve(SHOT_ROOT, `project-code-390x844-${scheme}.png`),
        animations: 'disabled',
      });
    }

    await page.setViewportSize({ width: 320, height: 720 });
    await setColorScheme(page, 'light');
    const layout = await page.evaluate(() => {
      const select = document.querySelector<HTMLSelectElement>('[aria-label="Code language"]');
      const copy = document.querySelector<HTMLButtonElement>('[aria-label="Copy code"]');
      const pre = document.querySelector<HTMLElement>('[data-code-block] pre');
      const keyword = document.querySelector<HTMLElement>('.hljs-keyword');
      const blockElement = document.querySelector<HTMLElement>('[data-code-block]');
      return {
        viewportWidth: innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        selectHeight: select?.getBoundingClientRect().height ?? 0,
        copyHeight: copy?.getBoundingClientRect().height ?? 0,
        blockWidth: blockElement?.getBoundingClientRect().width ?? 0,
        codeClientWidth: pre?.clientWidth ?? 0,
        codeScrollWidth: pre?.scrollWidth ?? 0,
        keywordColor: keyword ? getComputedStyle(keyword).color : '',
        blockBackground: blockElement ? getComputedStyle(blockElement).backgroundColor : '',
      };
    });
    expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth);
    expect(layout.selectHeight).toBeGreaterThanOrEqual(40);
    expect(layout.copyHeight).toBeGreaterThanOrEqual(40);
    expect(layout.codeScrollWidth).toBeGreaterThan(layout.codeClientWidth);

    const language = block.getByRole('combobox', { name: 'Code language' });
    await language.focus();
    await expect(language).toBeFocused();
    await page.keyboard.press('Tab');
    const copy = block.getByRole('button', { name: 'Copy code' });
    await expect(copy).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(copy).toHaveAttribute('data-copy-state', 'copied');

    await openPersistedRoute(page, orgHref(orgId, `tasks/${taskId}`));
    const comment = taskActivity(page).locator('[data-static-markdown]');
    const commentEntry = comment.locator('xpath=ancestor::li');
    const commentBlock = comment.locator('[data-code-block]');
    await expect(commentBlock.locator('.hljs-keyword').first()).toHaveText('const', {
      timeout: TIMEOUTS.pageReady,
    });
    const commentThemes: Record<string, unknown> = {};
    for (const scheme of ['light', 'dark'] as const) {
      await page.setViewportSize({ width: 1440, height: 900 });
      await setColorScheme(page, scheme);
      await commentEntry.evaluate((element) => {
        element.scrollIntoView({ block: 'start' });
      });
      await page.waitForTimeout(250);
      await commentEntry.screenshot({
        path: resolve(SHOT_ROOT, `comment-code-1440x900-${scheme}.png`),
        animations: 'disabled',
      });

      await page.setViewportSize({ width: 390, height: 844 });
      await commentEntry.evaluate((element) => {
        element.scrollIntoView({ block: 'start' });
      });
      await page.waitForTimeout(250);
      commentThemes[scheme] = await commentBlock.evaluate((element) => {
        const keyword = element.querySelector<HTMLElement>('.hljs-keyword');
        return {
          keywordColor: keyword ? getComputedStyle(keyword).color : '',
          blockBackground: getComputedStyle(element).backgroundColor,
        };
      });
      await commentEntry.screenshot({
        path: resolve(SHOT_ROOT, `comment-code-390x844-${scheme}.png`),
        animations: 'disabled',
      });
    }

    await page.setViewportSize({ width: 320, height: 720 });
    await setColorScheme(page, 'light');
    const commentLayout = await comment.evaluate((element) => {
      const copyButton = element.querySelector<HTMLButtonElement>('[aria-label="Copy code"]');
      const pre = element.querySelector<HTMLElement>('[data-code-block] pre');
      const blockElement = element.querySelector<HTMLElement>('[data-code-block]');
      return {
        viewportWidth: innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        copyHeight: copyButton?.getBoundingClientRect().height ?? 0,
        blockWidth: blockElement?.getBoundingClientRect().width ?? 0,
        codeClientWidth: pre?.clientWidth ?? 0,
        codeScrollWidth: pre?.scrollWidth ?? 0,
        textboxCount: element.querySelectorAll('[role="textbox"]').length,
        languageSelectCount: element.querySelectorAll('[aria-label="Code language"]').length,
      };
    });
    expect(commentLayout.documentWidth).toBeLessThanOrEqual(commentLayout.viewportWidth);
    expect(commentLayout.copyHeight).toBeGreaterThanOrEqual(40);
    expect(commentLayout.codeScrollWidth).toBeGreaterThan(commentLayout.codeClientWidth);
    expect(commentLayout.textboxCount).toBe(0);
    expect(commentLayout.languageSelectCount).toBe(0);

    writeFileSync(
      resolve(SHOT_ROOT, 'measurements.json'),
      `${JSON.stringify({ themes, layout, commentThemes, commentLayout }, null, 2)}\n`,
      'utf8',
    );
  });
});
