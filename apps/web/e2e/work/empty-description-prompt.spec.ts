/**
 * Geometry evidence for the prompt an unwritten entity description shows.
 *
 * @remarks
 * The prompt row sits in the editor's own grid cell rather than at a fixed inset, because an
 * absolute offset there resolves against the surface's padding box and every host pads that
 * surface differently. Only a real layout pass can tell the two apart, so this asserts the row's
 * box against ProseMirror's: an empty body's first paragraph starts flush with the editor, so the
 * editor's top-left corner is where the first typed character lands.
 */
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { signUpAndOnboard } from '../helpers/app';
import { orgHref, TIMEOUTS } from '../helpers/constants';
import { descriptionEditor } from '../helpers/editors';
import { expect, test } from '../helpers/fixtures';
import { apiJson } from '../helpers/net';
import { setColorScheme } from '../helpers/ui';

const SHOT_DIR = resolve(
  import.meta.dirname,
  '../../../../docs/design/audits/screenshots/2026-09-08-empty-description-prompt',
);

interface CreatedEntity {
  readonly id: string;
}

test('an unwritten description prompts on the line the first character will occupy', async ({
  page,
}) => {
  test.setTimeout(600_000);
  mkdirSync(SHOT_DIR, { recursive: true });
  const { orgId } = await signUpAndOnboard(page, 'EmptyDescriptionPrompt');

  // The template action only renders when the org has an Initiative template carrying a body, and
  // the editor only fetches templates once a reader activates it. Both have to hold for the prompt
  // row to reach its widest state, which is the state that has to fit.
  await apiJson(page, `/v1/orgs/${orgId}/templates`, {
    method: 'POST',
    body: {
      targetType: 'initiative',
      name: 'Strategic initiative',
      payload: {
        targetType: 'initiative',
        description: '# Executive summary\n\n## The bet',
      },
    },
  });
  const initiative = await apiJson<CreatedEntity>(page, `/v1/orgs/${orgId}/initiatives`, {
    method: 'POST',
    body: { name: 'Unify the scheduling surfaces', status: 'active' },
  });

  await page.goto(orgHref(orgId, `initiatives/${initiative.id}`), {
    waitUntil: 'domcontentloaded',
    timeout: TIMEOUTS.pageReady,
  });
  const editor = descriptionEditor(page);
  await expect(editor).toBeVisible({ timeout: TIMEOUTS.pageReady });

  const prompt = page.locator('[data-editor-empty-actions]');
  await expect(prompt).toHaveText('Describe this initiative…');

  // Insert is the mouse path to `/`, and its menu holds an image upload plus the template commands.
  // A blank body already offers the templates on this row, so the control would be a second
  // invitation on the only line the body has.
  await expect(page.locator('[data-editor-insert]')).toHaveCount(0);

  await editor.click();
  await expect(page.getByRole('button', { name: 'Start from template' })).toBeVisible({
    timeout: TIMEOUTS.pageReady,
  });
  await expect(prompt).toHaveText(/^Describe this initiative….*Start from template$/);
  await expect(page.locator('[data-editor-insert]')).toHaveCount(0);

  const aligned = await prompt.evaluate((row) => {
    const surface = row.closest('[data-editor-surface]');
    const editable = surface?.querySelector('.ProseMirror');
    if (!editable) throw new Error('the editor surface has no ProseMirror element');
    const rowBox = row.getBoundingClientRect();
    const editorBox = editable.getBoundingClientRect();
    return { left: rowBox.left - editorBox.left, top: rowBox.top - editorBox.top };
  });
  // The old `absolute top-4 left-4` put this row 16px down and right of both.
  expect(Math.abs(aligned.left)).toBeLessThanOrEqual(1);
  expect(Math.abs(aligned.top)).toBeLessThanOrEqual(2);

  await page.setViewportSize({ width: 1440, height: 900 });
  await setColorScheme(page, 'dark');
  await page.screenshot({ path: resolve(SHOT_DIR, 'desktop-dark.png') });
  await setColorScheme(page, 'light');
  await page.screenshot({ path: resolve(SHOT_DIR, 'desktop-light.png') });

  // The prompt plus the template pill is wider than a phone-width body, so it has to wrap rather
  // than run past the card and give the document horizontal scroll.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(prompt).toBeVisible();
  await page.screenshot({ path: resolve(SHOT_DIR, 'mobile-light.png') });
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
});
