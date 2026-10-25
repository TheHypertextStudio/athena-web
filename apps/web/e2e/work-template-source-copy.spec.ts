import type { Locator, Page } from '@playwright/test';
import { WorkTemplateOut } from '@docket/work/work-template-contract';
import {
  WorkTemplateCopyReceipt,
  type WorkTemplateGalleryPreview,
} from '@docket/work/template-gallery-contract';
import { WorkTemplateSourceCopyAcceptRequest } from '@docket/work/template-copy';
import { expect, test } from './helpers/fixtures';
import { signUpAndOnboard } from './helpers/app';
import { apiJson, waitForApiResponse } from './helpers/net';
import { visitBlueprintDailyPlanner } from './helpers/work-template-blueprints';
import { hasVisibleKeyboardFocus, renderedContrastRatio } from './helpers/calendar-ui';
import { TIMEOUTS } from './helpers/constants';

const session = process.env['E2E_WORK_TEMPLATE_SESSION'];
if (session) test.use({ storageState: session });

async function createWorkspace(page: Page, name: string): Promise<string> {
  const created = await apiJson<{ organization: { id: string } }>(page, '/v1/orgs', {
    method: 'POST',
    body: { name, isPersonal: false, intent: 'nonprofit', vocabulary: 'startup' },
  });
  return created.organization.id;
}
async function sourceFixture(page: Page) {
  await page.goto('/today', { waitUntil: 'commit', timeout: TIMEOUTS.pageReady });
  if (!session) await signUpAndOnboard(page, 'SourceCopy');
  await visitBlueprintDailyPlanner(page);
  const suffix = String(Date.now());
  const sourceOrg = await createWorkspace(page, `Community planning ${suffix}`);
  const destination = await createWorkspace(page, `Neighborhood programs ${suffix}`);
  const path = `/v1/orgs/${sourceOrg}/templates/definitions`;
  const request = { roots: ['event'], release: 1, mode: 'published', labels: [], offerings: [] };
  const preview = await apiJson<WorkTemplateGalleryPreview>(page, `${path}/gallery/copy-preview`, {
    method: 'POST',
    body: request,
  });
  const installed = await apiJson<WorkTemplateCopyReceipt>(page, `${path}/gallery/copies`, {
    method: 'POST',
    body: {
      ...request,
      requestId: crypto.randomUUID(),
      expectedReviewFingerprint: preview.reviewFingerprint,
    },
  });
  const root = installed.roots[0];
  if (!root) throw new Error('Missing actual Event publication');
  const template = WorkTemplateOut.parse(await apiJson(page, `${path}/${root.workTypeId}`));
  const saved = WorkTemplateOut.parse(
    await apiJson(page, `${path}/${root.workTypeId}/draft`, {
      method: 'PATCH',
      body: {
        expectedRevision: template.revision,
        definition: {
          ...(template.draftDefinition ?? template.definition),
          name: 'Community event draft',
        },
      },
    }),
  );
  return { sourceOrg, destination, template: saved, publication: root.workTypeVersionId };
}
type SourceFixture = Awaited<ReturnType<typeof sourceFixture>>;
async function scale(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  await expect(page.locator('body')).toHaveCSS('font-size', '32px');
}
async function assertControl(page: Page, control: Locator): Promise<void> {
  await expect(control).toBeEnabled();
  await control.scrollIntoViewIfNeeded();
  await control.focus();
  expect(await hasVisibleKeyboardFocus(page, control)).toBe(true);
  const bounds = await control.boundingBox();
  expect(Math.min(bounds?.width ?? 0, bounds?.height ?? 0)).toBeGreaterThanOrEqual(40);
  expect(bounds?.x).toBeGreaterThanOrEqual(0);
  expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(
    page.viewportSize()?.width ?? 0,
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}
async function enterCopy(page: Page, fixture: SourceFixture, publication = false): Promise<void> {
  await page.goto(
    `/orgs/${fixture.sourceOrg}/work-templates/${fixture.template.id}?section=review`,
    { waitUntil: 'commit', timeout: TIMEOUTS.pageReady },
  );
  await page.setViewportSize({ width: 320, height: 600 });
  if (publication) {
    await page.getByRole('button', { name: 'Published history', exact: true }).press('Enter');
    await page.getByRole('button', { name: 'Version 1', exact: true }).press('Enter');
  } else await page.getByRole('button', { name: 'Manage template', exact: true }).press('Enter');
  await page
    .getByRole('button', {
      name: publication ? 'Copy version 1' : 'Copy to a workspace',
      exact: true,
    })
    .press('Enter');
  await expect(
    page.getByRole('heading', { name: 'Copy a work template', exact: true }),
  ).toBeVisible();
  await scale(page);
  await page
    .getByLabel('Destination workspace', { exact: false })
    .selectOption(fixture.destination);
  const review = page.getByRole('button', { name: 'Review copy', exact: true });
  await assertControl(page, review);
  await review.press('Enter');
  await expect(
    page.getByRole('heading', { name: 'Review selected templates', exact: true }),
  ).toBeVisible();
  await scale(page);
}
async function keepPrivate(page: Page) {
  const copyURL = page.url();
  const keep = page.getByRole('button', { name: 'Keep private drafts', exact: true });
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    await assertControl(page, keep);
    expect(await renderedContrastRatio(keep)).toBeGreaterThanOrEqual(4.5);
  }
  const saved = waitForApiResponse(page, /\/templates\/definitions\/copies$/, { method: 'POST' });
  await keep.press('Enter');
  const response = await saved;
  expect(response.ok()).toBe(true);
  const receipt = WorkTemplateCopyReceipt.parse(await response.json());
  await expect(
    page.getByRole('heading', { name: 'Private drafts kept', exact: true }),
  ).toBeVisible();
  const metadata = await page.evaluate(() =>
    Object.entries(sessionStorage)
      .filter(([key]) => key.startsWith('docket:source-copy:'))
      .map(([, value]) => value)
      .join(''),
  );
  expect(metadata).not.toMatch(/definition|payload|Community event draft/);
  return { copyURL, receipt };
}
async function reviewBundleAndUndo(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Open drafts', exact: true }).press('Enter');
  const dependency = page.getByRole('link', { name: 'Review Vendor booking', exact: true });
  await expect(dependency).toBeVisible();
  await scale(page);
  await assertControl(page, dependency);
  await dependency.press('Enter');
  await page.getByRole('link', { name: 'Back to saved templates', exact: true }).press('Enter');
  const undo = page.getByRole('button', { name: 'Undo this copy', exact: true });
  await expect(undo).toBeVisible();
  await scale(page);
  await assertControl(page, undo);
  await undo.press('Enter');
  await expect(
    page.getByRole('heading', { name: 'This copy was undone', exact: true }),
  ).toBeVisible();
}

