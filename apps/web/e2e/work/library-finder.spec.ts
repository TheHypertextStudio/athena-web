/** End-to-end proof for Library search, context, downloads, and responsive controls. */
import type { Page } from '@playwright/test';

import { signUpAndOnboard } from '../helpers/app';
import { orgHref, TIMEOUTS } from '../helpers/constants';
import { expect, test } from '../helpers/fixtures';
import { apiFetch, apiJson } from '../helpers/net';

const FILE_NAME = 'Library finder brief.pdf';
const OFFSCREEN_FILE_NAME = 'Archived finder appendix.pdf';
const FILLER_COUNT = 55;
const INITIATIVE_NAME = 'Q3 finder launch';
const URL_ATTACHMENT_NAME = 'Launch provider folder';
const URL_ATTACHMENT_URL = 'https://example.com/library-provider-launch';
const CALENDAR_ATTACHMENT_NAME = 'Launch review calendar event';
const EXTERNAL_RESOURCE_URL = 'https://docs.google.com/document/d/libraryfinderexternal/edit';

test.use({ serviceWorkers: 'block' });

/** Wait for the asynchronous search projector to expose the uploaded attachment. */
async function waitForLibraryFile(page: Page, orgId: string, fileName: string): Promise<void> {
  await expect
    .poll(
      async () => {
        const result = await apiFetch(
          page,
          `/v1/orgs/${orgId}/search?kinds=attachment&q=${encodeURIComponent(fileName)}&limit=50`,
        );
        const items = (result.body as { items?: { title: string }[] }).items ?? [];
        return items.some((item) => item.title === fileName);
      },
      { timeout: TIMEOUTS.sweep, message: 'the uploaded file should reach Library search' },
    )
    .toBe(true);
}

/** Wait for one indexed Library row by title or provider URL. */
async function waitForLibraryResource(
  page: Page,
  orgId: string,
  query: string,
  expected: { readonly title?: string; readonly externalUrl?: string },
  kinds: 'attachment' | 'external_resource',
): Promise<void> {
  await expect
    .poll(
      async () => {
        const result = await apiFetch(
          page,
          `/v1/orgs/${orgId}/search?kinds=${kinds}&q=${encodeURIComponent(query)}&limit=50`,
        );
        const items =
          (result.body as { items?: { title: string; externalUrl: string | null }[] }).items ?? [];
        return items.some(
          (item) =>
            (expected.title === undefined || item.title === expected.title) &&
            (expected.externalUrl === undefined || item.externalUrl === expected.externalUrl),
        );
      },
      { timeout: TIMEOUTS.sweep, message: `${query} should reach Library search` },
    )
    .toBe(true);
}

/** Upload one small PDF through the authenticated file route. */
async function uploadLibraryFile(
  page: Page,
  orgId: string,
  taskId: string,
  fileName: string,
): Promise<void> {
  const upload = await page.request.post(`/v1/orgs/${orgId}/tasks/${taskId}/attachments/upload`, {
    multipart: {
      file: {
        name: fileName,
        mimeType: 'application/pdf',
        buffer: Buffer.from(`%PDF-1.4\n${fileName}\n%%EOF`),
      },
    },
  });
  expect(upload.ok(), `file upload should succeed, received ${String(upload.status())}`).toBe(true);
}

/** Add enough newer rows to place the first file beyond the initial 50-row cursor page. */
async function addFillerAttachments(page: Page, orgId: string, taskId: string): Promise<void> {
  const inputs = Array.from({ length: FILLER_COUNT }, (_, index) => ({
    kind: 'url',
    title: `Virtualized filler ${String(index).padStart(2, '0')}`,
    url: `https://example.com/library-virtualized-filler-${String(index)}`,
  }));
  for (let index = 0; index < inputs.length; index += 5) {
    await Promise.all(
      inputs.slice(index, index + 5).map((body) =>
        apiJson(page, `/v1/orgs/${orgId}/tasks/${taskId}/attachments`, {
          method: 'POST',
          body,
        }),
      ),
    );
  }
}

/** Wait until at least one full cursor page of filler attachments reaches search. */
async function waitForFillerPage(page: Page, orgId: string): Promise<void> {
  await expect
    .poll(
      async () => {
        const result = await apiFetch(
          page,
          `/v1/orgs/${orgId}/search?kinds=attachment&q=virtualized+filler&limit=50`,
        );
        return (result.body as { items?: unknown[] }).items?.length ?? 0;
      },
      { timeout: TIMEOUTS.sweep, message: 'filler attachments should fill the first cursor page' },
    )
    .toBe(50);
}

