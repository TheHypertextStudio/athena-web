/** Browser proof that only detail pages with real content can own a scroll range. */
import type { Locator, Page } from '@playwright/test';

import { signUpAndOnboard } from '../helpers/app';
import { createMobileAuditFixture } from '../helpers/mobile-audit-fixture';
import { orgHref, TIMEOUTS } from '../helpers/constants';
import { expect, test } from '../helpers/fixtures';
import { apiJson } from '../helpers/net';

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 760, height: 900 },
  { width: 480, height: 844 },
  { width: 390, height: 844 },
] as const;

// The local audit uses freshly-created routes. A cached offline shell cannot prove their scroll
// ownership, so this browser test always exercises the live application response.
test.use({ serviceWorkers: 'block' });

/** Create enough real task rows for the Project document to exceed every test viewport. */
async function createLongProject(page: Page, orgId: string, teamId: string): Promise<string> {
  const project = await apiJson<{ id: string }>(page, `/v1/orgs/${orgId}/projects`, {
    method: 'POST',
    body: { name: 'Scroll owner project', teamId },
  });
  await Promise.all(
    Array.from({ length: 32 }, (_, index) =>
      apiJson(page, `/v1/orgs/${orgId}/tasks`, {
        method: 'POST',
        body: { title: `Long Project task ${String(index + 1)}`, teamId, projectId: project.id },
      }),
    ),
  );
  return project.id;
}

/** Return a short page's scrolling ancestors, excluding the detail scroller itself. */
async function scrollingAncestors(detail: Locator): Promise<string[]> {
  return detail.evaluate((element) => {
    const owners: string[] = [];
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      if (
        /(auto|scroll)/.test(style.overflowY) &&
        parent.scrollHeight > parent.clientHeight + 1
      ) {
        owners.push(parent.dataset.detailPanelScroll === '' ? 'entity-detail' : parent.tagName);
      }
    }
    return owners;
  });
}

/** Return every element in the detail tree that exposes a real vertical scroll range. */
async function scrollOwners(detail: Locator): Promise<string[]> {
  return detail.evaluate((element) => {
    const candidates = [element, ...element.querySelectorAll<HTMLElement>('*')];
    return candidates.flatMap((candidate) => {
      const style = getComputedStyle(candidate);
      if (
        /(auto|scroll)/.test(style.overflowY) &&
        candidate.scrollHeight > candidate.clientHeight + 1
      ) {
        return candidate.dataset.detailPanelScroll === '' ? ['entity-detail'] : [candidate.tagName];
      }
      return [];
    });
  });
}

/** Set an offset and read it back after the browser applies its scrollability constraints. */
async function assignAndReadScrollTop(detail: Locator, value: number): Promise<number> {
  return detail.evaluate((element, nextValue) => {
    element.scrollTop = nextValue;
    return element.scrollTop;
  }, value);
}

test('short detail pages do not scroll while long Project work owns the only detail scrollbar', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await signUpAndOnboard(page, 'EntityDetailScrollOwnership');
  const fixture = await createMobileAuditFixture(page);
  const longProjectId = await createLongProject(page, fixture.orgId, fixture.teamId);

  const shortRoutes = [
    `projects/${fixture.blockingProjectId}`,
    `teams/${fixture.teamId}`,
  ] as const;

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    for (const route of shortRoutes) {
      await page.goto(orgHref(fixture.orgId, route), {
        waitUntil: 'commit',
        timeout: TIMEOUTS.pageReady,
      });
      const detail = page.locator('[data-detail-panel-scroll]:visible');
      await expect(detail).toBeVisible({ timeout: TIMEOUTS.pageReady });
      const dimensions = await detail.evaluate((element) => ({
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
      }));
      expect(dimensions.scrollHeight).toBeLessThanOrEqual(dimensions.clientHeight + 1);
      expect(await assignAndReadScrollTop(detail, 40)).toBe(0);
      expect(await scrollingAncestors(detail)).toEqual([]);
    }

    await page.goto(orgHref(fixture.orgId, `projects/${longProjectId}`), {
      waitUntil: 'commit',
      timeout: TIMEOUTS.pageReady,
    });
    await expect(page.getByRole('heading', { name: 'Scroll owner project' })).toBeVisible({
      timeout: TIMEOUTS.pageReady,
    });
    await page.getByRole('tab', { name: 'Tasks', exact: true }).click();
    const longDetail = page.locator('[data-detail-panel-scroll]:visible');
    await expect(longDetail).toBeVisible();
    await expect.poll(() => scrollOwners(longDetail)).toEqual(['entity-detail']);
  }
});
