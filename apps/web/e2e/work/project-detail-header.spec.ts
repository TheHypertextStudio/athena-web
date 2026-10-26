/** Browser acceptance for project identity, essential context and progressive properties. */
import { readFileSync } from 'node:fs';
import type { Locator, Page } from '@playwright/test';
import axe, { type AxeStatic } from 'axe-core';
import { signUpAndOnboard } from '../helpers/app';
import { openPlan } from '../helpers/daily-planning';
import { expect, test } from '../helpers/fixtures';
import { apiJson } from '../helpers/net';
import { waitForCaptureAnimations } from '../tools/capture-animations';

const sessionPath = process.env['E2E_SESSION'];
if (sessionPath) test.use({ storageState: sessionPath });
test.use({ serviceWorkers: 'block' });

/** Use the standard saved session or create the same real local account when run independently. */
async function workspace(page: Page): Promise<string> {
  const { orgId } = sessionPath
    ? (JSON.parse(readFileSync(`${sessionPath}.meta.json`, 'utf8')) as { orgId: string })
    : await signUpAndOnboard(page, 'Project header');
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await apiJson(page, '/v1/hub/preferences', { method: 'PATCH', body: { timezone: 'UTC' } });
  await openPlan(page, new Date().toISOString().slice(0, 10));
  return orgId;
}

/** Assert that a control is genuinely painted within its containing header. */
async function visibleInHeader(control: Locator): Promise<void> {
  await expect(control).toBeVisible();
  expect(
    await control.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const header = element.closest('header')?.getBoundingClientRect();
      return Boolean(
        header &&
        box.left >= header.left - 1 &&
        box.right <= header.right + 1 &&
        box.bottom <= header.bottom + 1,
      );
    }),
  ).toBe(true);
}

/** Check real geometry, accessible controls and settled themes at one pane width. */
async function verifyHeaderAtWidth(page: Page, width: number): Promise<void> {
  const title = page.getByRole('heading', { name: 'Station access review', exact: true });
  const actions = page.getByRole('button', { name: 'Project actions', exact: true });
  const metadata = page.getByRole('group', { name: 'Project properties', exact: true });
  await page.setViewportSize({ width, height: 844 });
  const device = await page.context().newCDPSession(page);
  await device.send('Emulation.setTouchEmulationEnabled', {
    enabled: width < 640,
    maxTouchPoints: 1,
  });
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    await waitForCaptureAnimations(page);
    for (const name of [
      /^Project owner/,
      /^Status —/,
      /^Health —/,
      /^Start date —/,
      /^Target date —/,
    ]) {
      await visibleInHeader(metadata.getByRole('button', { name }));
    }
    const [titleBox, actionsBox] = await Promise.all([title.boundingBox(), actions.boundingBox()]);
    if (!titleBox || !actionsBox) throw new Error('Project identity is missing.');
    expect(actionsBox.y).toBeLessThan(titleBox.y + titleBox.height);
    expect(actionsBox.x).toBeGreaterThanOrEqual(titleBox.x + titleBox.width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
      false,
    );
    expect(
      await page
        .locator('header')
        .evaluateAll((headers) =>
          headers.every((header) => header.scrollWidth <= header.clientWidth + 1),
        ),
    ).toBe(true);
    await page.addScriptTag({ content: axe.source });
    expect(
      await page.evaluate(
        async () =>
          (
            await (window as unknown as { axe: AxeStatic }).axe.run('header.detail-header', {
              runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] },
            })
          ).violations,
      ),
    ).toEqual([]);
    if (width < 640) {
      expect(
        await metadata.getByRole('button').evaluateAll((buttons) =>
          buttons.every((button) => {
            const box = button.getBoundingClientRect();
            return box.height >= 40 && box.width >= 40;
          }),
        ),
      ).toBe(true);
    }
  }
}

