/** Responsive browser proof for the strategic-object detail header contract. */
import { mkdirSync, writeFileSync } from 'node:fs';
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
] as const;

// A responsive evidence run needs the current bundle, not a prior run's cached detail payload.
test.use({ serviceWorkers: 'block' });

/** Create a Project rich enough to exercise every progressive metadata tier. */
async function createProject(page: Page, orgId: string): Promise<string> {
  const project = await apiJson<{ id: string }>(page, `/v1/orgs/${orgId}/projects`, {
    method: 'POST',
    body: {
      name: 'Week Without Driving 2026',
      summary: 'A short series to bring attention to car dependency.',
      status: 'planned',
      health: 'on_track',
      startDate: '2026-08-12',
      targetDate: '2026-10-10',
    },
  });
  return project.id;
}

/** Set one deterministic endpoint of the production scroll-linked header animation. */
async function setHeaderProgress(page: Page, progress: 0 | 1): Promise<void> {
  const scroller = page.locator('[data-detail-panel-scroll]');
  await scroller.evaluate((element, nextProgress) => {
    element.scrollTop = nextProgress === 0 ? 0 : 240;
  }, progress);
  // Let the production scroll listener consume the offset first, then pin the endpoint for the
  // screenshot so a resize/focus restoration cannot enqueue a stale animation frame afterward.
  await page.waitForTimeout(50);
  await scroller.evaluate((element, nextProgress) => {
    element.style.setProperty('--detail-collapse-progress', String(nextProgress));
    element.style.setProperty('--detail-collapse-delay', `${-nextProgress}s`);
    for (const animation of element.getAnimations({ subtree: true })) {
      if (!(animation instanceof CSSAnimation) || !animation.animationName.startsWith('detail-'))
        continue;
      animation.pause();
      animation.currentTime = nextProgress * 1000;
    }
  }, progress);
  await page.waitForTimeout(150);
}

