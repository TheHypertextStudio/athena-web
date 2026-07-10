/**
 * Visual capture of the task-detail **Attachments** section (file-upload UI).
 *
 * @remarks
 * Throwaway spec: signs up + onboards, creates a task **assigned to the onboarded member** via the
 * API, opens it from My Work's list (a Next `<Link>` → soft navigation the App Router resolves to
 * `tasks/[taskId]`; a hard `page.goto` hits a Turbopack-dev catch-all), then screenshots the
 * attachments section empty and after a file upload.
 */
import { signUpAndOnboard } from './helpers/app';
import { myWorkHref } from './helpers/constants';
import { expect, test } from './helpers/fixtures';
import { apiJson } from './helpers/net';

const TITLE = 'Attachments demo task';

test('capture the task-detail attachments UI', async ({ page }, testInfo) => {
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('passkey')) console.log('PAGE ERROR:', m.text());
  });

  const { orgId } = await signUpAndOnboard(page, 'attach');

  const teams = await apiJson<{ items: { id: string }[] }>(page, `/v1/orgs/${orgId}/teams`);
  const teamId = teams.items[0]?.id;
  const members = await apiJson<{ items: { actorId: string }[] }>(
    page,
    `/v1/orgs/${orgId}/members`,
  );
  const assigneeId = members.items[0]?.actorId;
  expect(teamId && assigneeId, 'onboarding must mint a team + member').toBeTruthy();

  await apiJson(page, `/v1/orgs/${orgId}/tasks`, {
    method: 'POST',
    body: { title: TITLE, teamId, assigneeId },
  });

  await page.goto(myWorkHref(orgId), { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'My Work' })).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: testInfo.outputPath('mywork.png') });

  // Open the task from the list — a soft navigation to `tasks/[taskId]`.
  await page.getByText(TITLE).first().click({ timeout: 15_000 });
  await page.waitForURL(/\/tasks\/[^/]+$/, { timeout: 15_000 }).catch(() => undefined);
  console.log('landed url:', page.url());

  // Wait through the cold-route compile + hydration (retries until the section actually renders).
  const heading = page.getByRole('heading', { name: 'Attachments' }).first();
  await expect(heading).toBeVisible({ timeout: 40_000 });
  await heading.scrollIntoViewIfNeeded();
  await page.waitForTimeout(1000);
  const section = page.locator('section[aria-labelledby="attachments-heading"]').first();
  await section.screenshot({ path: testInfo.outputPath('attachments-empty.png') });
  await page.screenshot({ path: testInfo.outputPath('attachments-empty-full.png') });

  const fileInput = page.locator('input[type=file]').first();
  console.log('file input count (canEdit?):', await page.locator('input[type=file]').count());
  if ((await page.locator('input[type=file]').count()) === 0) return; // editing gated

  await fileInput.setInputFiles({
    name: 'design-spec.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4\nfake demo bytes\n%%EOF'),
  });
  await expect(page.getByText('design-spec.pdf').first()).toBeVisible({ timeout: 20_000 });
  await heading.scrollIntoViewIfNeeded();
  await section.screenshot({ path: testInfo.outputPath('attachments-file.png') });
  await page.screenshot({ path: testInfo.outputPath('attachments-file-full.png') });
});