/** Prove the older file is absent from the cursor page that grouped browsing loads first. */
async function expectFileBeyondInitialCursor(page: Page, orgId: string): Promise<void> {
  const result = await apiFetch(page, `/v1/orgs/${orgId}/search?kinds=attachment&limit=50`);
  const titles = ((result.body as { items?: { title: string }[] }).items ?? []).map(
    (item) => item.title,
  );
  expect(titles).toContain(FILE_NAME);
  expect(titles).not.toContain(OFFSCREEN_FILE_NAME);
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
    body: {
      title: 'Verify Library resources',
      description: `[External provider brief](${EXTERNAL_RESOURCE_URL})`,
      teamId,
      projectId: project.id,
    },
  });
  await apiJson(page, `/v1/orgs/${orgId}/tasks/${task.id}/attachments`, {
    method: 'POST',
    body: { kind: 'url', title: URL_ATTACHMENT_NAME, url: URL_ATTACHMENT_URL },
  });
  await apiJson(page, `/v1/orgs/${orgId}/tasks/${task.id}/attachments`, {
    method: 'POST',
    body: {
      kind: 'calendar_event',
      title: CALENDAR_ATTACHMENT_NAME,
      externalId: 'calendar-event-library-finder',
    },
  });
  await uploadLibraryFile(page, orgId, task.id, OFFSCREEN_FILE_NAME);
  await addFillerAttachments(page, orgId, task.id);
  await uploadLibraryFile(page, orgId, task.id, FILE_NAME);
  await Promise.all([
    waitForLibraryFile(page, orgId, OFFSCREEN_FILE_NAME),
    waitForLibraryFile(page, orgId, FILE_NAME),
    waitForFillerPage(page, orgId),
    waitForLibraryResource(
      page,
      orgId,
      URL_ATTACHMENT_NAME,
      { title: URL_ATTACHMENT_NAME, externalUrl: URL_ATTACHMENT_URL },
      'attachment',
    ),
    waitForLibraryResource(
      page,
      orgId,
      CALENDAR_ATTACHMENT_NAME,
      { title: CALENDAR_ATTACHMENT_NAME },
      'attachment',
    ),
    waitForLibraryResource(
      page,
      orgId,
      'libraryfinderexternal',
      { externalUrl: EXTERNAL_RESOURCE_URL },
      'external_resource',
    ),
  ]);
  await expectFileBeyondInitialCursor(page, orgId);

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
  await expect(page.getByRole('link', { name: OFFSCREEN_FILE_NAME })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Display · Work context' })).toBeVisible();

  const search = page.getByRole('searchbox', { name: 'Search the Library' });
  await page.keyboard.press('ControlOrMeta+f');
  await expect(search).toBeFocused();
  await search.fill('archived finder appendix');
  await expect(page.getByRole('grid', { name: 'Library search results' })).toBeVisible();
  await expect(page.getByRole('link', { name: OFFSCREEN_FILE_NAME })).toBeVisible();
  await search.fill('');
  await expect(page.getByRole('grid', { name: 'Library resources' })).toBeVisible();

  await search.fill(URL_ATTACHMENT_NAME);
  const urlPopupEvent = page.waitForEvent('popup');
  await page.getByRole('link', { name: URL_ATTACHMENT_NAME }).click();
  const urlPopup = await urlPopupEvent;
  await expect(urlPopup).toHaveURL(URL_ATTACHMENT_URL);
  await urlPopup.close();

  await search.fill('libraryfinderexternal');
  const externalLink = page.locator(`a[href="${EXTERNAL_RESOURCE_URL}"]`);
  await expect(externalLink).toBeVisible();
  const externalPopupEvent = page.waitForEvent('popup');
  await externalLink.click();
  const externalPopup = await externalPopupEvent;
  await expect(externalPopup).toHaveURL(EXTERNAL_RESOURCE_URL);
  await externalPopup.close();

  await search.fill(CALENDAR_ATTACHMENT_NAME);
  const calendarLink = page.getByRole('link', { name: CALENDAR_ATTACHMENT_NAME });
  await expect(calendarLink).toHaveAttribute(
    'href',
    new RegExp(`/orgs/${orgId}/tasks/${task.id}\\?attachmentId=`),
  );
  await search.fill('');
  await expect(page).not.toHaveURL(/(?:\?|&)q=/);
  await expect(page.getByRole('grid', { name: 'Library resources' })).toBeVisible();

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
  await expect(
    page
      .getByRole('grid', { name: 'Library resources' })
      .locator('[role="row"][aria-expanded]')
      .first(),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Add filter' }).click();
  await expect(page.getByRole('menuitem', { name: 'Name' })).toBeVisible();
  await page.keyboard.press('Escape');

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: 'Add filter' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Display · Source' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );

  await page.keyboard.press('ControlOrMeta+f');
  await expect(search).toBeFocused();
  await search.fill('finder brief');
  await expect(page).toHaveURL(/(?:\?|&)q=finder\+brief(?:&|$)/);
  const searchResults = page.getByRole('grid', { name: 'Library search results' });
  await expect(searchResults).toBeVisible();
  await expect(page.getByRole('link', { name: FILE_NAME })).toBeVisible();
  await expect(searchResults.locator('[role="row"][aria-expanded]')).toHaveCount(0);

  await search.fill('');
  const browseResults = page.getByRole('grid', { name: 'Library resources' });
  await expect(browseResults).toBeVisible();
  await expect(browseResults.locator('[role="row"][aria-expanded]').first()).toBeVisible();

  await search.fill(CALENDAR_ATTACHMENT_NAME);
  await expect(calendarLink).toBeVisible();
  await calendarLink.click();
  await expect(page).toHaveURL(new RegExp(`/orgs/${orgId}/tasks/${task.id}\\?attachmentId=`));
});
