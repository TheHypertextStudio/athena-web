/** Responsive local evidence for Initiative and Program detail identity and section navigation. */
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';

import { signUpAndOnboard } from '../helpers/app';
import { orgHref, TIMEOUTS } from '../helpers/constants';
import { expect, test } from '../helpers/fixtures';
import { apiJson } from '../helpers/net';
import { setColorScheme } from '../helpers/ui';

const SHOT_ROOT = resolve(
  import.meta.dirname,
  '../../../../apps/web/.data/design-review/entity-detail-header',
);

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 760, height: 900 },
  { width: 480, height: 844 },
  { width: 390, height: 844 },
  { width: 360, height: 800 },
  { width: 320, height: 720 },
] as const;

test.use({ serviceWorkers: 'block' });

interface DetailFixture {
  readonly kind: 'initiative' | 'program';
  readonly id: string;
  readonly name: string;
}

/** Seed the two document-first strategic entities and give each an independent display identity. */
async function createFixtures(page: Page, orgId: string): Promise<readonly DetailFixture[]> {
  const initiative = await apiJson<{ id: string }>(page, `/v1/orgs/${orgId}/initiatives`, {
    method: 'POST',
    body: { name: 'Zero emission access' },
  });
  const program = await apiJson<{ id: string }>(page, `/v1/orgs/${orgId}/programs`, {
    method: 'POST',
    body: { name: 'Frequent service program' },
  });
  await Promise.all([
    apiJson(page, `/v1/orgs/${orgId}/display/initiative/${initiative.id}`, {
      method: 'PUT',
      body: { iconKey: 'target', colorKey: 'purple', customColor: '#6d28d9' },
    }),
    apiJson(page, `/v1/orgs/${orgId}/display/program/${program.id}`, {
      method: 'PUT',
      body: { iconKey: 'layers', colorKey: 'teal', customColor: '#0f766e' },
    }),
  ]);
  return [
    { kind: 'initiative', id: initiative.id, name: 'Zero emission access' },
    { kind: 'program', id: program.id, name: 'Frequent service program' },
  ];
}

/** Verify one header stays within the viewport and keeps the active section visible. */
async function verifyHeader(page: Page, orgId: string, fixture: DetailFixture): Promise<void> {
  await page.goto(orgHref(orgId, `${fixture.kind}s/${fixture.id}`), {
    waitUntil: 'domcontentloaded',
    timeout: TIMEOUTS.pageReady,
  });
  await expect(page.getByRole('heading', { name: fixture.name })).toBeVisible({
    timeout: TIMEOUTS.pageReady,
  });

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    const tablist = page.getByRole('tablist').first();
    await expect(tablist).toBeVisible();
    const layout = await tablist.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: innerWidth,
      selectedVisible: Array.from(
        element.querySelectorAll<HTMLElement>('[role="tab"][aria-selected="true"]'),
      ).some((tab) => tab.offsetParent !== null),
    }));
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);
    expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth);
    expect(layout.selectedVisible).toBe(true);

    const more = page.getByRole('button', {
      name: `More ${fixture.kind === 'initiative' ? 'Initiative' : 'Program'} sections`,
    });
    if (await more.isVisible().catch(() => false)) {
      await more.focus();
      await expect(more).toBeFocused();
      await more.press('Enter');
      await expect(page.getByRole('menu')).toBeVisible();
      await page.keyboard.press('Escape');
    }
  }
}

test('Initiative and Program headers preserve identity and compact section access', async ({
  page,
}) => {
  test.setTimeout(240_000);
  mkdirSync(SHOT_ROOT, { recursive: true });
  const { orgId } = await signUpAndOnboard(page, 'EntityDetailHeaders');
  const fixtures = await createFixtures(page, orgId);

  for (const fixture of fixtures) await verifyHeader(page, orgId, fixture);

  for (const scheme of ['light', 'dark'] as const) {
    for (const fixture of fixtures) {
      for (const viewport of [
        { width: 1440, height: 900 },
        { width: 390, height: 844 },
      ] as const) {
        await page.setViewportSize(viewport);
        await setColorScheme(page, scheme);
        await page.goto(orgHref(orgId, `${fixture.kind}s/${fixture.id}`), {
          waitUntil: 'domcontentloaded',
          timeout: TIMEOUTS.pageReady,
        });
        await expect(page.getByRole('heading', { name: fixture.name })).toBeVisible();
        await page.screenshot({
          path: resolve(
            SHOT_ROOT,
            `${fixture.kind}-header-${viewport.width}x${viewport.height}-${scheme}.png`,
          ),
        });
      }
    }
  }
});