test('copies a saved draft by keyboard, reconciles before reading its archived source, and undoes the canonical bundle', async ({
  page,
}) => {
  const fixture = await sourceFixture(page);
  await enterCopy(page, fixture);
  await expect(
    page.getByRole('button', { name: 'Inspect Community event draft', exact: true }),
  ).toBeVisible();
  const { copyURL, receipt } = await keepPrivate(page);
  await apiJson(
    page,
    `/v1/orgs/${fixture.sourceOrg}/templates/definitions/${fixture.template.id}/archive`,
    { method: 'POST' },
  );
  const sourceReads: string[] = [];
  page.on('request', (request) => {
    if (
      request.method() === 'GET' &&
      new URL(request.url()).pathname ===
        `/v1/orgs/${fixture.sourceOrg}/templates/definitions/${fixture.template.id}`
    )
      sourceReads.push(request.url());
  });
  await page.reload({ waitUntil: 'commit' });
  await expect(
    page.getByRole('heading', { name: 'Private drafts kept', exact: true }),
  ).toBeVisible();
  expect(sourceReads).toEqual([]);
  await reviewBundleAndUndo(page);
  await page.goto(copyURL, { waitUntil: 'commit' });
  await expect(
    page.getByRole('heading', { name: 'This copy was undone', exact: true }),
  ).toBeVisible();
  const actual = await apiJson<{ receipt: WorkTemplateCopyReceipt }>(
    page,
    `/v1/orgs/${fixture.destination}/templates/definitions/copies/${receipt.bundleId}`,
  );
  expect(actual.receipt.state).toBe('undone');
  await page.getByRole('button', { name: 'Start another copy', exact: true }).press('Enter');
  await expect(
    page.getByText('This saved template is no longer available to copy.', { exact: true }),
  ).toBeVisible();
});

