/** End-to-end proof that Initiative relationships remain first-class objects on detail pages. */
import type { Page } from '@playwright/test';

import { signUpAndOnboard } from '../helpers/app';
import { orgHref, TIMEOUTS } from '../helpers/constants';
import { expect, test } from '../helpers/fixtures';
import { apiJson } from '../helpers/net';

/** Create one row through the signed-in browser session and return its id. */
async function create(page: Page, path: string, body: unknown): Promise<string> {
  return (await apiJson<{ id: string }>(page, path, { method: 'POST', body })).id;
}

test('Initiative detail exposes hierarchy actions and object relationship tabs', async ({
  page,
}) => {
  const { orgId } = await signUpAndOnboard(page, 'InitiativeObjectness');
  const rootId = await create(page, `/v1/orgs/${orgId}/initiatives`, {
    name: 'Core infrastructure',
    summary: 'The systems every product builds on.',
  });
  const childId = await create(page, `/v1/orgs/${orgId}/initiatives`, {
    name: 'Membership portal',
  });
  const projectId = await create(page, `/v1/orgs/${orgId}/projects`, {
    name: 'Urbanist tech program startup',
  });
  await apiJson(page, `/v1/orgs/${orgId}/initiatives/hierarchy-links`, {
    method: 'POST',
    body: { parentInitiativeId: rootId, childInitiativeId: childId },
  });
  await apiJson(page, `/v1/orgs/${orgId}/initiatives/${rootId}/projects`, {
    method: 'POST',
    body: { projectId },
  });

  await page.goto(orgHref(orgId, `initiatives/${rootId}`), {
    waitUntil: 'domcontentloaded',
    timeout: TIMEOUTS.pageReady,
  });
  await expect(page.getByRole('heading', { name: 'Core infrastructure' })).toBeVisible({
    timeout: TIMEOUTS.pageReady,
  });

  const icon = page.getByRole('button', { name: 'Customize Core infrastructure icon' });
  await expect(icon).toBeVisible();
  await icon.click();
  await expect(page.getByRole('searchbox', { name: 'Search icons' })).toBeVisible();
  await page.keyboard.press('Escape');

  await page.getByRole('tab', { name: 'Sub-initiatives', exact: true }).click();
  const initiativeRow = page.locator(
    `[data-object-kind="initiative"][data-object-id="${childId}"]`,
  );
  await expect(initiativeRow).toBeVisible();
  await expect(initiativeRow.getByRole('link', { name: 'Membership portal' })).toBeVisible();
  await initiativeRow.click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Change parent…' })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Change parent…' }).click();
  await expect(page.getByRole('listbox', { name: 'Parent initiative' })).toBeVisible();
  await page.keyboard.press('Escape');

  await page.getByRole('tab', { name: 'Connected work', exact: true }).click();
  const projectRow = page.locator(`[data-object-kind="project"][data-object-id="${projectId}"]`);
  await expect(
    projectRow.getByRole('link', { name: 'Urbanist tech program startup' }),
  ).toBeVisible();

  const scroller = page.locator('[data-detail-panel-scroll]');
  await scroller.evaluate((element) => {
    element.scrollTop = 240;
    element.dispatchEvent(new Event('scroll'));
  });
  await expect(icon).toBeInViewport();
});