test('project header keeps essential context visible and secondary details in named controls', async ({
  page,
}) => {
  const orgId = await workspace(page);
  const project = await apiJson<{ id: string }>(page, `/v1/orgs/${orgId}/projects`, {
    method: 'POST',
    body: {
      name: 'Station access review',
      summary: 'Share the completed access review.',
      status: 'planned',
      health: 'on_track',
      startDate: '2026-10-26',
      targetDate: '2026-11-30',
    },
  });
  await page.goto(`/orgs/${orgId}/projects/${project.id}?tab=updates`, {
    waitUntil: 'domcontentloaded',
  });
  await expect(
    page.getByRole('heading', { name: 'Station access review', exact: true }),
  ).toBeVisible();
  const actions = page.getByRole('button', { name: 'Project actions', exact: true });
  for (const width of [1440, 760, 390, 320]) await verifyHeaderAtWidth(page, width);
  expect(await page.getByRole('button', { name: /^Program —/ }).count()).toBe(0);
  await page.getByRole('button', { name: 'Properties', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: /^Program —/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Initiatives —/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Labels —/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Properties', exact: true })).toBeFocused();
  await expect(page.getByText('Blank project', { exact: true })).toHaveCount(0);
  await actions.click();
  await expect(page.getByText('Blank project', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('menu')).toContainText('Work type');
  await expect(page.getByRole('menu')).not.toContainText('Version');
  await expect(page.getByRole('menuitem', { name: 'Change work type' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Repeat project' })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Type definition details', exact: true }).click();
  const definition = page.getByRole('dialog', { name: 'Type definition details' });
  await expect(definition).toContainText('Definition revision 1');
  await definition.getByRole('button', { name: 'Save as template', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Save as template' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(actions).toBeFocused();
  if (sessionPath) await page.context().storageState({ path: sessionPath });
});

test('long project names and unset essential fields remain usable on a phone', async ({ page }) => {
  const orgId = await workspace(page);
  const name = 'Community transit town hall and station accessibility follow-through';
  const project = await apiJson<{ id: string }>(page, `/v1/orgs/${orgId}/projects`, {
    method: 'POST',
    body: { name },
  });
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto(`/orgs/${orgId}/projects/${project.id}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Description', exact: true })).toBeVisible();
  await expect(
    page.getByRole('textbox', { name: 'Description', exact: true }).locator('.is-editor-empty'),
  ).toHaveAttribute('data-placeholder', 'Describe this work and why it matters…');
  for (const label of [
    /^Project owner/,
    /^Status —/,
    /^Health —/,
    /^Start date —/,
    /^Target date —/,
  ]) {
    await visibleInHeader(
      page
        .getByRole('group', { name: 'Project properties', exact: true })
        .getByRole('button', { name: label }),
    );
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});

test('description leads Overview, saves through reload and keeps real parent navigation above identity', async ({
  page,
}) => {
  const orgId = await workspace(page);
  const program = await apiJson<{ id: string }>(page, `/v1/orgs/${orgId}/programs`, {
    method: 'POST',
    body: { name: 'Neighborhood access and community conversations' },
  });
  const project = await apiJson<{ id: string }>(page, `/v1/orgs/${orgId}/projects`, {
    method: 'POST',
    body: {
      name: 'Rider town hall',
      programId: program.id,
      description:
        'Bring riders and transit staff together to identify the most useful station access changes.\n\nLeave with a short list of priorities and an owner for each next step.',
    },
  });
  await page.goto(`/orgs/${orgId}/projects/${project.id}`, { waitUntil: 'domcontentloaded' });
  const trail = page.getByRole('navigation', { name: 'Breadcrumb', exact: true });
  const parent = trail.getByRole('link', {
    name: 'Neighborhood access and community conversations',
  });
  await expect(parent).toHaveAttribute('href', `/orgs/${orgId}/programs/${program.id}`);
  const description = page.getByRole('region', { name: 'Description', exact: true });
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    const collection = trail.getByRole('link', { name: 'Programs', exact: true });
    if (width === 1440) await expect(collection).toBeVisible();
    else await expect(collection).toBeHidden();
    await expect(parent).toBeVisible();
    const [breadcrumbBox, titleBox, descriptionBox, updateBox] = await Promise.all([
      trail.boundingBox(),
      page.getByRole('heading', { name: 'Rider town hall', exact: true }).boundingBox(),
      description.boundingBox(),
      page.getByRole('heading', { name: 'Latest update', exact: true }).boundingBox(),
    ]);
    if (!breadcrumbBox || !titleBox || !descriptionBox || !updateBox)
      throw new Error('Project context missing');
    expect(breadcrumbBox.y + breadcrumbBox.height).toBeLessThanOrEqual(titleBox.y);
    expect(descriptionBox.y + descriptionBox.height).toBeLessThanOrEqual(updateBox.y);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
      false,
    );
  }
  const saved = page.waitForResponse(
    (response) =>
      response.request().method() === 'PATCH' &&
      response.url().includes(`/projects/${project.id}`) &&
      response.ok(),
  );
  await description
    .getByRole('textbox', { name: 'Description', exact: true })
    .fill('Riders will agree the station access priorities and next steps.');
  await parent.focus();
  await saved;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(description).toContainText(
    'Riders will agree the station access priorities and next steps.',
  );
  await parent.click();
  await expect(page).toHaveURL(new RegExp(`/programs/${program.id}`));
});