test('copies the explicitly chosen publication snapshot instead of the later saved draft', async ({
  page,
}) => {
  const fixture = await sourceFixture(page);
  await enterCopy(page, fixture, true);
  await expect(page.getByRole('button', { name: 'Inspect Event', exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Inspect Community event draft', exact: true }),
  ).not.toBeVisible();
  await page.getByLabel('Who can see these templates', { exact: false }).selectOption('published');
  const publish = page.getByRole('button', { name: 'Publish to workspace', exact: true });
  await assertControl(page, publish);
  const saved = waitForApiResponse(page, /\/templates\/definitions\/copies$/, { method: 'POST' });
  await publish.press('Enter');
  const response = await saved;
  expect(response.ok()).toBe(true);
  expect(
    WorkTemplateSourceCopyAcceptRequest.parse(response.request().postDataJSON()).roots[0],
  ).toEqual({
    kind: 'publication',
    organizationId: fixture.sourceOrg,
    workTypeId: fixture.template.id,
    selection: { kind: 'pinned', workTypeVersionId: fixture.publication },
  });
  await expect(
    page.getByRole('heading', { name: 'Templates ready to use', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'View templates', exact: true }).press('Enter');
  await expect(page).toHaveURL(new RegExp(`/orgs/${fixture.destination}/work-templates$`));
  await expect(
    page.getByRole('heading', { name: 'Work templates', level: 1, exact: true }),
  ).toBeVisible();
});

test.describe('long reviewed template names', () => {
  test.use({ hasTouch: true });
  test('keeps a wrapped source title inside its action and above its summary', async ({ page }) => {
    const fixture = await sourceFixture(page);
    await apiJson(
      page,
      `/v1/orgs/${fixture.sourceOrg}/templates/definitions/${fixture.template.id}/draft`,
      {
        method: 'PATCH',
        body: {
          expectedRevision: fixture.template.revision,
          definition: {
            ...(fixture.template.draftDefinition ?? fixture.template.definition),
            name: 'Updated neighborhood event',
          },
        },
      },
    );
    await enterCopy(page, fixture);
    const inspect = page.getByRole('button', {
      name: 'Inspect Updated neighborhood event',
      exact: true,
    });
    for (const textScale of ['100%', '200%']) {
      await page.evaluate((value) => {
        document.documentElement.style.fontSize = value;
      }, textScale);
      const label = await inspect
        .getByText('Updated neighborhood event', { exact: true })
        .boundingBox();
      const button = await inspect.boundingBox();
      const summary = await page
        .getByText('Project · 8 included items', { exact: true })
        .boundingBox();
      if (!label || !button || !summary) throw new Error('Missing reviewed template geometry');
      expect(label.y + label.height).toBeLessThanOrEqual(button.y + button.height);
      expect(summary.y).toBeGreaterThanOrEqual(label.y + label.height);
      const affordance = await inspect.locator('span[aria-hidden="true"]').boundingBox();
      if (!affordance) throw new Error('Missing Inspect affordance');
      expect(affordance.x + affordance.width).toBeLessThanOrEqual(button.x + button.width);
    }
    await inspect.press('Enter');
    await expect(
      page.getByRole('heading', { name: 'Updated neighborhood event', exact: true }),
    ).toBeVisible();
  });
});
