/** End-to-end proof for Library search, context, downloads, and responsive controls. */
import type { Page } from '@playwright/test';

import { signUpAndOnboard } from '../helpers/app';
import { orgHref, TIMEOUTS } from '../helpers/constants';
import { expect, test } from '../helpers/fixtures';
import { apiFetch, apiJson } from '../helpers/net';

const FILE_NAME = 'Library finder brief.pdf';
const INITIATIVE_NAME = 'Q3 finder launch';

test.use({ serviceWorkers: 'block' });

/** Wait for the asynchronous search projector to expose the uploaded attachment. */
async function waitForLibraryFile(page: Page, orgId: string): Promise<void> {
  await expect
    .poll(
      async () => {
        const result = await apiFetch(
          page,
          `/v1/orgs/${orgId}/search?kinds=attachment&q=${encodeURIComponent(FILE_NAME)}&limit=50`,
        );
        const items = (result.body as { items?: { title: string }[] }).items ?? [];
        return items.some((item) => item.title === FILE_NAME);
      },
      { timeout: TIMEOUTS.sweep, message: 'the uploaded file should reach Library search' },
    )
    .toBe(true);
}

test('Library finds, groups, explains, and downloads a file at desktop and phone widths', async ({
  page,
}) => {
  const { orgId } = await signUpAndOnboard(page, 'LibraryFinder');
  const teams = await apiJson<{ items: { id: string }[] }>(page, `/v1/orgs/${orgId}/teams`);
  const teamId = teams.items[0]?.id ?? '';
  expect(teamId, 'onboarding should create a team').not.toBe('');

  const initiative = await apiJson<{ id: string }>(page, `/v1/orgs/${orgId}/initiatives`, {
    method: 'POST',
    body: { name: INITIATIVE_NAME },
  });
  const project = await apiJson<{ id: string }>(page, `/v1/orgs/${orgId}/projects`, {
    method: 'POST',
    body: { name: 'Finder implementation', teamId, initiativeIds: [initiative.id] },
  });
  const task = await apiJson<{ id: string }>(page, `/v1/orgs/${orgId}/tasks`, {
    method: 'POST',
    body: { title: 'Verify Library resources', teamId, projectId: project.id },
  });
  const upload = await page.request.post(`/v1/orgs/${orgId}/tasks/${task.id}/attachments`, {
    multipart: {
      file: {
        name: FILE_NAME,
        mimeType: 'application/pdf',
        buffer: Buffer.from('%PDF-1.4\nLibrary finder browser proof\n%%EOF'),
      },
    },
  });
  expect(upload.ok(), `file upload should succeed, received ${String(upload.status())}`).toBe(true);
  await waitForLibraryFile(page, orgId);

  await page.goto(orgHref(orgId, 'library'), {
    waitUntil: 'domcontentloaded',
    timeout: TIMEOUTS.pageReady,
  });
  await expect(page.getByRole('heading', { name: 'Library' })).toBeVisible({
    timeout: TIMEOUTS.pageReady,
  });
  await expect(page.getByRole('grid', { name: 'Library resources' })).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: INITIATIVE_NAME })).toBeVisible();
  await expect(page.getByRole('link', { name: FILE_NAME })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Display · Work context' })).toBeVisible();

  await page.getByRole('button', { name: `Show context for ${FILE_NAME}` }).click();
  const details = page.getByRole('complementary', { name: `Details for ${FILE_NAME}` });
  await expect(details).toBeVisible();
  await expect(details.getByText(INITIATIVE_NAME)).toBeVisible();
  await expect(details.getByRole('link', { name: 'Open task' })).toBeVisible();
  await expect(details.getByText('application/pdf')).toBeVisible();
  await details.getByRole('button', { name: 'Close details' }).click();

  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: FILE_NAME }).click();
  expect((await download).suggestedFilename()).toBe(FILE_NAME);

  await page.getByRole('button', { name: 'Display · Work context' }).click();
  await page.getByRole('menuitemradio', { name: 'Source' }).click();
  await expect(page).toHaveURL(/(?:\?|&)group=provider(?:&|$)/);
  await expect(page.getByRole('row').filter({ hasText: 'Uploaded file' })).toBeVisible();

  await page.getByRole('button', { name: 'Add filter' }).click();
  await expect(page.getByRole('menuitem', { name: 'Name' })).toBeVisible();
  await page.keyboard.press('Escape');

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: 'Add filter' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Display · Source' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );

  const search = page.getByRole('searchbox', { name: 'Search the Library' });
  await search.fill('finder brief');
  await expect(page).toHaveURL(/(?:\?|&)q=finder\+brief(?:&|$)/);
  await expect(page.getByRole('grid', { name: 'Library search results' })).toBeVisible();
  await expect(page.getByRole('link', { name: FILE_NAME })).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: 'Uploaded file' })).toHaveCount(0);

  await search.fill('');
  await expect(page.getByRole('grid', { name: 'Library resources' })).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: 'Uploaded file' })).toBeVisible();
});
