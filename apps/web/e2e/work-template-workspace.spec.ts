import type {
  WorkTemplateCopyReceipt,
  WorkTemplateGalleryPreview,
} from '@docket/work/template-gallery-contract';
import { expect, test } from './helpers/fixtures';
import { blueprintWorkspace, seedBlueprintTemplate } from './helpers/work-template-blueprints';
import { apiJson, waitForApiResponse } from './helpers/net';
import { TIMEOUTS } from './helpers/constants';

const session = process.env['E2E_WORK_TEMPLATE_SESSION'];
if (session) test.use({ storageState: session });

test('opens work definitions from workspace navigation and replaces legacy review links without a Back loop', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  const { orgId } = await blueprintWorkspace(page);
  const seeded = await seedBlueprintTemplate(page, orgId, 'project');
  const base = `/orgs/${orgId}/work-templates`;
  await page.goto(`${base}/gallery`, { waitUntil: 'commit', timeout: TIMEOUTS.pageReady });
  const expand = page.getByRole('button', { name: 'Expand navigation', exact: true });
  if (await expand.isVisible()) await expand.click();
  const destination = page
    .getByRole('navigation', { name: 'Workspace', exact: true })
    .getByRole('link', { name: 'Work templates', exact: true });
  await expect(destination).toHaveAttribute('href', base);
  await destination.click();
  await expect(page).toHaveURL(new RegExp(`${base}$`));
  await expect(page.getByRole('heading', { name: 'Work templates', exact: true })).toBeVisible();
  await expect(page.getByRole('main')).toHaveCount(1);
  await expect(destination).toHaveAttribute('aria-current', 'page');
  await expect
    .poll(() =>
      destination.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        const region = element
          .closest('[data-testid="sidebar-scroll-region"]')
          ?.getBoundingClientRect();
        return !!region && bounds.top >= region.top - 1 && bounds.bottom <= region.bottom + 1;
      }),
    )
    .toBe(true);
  await expect(page.getByRole('dialog', { name: 'Settings', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Who can author templates' })).toHaveCount(0);
  await expect(
    page.getByRole('link', { name: 'Choose starting work', exact: true }),
  ).toHaveAttribute('href', `${base}/gallery`);
  await page.goto(
    `/orgs/${orgId}/settings/templates/${seeded.publication.id}?section=review#definition-review`,
    { waitUntil: 'commit' },
  );
  await expect(page).toHaveURL(
    `${new URL(base, page.url()).origin}${base}/${seeded.publication.id}?section=review#definition-review`,
  );
  await expect(page.getByRole('tab', { name: 'Review', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByRole('dialog', { name: 'Settings', exact: true })).toHaveCount(0);
  await expect(destination).toHaveAttribute('aria-current', 'page');
  await page.goBack({ waitUntil: 'commit' });
  await expect(page).toHaveURL(new RegExp(`${base}$`));
  await expect(page.getByRole('heading', { name: 'Work templates', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Define work', exact: true }).click();
  await expect(page).toHaveURL(`${new URL(base, page.url()).origin}${base}/new`);
  await expect(page.getByRole('tab', { name: 'Purpose', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.reload({ waitUntil: 'commit' });
  await expect(page.getByRole('tab', { name: 'Purpose', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page
    .getByRole('navigation', { name: 'Work templates navigation', exact: true })
    .getByRole('link', { name: 'Work templates', exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`${base}$`));
  expect(errors).toEqual([]);
});

test('offers personal work definitions through the phone workspace drawer', async ({ page }) => {
  await blueprintWorkspace(page);
  const organizations = await apiJson<{ items: { id: string; isPersonal: boolean }[] }>(
    page,
    '/v1/orgs',
  );
  const personal = organizations.items.find((org) => org.isPersonal);
  if (!personal) throw new Error('The ceremony-created personal workspace is missing.');
  const base = `/orgs/${personal.id}/work-templates`;
  await page.setViewportSize({ width: 320, height: 600 });
  await page.goto(`/orgs/${personal.id}/my-work`, {
    waitUntil: 'commit',
    timeout: TIMEOUTS.pageReady,
  });
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await page
    .getByRole('navigation', { name: 'Workspace', exact: true })
    .getByRole('link', { name: 'Work templates', exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`${base}$`));
  await expect(page.getByRole('heading', { name: 'Work templates', exact: true })).toBeVisible();
  await expect(page.getByRole('main')).toHaveCount(1);
  await expect(page.getByRole('dialog', { name: 'Settings', exact: true })).toHaveCount(0);
  await expect(
    page.getByRole('link', { name: 'Choose starting work', exact: true }),
  ).toHaveAttribute('href', `${base}/gallery`);
  await expect(page.getByRole('link', { name: 'Define work', exact: true })).toHaveAttribute(
    'href',
    `${base}/new`,
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test.describe('touch work-definition journeys', () => {
  test.use({ hasTouch: true });

  test('guides a private Event through its Vendor booking publication before publishing the Event', async ({
    page,
  }) => {
    const { orgId } = await blueprintWorkspace(page);
    const choices = {
      release: 1,
      roots: ['event'],
      mode: 'private_drafts',
      labels: [],
      offerings: [],
    };
    const api = `/v1/orgs/${orgId}/templates/definitions`;
    const preview = await apiJson<WorkTemplateGalleryPreview>(page, `${api}/gallery/copy-preview`, {
      method: 'POST',
      body: choices,
    });
    const receipt = await apiJson<WorkTemplateCopyReceipt>(page, `${api}/gallery/copies`, {
      method: 'POST',
      body: {
        ...choices,
        requestId: crypto.randomUUID(),
        expectedReviewFingerprint: preview.reviewFingerprint,
      },
    });
    const event = receipt.roots[0];
    if (!event) throw new Error('The reviewed Event copy is missing.');
    const route = `/orgs/${orgId}/work-templates/${event.workTypeId}?section=review`;
    await page.setViewportSize({ width: 320, height: 600 });
    await page.goto(route, { waitUntil: 'commit', timeout: TIMEOUTS.pageReady });
    const prerequisite = page
      .getByRole('link', { name: 'Review Vendor booking', exact: true })
      .first();
    await expect(prerequisite).toBeInViewport();
    const included = page.getByRole('heading', { name: 'Included work', exact: true });
    const starting = page.getByRole('heading', { name: 'Starting work', exact: true });
    expect((await included.boundingBox())?.y).toBeLessThan((await starting.boundingBox())?.y ?? 0);
    const publish = page.getByRole('button', { name: 'Publish to workspace', exact: true });
    if (await publish.count()) await expect(publish).toBeDisabled();
    await prerequisite.click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Vendor booking', exact: true }),
    ).toBeVisible();
    const vendorPublished = waitForApiResponse(page, /\/publish$/, { method: 'POST' });
    await page.getByRole('button', { name: 'Publish to workspace', exact: true }).click();
    expect((await vendorPublished).ok()).toBe(true);
    await page
      .getByRole('navigation', { name: 'Work templates navigation', exact: true })
      .getByRole('link', { name: 'Back to parent definition', exact: true })
      .click();
    await expect(page).toHaveURL(`${new URL(route, page.url()).origin}${route}`);
    await expect(
      page.getByRole('button', { name: 'Publish to workspace', exact: true }),
    ).toBeEnabled();
    const eventPublished = waitForApiResponse(page, /\/publish$/, { method: 'POST' });
    await page.getByRole('button', { name: 'Publish to workspace', exact: true }).click();
    expect((await eventPublished).ok()).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });

  test('keeps a long resume action inside its touch target in both themes', async ({ page }) => {
    const { orgId } = await blueprintWorkspace(page);
    const name = 'Community dinners with neighborhood hosts and accessible volunteer support';
    await apiJson(page, `/v1/orgs/${orgId}/templates/definitions`, {
      method: 'POST',
      body: {
        targetType: 'project',
        scope: 'personal',
        definition: { name, payload: { targetType: 'project', name: 'Community dinner' } },
      },
    });
    await page.setViewportSize({ width: 320, height: 600 });
    await page.goto(`/orgs/${orgId}/work-templates`, {
      waitUntil: 'commit',
      timeout: TIMEOUTS.pageReady,
    });
    const resume = page.getByRole('link', { name: `Continue defining ${name}`, exact: true });
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
      await resume.scrollIntoViewIfNeeded();
      const geometry = await resume.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        const textBounds: DOMRect[] = [];
        while (walker.nextNode()) {
          if (!walker.currentNode.textContent?.trim()) continue;
          const range = document.createRange();
          range.selectNodeContents(walker.currentNode);
          textBounds.push(...range.getClientRects());
        }
        return {
          height: bounds.height,
          contained: textBounds.every(
            (text) =>
              text.top >= bounds.top - 1 &&
              text.bottom <= bounds.bottom + 1 &&
              text.left >= bounds.left - 1 &&
              text.right <= bounds.right + 1,
          ),
        };
      });
      expect(geometry.height).toBeGreaterThanOrEqual(40);
      expect(geometry.contained).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
  });
});
