/** Real-stack acceptance for creating an accountless assignee without abandoning a task draft. */
import { signUpAndOnboard } from '../helpers/app';
import { myWorkHref, orgHref, TIMEOUTS } from '../helpers/constants';
import { expect, test } from '../helpers/fixtures';
import { setColorScheme } from '../helpers/ui';
import { openMentionMenu } from '../helpers/mentions';

test.use({ serviceWorkers: 'block', actionTimeout: 15_000 });

for (const theme of ['light', 'dark'] as const) {
  for (const width of [1440, 390]) {
    test(`creates a person in a task draft at ${width}px in ${theme}`, async ({
      page,
    }, testInfo) => {
      const { orgId } = await signUpAndOnboard(page, 'inline-person');
      await page.setViewportSize({ width, height: 900 });
      await setColorScheme(page, theme);
      await page.goto(myWorkHref(orgId), { waitUntil: 'domcontentloaded' });
      const dialog = page.getByRole('dialog', { name: 'New task', exact: true });
      await expect(async () => {
        if (!(await dialog.isVisible())) {
          await page.getByRole('button', { name: 'New task', exact: true }).first().click();
        }
        await expect(dialog).toBeVisible({ timeout: 1000 });
      }).toPass({ timeout: TIMEOUTS.pageReady });
      const title = dialog.getByRole('textbox').first();
      await title.fill('Prepare the volunteer briefing');
      if (width < 600) await dialog.getByRole('button', { name: 'More Task properties' }).click();
      await page.getByRole('button', { name: /^Assignee/ }).click();
      await page.getByPlaceholder('Search people…').fill('Sam Rivera');
      await page.getByRole('option', { name: 'Add “Sam Rivera”' }).click();
      await expect(
        page.getByText('Creates a person record. No invitation will be sent.'),
      ).toBeVisible();
      await testInfo.attach('person-confirmation', {
        body: await page.screenshot({
          path: testInfo.outputPath('person-confirmation.png'),
          animations: 'disabled',
        }),
        contentType: 'image/png',
      });
      const created = page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          new URL(response.url()).pathname.endsWith(`/orgs/${orgId}/members`),
      );
      await page.getByRole('button', { name: 'Add and select', exact: true }).click();
      const response = await created;
      expect(response.status()).toBe(201);
      const payload = (await response.json()) as {
        actorId: string;
        userId: string | null;
        roleId: string | null;
      };
      expect(payload.userId).toBeNull();
      expect(payload.roleId).toBeNull();
      await expect(page.getByRole('button', { name: /Assignee.*Sam Rivera/ })).toBeVisible();
      await expect(title).toHaveValue('Prepare the volunteer briefing');
      await page.getByRole('button', { name: /Assignee.*Sam Rivera/ }).click();
      await page.getByPlaceholder('Search people…').fill('Sam Rivera');
      await expect(
        page.getByRole('option', { name: 'Add another person named “Sam Rivera”' }),
      ).toBeVisible();
      await testInfo.attach('same-name-choice', {
        body: await page.screenshot({
          path: testInfo.outputPath('same-name-choice.png'),
          animations: 'disabled',
        }),
        contentType: 'image/png',
      });
      await page.keyboard.press('Escape');
      const moreProperties = dialog.getByRole('button', { name: 'More Task properties' });
      if ((await moreProperties.getAttribute('aria-expanded')) === 'true') {
        await page.keyboard.press('Escape');
      }
      const description = dialog.getByRole('textbox', { name: 'Add a description' });
      await description.click();
      await description.pressSequentially('Coordinate with ');
      await openMentionMenu(description, 'Sam Rivera');
      await testInfo.attach('accountless-person-mention', {
        body: await page.screenshot({
          path: testInfo.outputPath('accountless-person-mention.png'),
          animations: 'disabled',
        }),
        contentType: 'image/png',
      });
      await page.getByRole('option', { name: /Sam Rivera.*Person/ }).click();
      await expect(dialog.locator('[data-mention-kind="entity"]')).toHaveText('Sam Rivera');
      await dialog.getByRole('button', { name: 'Create task', exact: true }).click();
      await expect(dialog).not.toBeVisible();
      await page.goto(orgHref(orgId, 'people'));
      await expect(page.getByRole('link', { name: 'Sam Rivera', exact: true })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Invite by email' })).not.toBeVisible();
      await page.getByRole('link', { name: 'Sam Rivera', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Sam Rivera', exact: true })).toBeVisible();
      await expect(
        page.getByRole('link', { name: 'Prepare the volunteer briefing', exact: true }),
      ).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );
      expect(overflow).toBe(false);
      await testInfo.attach('assigned-person-profile', {
        body: await page.screenshot({
          path: testInfo.outputPath('assigned-person-profile.png'),
          animations: 'disabled',
        }),
        contentType: 'image/png',
      });
    });
  }
}