test('Project header stays compact and operable across overflow widths', async ({ page }) => {
  test.setTimeout(240_000);
  mkdirSync(SHOT_ROOT, { recursive: true });

  const { orgId } = await signUpAndOnboard(page, 'ProjectDetailHeader');
  const projectId = await createProject(page, orgId);
  await page.goto(orgHref(orgId, `projects/${projectId}`), {
    waitUntil: 'commit',
    timeout: TIMEOUTS.pageReady,
  });
  await expect(page.getByRole('heading', { name: 'Week Without Driving 2026' })).toBeVisible({
    timeout: TIMEOUTS.pageReady,
  });

  const surface = page.locator(`[data-object-kind="project"][data-object-id="${projectId}"]`);
  await expect(surface).not.toHaveAttribute('draggable', 'true');

  const measurements: Record<string, unknown> = {};
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    await setColorScheme(page, 'light');
    await setHeaderProgress(page, 0);

    const metadata = page.getByRole('group', { name: 'Project properties' });
    // The print summary has an Owner cell for paper output. The interactive masthead keeps the
    // accountable owner in its own labelled row, outside the ordinary Project properties group.
    await expect(page.getByLabel('Project ownership')).toBeVisible();
    await expect(metadata.getByText('Owner', { exact: true })).toHaveCount(0);
    expect(
      await page
        .locator('.detail-secondary')
        .evaluate((element) => element.getBoundingClientRect().height),
    ).toBeGreaterThan(0);
    const layout = await metadata.evaluate((row) => {
      const inline = row.querySelector<HTMLElement>('[data-entity-metadata-inline]');
      const primary = row.closest('header')?.querySelector<HTMLElement>('.detail-primary');
      return {
        clientWidth: row.clientWidth,
        scrollWidth: row.scrollWidth,
        inlineClientWidth: inline?.clientWidth ?? 0,
        inlineScrollWidth: inline?.scrollWidth ?? 0,
        flexWrap: getComputedStyle(row).flexWrap,
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: innerWidth,
        primaryColumns: primary ? getComputedStyle(primary).gridTemplateColumns : '',
      };
    });
    expect(layout.flexWrap).toBe('nowrap');
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);
    expect(layout.inlineScrollWidth).toBeLessThanOrEqual(layout.inlineClientWidth);
    expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth);
    expect(layout.primaryColumns.split(' ').length).toBeGreaterThanOrEqual(2);

    const expanded = await page.locator('header.detail-header').evaluate((header) => {
      const mastheadContent = header.querySelector<HTMLElement>('.masthead-content');
      const glyph = header.querySelector<HTMLElement>('.detail-glyph');
      const title = header.querySelector<HTMLElement>('.detail-title');
      const actions = header.querySelector<HTMLElement>('.detail-actions');
      const titleField = title?.querySelector<HTMLElement>('textarea, span');
      const subtitle = header.querySelector<HTMLElement>(
        '.detail-secondary textarea, .detail-secondary span',
      );
      const mastheadContent = header.querySelector<HTMLElement>('.masthead-content');
      const tabs = header.querySelector<HTMLElement>('.detail-tabs');
      const metadataRow = header.querySelector<HTMLElement>('.entity-metadata-row');
      const bounds = (element: HTMLElement | null): DOMRect | null =>
        element?.getBoundingClientRect() ?? null;
      const metadataBounds = bounds(metadataRow);
      const tabBounds = bounds(tabs);
      const glyphBounds = bounds(glyph);
      const actionsBounds = bounds(actions);
      const primaryBounds = bounds(header.querySelector<HTMLElement>('.detail-primary'));
      const titleBounds = bounds(title);
      return {
        mastheadPaddingTop: Number.parseFloat(
          getComputedStyle(mastheadContent ?? header).paddingTop,
        ),
        glyphWidth: glyphBounds?.width ?? 0,
        glyphHeight: glyphBounds?.height ?? 0,
        glyphTop: glyphBounds?.top ?? 0,
        actionsTop: actionsBounds?.top ?? 0,
        titleRightGap: primaryBounds && titleBounds ? primaryBounds.right - titleBounds.right : 999,
        titleWhiteSpace: title ? getComputedStyle(title).whiteSpace : '',
        titleFullyVisible: titleField
          ? titleField.scrollHeight <= titleField.clientHeight + 1
          : false,
        subtitleFullyVisible: subtitle ? subtitle.scrollHeight <= subtitle.clientHeight + 1 : false,
        tabsGap: metadataBounds && tabBounds ? tabBounds.top - metadataBounds.bottom : 0,
      };
    });
    expect(expanded.mastheadPaddingTop).toBeGreaterThanOrEqual(20);
    expect(expanded.glyphWidth).toBeCloseTo(48, 0);
    expect(expanded.glyphHeight).toBeCloseTo(48, 0);
    expect(Math.abs(expanded.glyphTop - expanded.actionsTop)).toBeLessThanOrEqual(1);
    expect(expanded.titleRightGap).toBeLessThanOrEqual(1);
    expect(expanded.titleWhiteSpace).toBe('normal');
    expect(expanded.titleFullyVisible).toBe(true);
    expect(expanded.subtitleFullyVisible).toBe(true);
    expect(expanded.tabsGap).toBeGreaterThanOrEqual(16);

    measurements[`${viewport.width}`] = layout;
    await page.screenshot({
      path: resolve(SHOT_ROOT, `project-header-${viewport.width}x${viewport.height}-light.png`),
      caret: 'initial',
    });
  }

  await page.setViewportSize({ width: 320, height: 720 });
  await setColorScheme(page, 'light');
  await setHeaderProgress(page, 0);
  const moreProperties = page.getByRole('button', { name: 'More Project properties' });
  await moreProperties.focus();
  await expect(moreProperties).toBeFocused();
  await page.keyboard.press('Enter');
  const overflow = page.getByRole('group', { name: 'More Project properties' });
  await expect(overflow).toBeVisible();
  const startDate = overflow.getByRole('button', { name: /Start date/ });
  await expect(startDate).toBeVisible();
  const targetDate = overflow.getByRole('button', { name: /Target date/ });
  await expect(targetDate).toBeVisible();
  for (const dateTrigger of [startDate, targetDate]) {
    expect(
      await dateTrigger.evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true);
  }
  expect((await overflow.innerText()).includes('→')).toBe(false);
  const overflowBounds = await overflow.evaluate((element) => {
    const bounds = element.parentElement?.getBoundingClientRect();
    return { left: bounds?.left ?? -1, right: bounds?.right ?? innerWidth + 1 };
  });
  expect(overflowBounds.left).toBeGreaterThanOrEqual(0);
  expect(overflowBounds.right).toBeLessThanOrEqual(320);
  await page.waitForTimeout(200);
  await page.screenshot({
    path: resolve(SHOT_ROOT, 'project-header-320x720-overflow-light.png'),
    caret: 'initial',
  });
  await startDate.focus();
  await expect(startDate).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('grid', { name: 'Start date' })).toBeVisible();
  await page.waitForTimeout(200);
  await page.screenshot({
    path: resolve(SHOT_ROOT, 'project-header-320x720-start-picker-light.png'),
    caret: 'initial',
  });
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  await setHeaderProgress(page, 1);
  const compactAlignment = await page.locator('.detail-primary').evaluate((primary) => {
    const glyph = primary.querySelector<HTMLElement>('.detail-glyph');
    const title = primary.querySelector<HTMLElement>('.detail-title');
    const actions = primary.querySelector<HTMLElement>('.detail-actions');
    const top = (element: HTMLElement | null): number => element?.getBoundingClientRect().top ?? 0;
    return {
      glyphTop: top(glyph),
      titleTop: top(title),
      actionsTop: top(actions),
      height: primary.getBoundingClientRect().height,
    };
  });
  expect(Math.abs(compactAlignment.glyphTop - compactAlignment.actionsTop)).toBeLessThanOrEqual(1);
  expect(Math.abs(compactAlignment.titleTop - compactAlignment.actionsTop)).toBeLessThanOrEqual(1);

  await page.getByRole('button', { name: 'Project actions' }).click();
  await expect(page.getByRole('menuitem', { name: 'Repeat project' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Repeat project' })).toHaveCount(0);
  await page.keyboard.press('Escape');

  let darkStyles: Record<string, string> | undefined;
  for (const scheme of ['light', 'dark'] as const) {
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
    ] as const) {
      await page.setViewportSize(viewport);
      await setColorScheme(page, scheme);
      await setHeaderProgress(page, 0);
      if (scheme === 'dark' && viewport.width === 390) {
        darkStyles = await page.evaluate(() => {
          const owner = document.querySelector<HTMLElement>('button[aria-label^="Project owner"]');
          const inactiveTab = document.querySelector<HTMLElement>(
            '[role="tab"][aria-selected="false"]',
          );
          const action = document.querySelector<HTMLElement>('.detail-actions button');
          const probe = document.createElement('span');
          probe.style.cssText =
            'position:fixed;pointer-events:none;color:var(--on-surface);background:var(--surface-container-low)';
          document.body.append(probe);
          const probeStyle = getComputedStyle(probe);
          const expectedOnSurface = probeStyle.color;
          const expectedSurfaceLow = probeStyle.backgroundColor;
          probe.style.color = 'var(--on-surface-variant)';
          const expectedOnSurfaceVariant = getComputedStyle(probe).color;
          probe.remove();
          return {
            expectedSurfaceLow,
            expectedOnSurface,
            expectedOnSurfaceVariant,
            ownerBackground: owner ? getComputedStyle(owner).backgroundColor : '',
            ownerColor: owner ? getComputedStyle(owner).color : '',
            inactiveTabColor: inactiveTab ? getComputedStyle(inactiveTab).color : '',
            actionColor: action ? getComputedStyle(action).color : '',
          };
        });
        expect(darkStyles.ownerBackground).toBe(darkStyles.expectedSurfaceLow);
        expect(darkStyles.ownerColor).toBe(darkStyles.expectedOnSurfaceVariant);
        expect(darkStyles.inactiveTabColor).toBe(darkStyles.expectedOnSurfaceVariant);
        expect(darkStyles.actionColor).toBe(darkStyles.expectedOnSurface);
      }
      await page.screenshot({
        path: resolve(
          SHOT_ROOT,
          `project-header-${viewport.width}x${viewport.height}-${scheme}.png`,
        ),
        caret: 'initial',
      });
    }
  }

  await page.setViewportSize({ width: 320, height: 720 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);

  writeFileSync(
    resolve(SHOT_ROOT, 'measurements.json'),
    `${JSON.stringify({ measurements, compactAlignment, darkStyles }, null, 2)}\n`,
    'utf8',
  );
});
