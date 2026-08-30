/**
 * Geometry evidence for the surfaces that stopped being side overlays.
 *
 * @remarks
 * Three presentations used to anchor themselves to a window edge: the Stream event drawer, the
 * shell's compact utility Sheet, and the graph inspectors. Stream's replacement is covered by the
 * functional journey in `e2e/stream.spec.ts`; the other two had **no** e2e coverage at all, which
 * is part of why the shell's 22rem side sheet survived three cleanup passes. This is that coverage.
 *
 * An evidence spec (`*-evidence.spec.ts`) because it is mostly here to capture the responsive
 * matrix for review — but it asserts the load-bearing geometry too, so a revert is red rather than
 * merely ugly. Run it with `pnpm test:e2e:evidence`.
 */
import { mkdirSync } from 'node:fs';

import type { Page } from '@playwright/test';

import { signUpAndOnboard } from '../helpers/app';
import { orgHref, TIMEOUTS } from '../helpers/constants';
import { expect, test } from '../helpers/fixtures';
import { apiJson } from '../helpers/net';
import { setColorScheme } from '../helpers/ui';

/** The compact utility pane's stable id, mirrored from `@docket/ui`'s `ShellAside`. */
const SHELL_ASIDE_SHEET_ID = 'shell-aside-sheet';

const SHOT_DIR = new URL(
  '../../../../docs/design/audits/screenshots/2026-08-30-side-overlay-removal/',
  import.meta.url,
).pathname;

/** Whether the document scrolls sideways — the responsive hard gate, at any width. */
async function hasHorizontalOverflow(page: Page): Promise<boolean> {
  return page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
}

test('the compact utility panel takes the whole window, not a strip beside it', async ({
  page,
}) => {
  mkdirSync(SHOT_DIR, { recursive: true });
  await signUpAndOnboard(page, 'UtilityPane');

  // 390 is the phone case; 820 is the tablet width where this pane has the most room to get its
  // geometry wrong and still look plausible.
  for (const { width, height } of [
    { width: 390, height: 844 },
    { width: 820, height: 900 },
  ]) {
    await page.setViewportSize({ width, height });
    await page.goto('/today', { waitUntil: 'domcontentloaded' });

    const trigger = page.getByRole('button', { name: /^Show / }).first();
    await expect(trigger).toBeVisible({ timeout: TIMEOUTS.pageReady });
    await trigger.click();

    // By id, not by `getByRole('dialog').first()`: the shell can have another dialog mounted
    // (onboarding nudges), and the first one in DOM order is not necessarily this pane.
    const pane = page.locator(`#${SHELL_ASIDE_SHEET_ID}`);
    await expect(pane).toBeVisible();

    // The whole point: the pane is the viewport, with no unreachable page strip beside it. Width
    // is asserted against `clientWidth` rather than the viewport size because `100vw` — the
    // geometry this replaced — includes the scrollbar gutter and would read as "correct" against
    // the raw viewport while overflowing the document.
    // Polled, because the pane still slides in: measuring on the first visible frame catches it
    // mid-transform and reads a partial offset that has nothing to do with its resting geometry.
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    await expect
      .poll(async () => {
        const box = await pane.boundingBox();
        return box === null ? null : { x: Math.round(box.x), width: Math.round(box.width) };
      })
      .toEqual({ x: 0, width: clientWidth });
    expect(await hasHorizontalOverflow(page)).toBe(false);

    // Its own app bar, with a way out that names what it closes.
    await expect(pane.locator('[data-testid="shell-utility-pane-bar"]')).toBeVisible();
    const close = pane.getByRole('button', { name: /^Close / });
    await expect(close).toBeVisible();

    for (const scheme of ['light', 'dark'] as const) {
      await setColorScheme(page, scheme);
      await page.screenshot({ path: `${SHOT_DIR}utility-pane-${String(width)}-${scheme}.png` });
    }

    await close.click();
    await expect(pane).toHaveCount(0);
  }
});

test('the graph inspector docks beside the canvas and covers it only when narrow', async ({
  page,
}) => {
  mkdirSync(SHOT_DIR, { recursive: true });
  const { orgId } = await signUpAndOnboard(page, 'GraphInspector');

  // A fresh account has no tasks, so the graph has nothing to select.
  const teams = await apiJson<{ items: { id: string }[] }>(page, `/v1/orgs/${orgId}/teams`);
  const teamId = teams.items[0]?.id;
  if (!teamId) throw new Error('The graph fixture requires the onboarding workspace team.');
  for (const title of ['Ship the beta', 'Prepare launch notes', 'Audit the migration path']) {
    await apiJson(page, `/v1/orgs/${orgId}/tasks`, { method: 'POST', body: { title, teamId } });
  }

  // 1440 gives the graph host room for a docked column; 1024 does not, because `<main>` is the
  // viewport minus 328px of chrome minus the rail — which is the whole reason the threshold is
  // measured on the host rather than on the window.
  for (const { width, height, expected } of [
    { width: 1440, height: 900, expected: 'docked' as const },
    { width: 1024, height: 800, expected: 'compact' as const },
  ]) {
    await page.setViewportSize({ width, height });
    await page.goto(orgHref(orgId, 'graph'), { waitUntil: 'domcontentloaded' });

    const node = page.locator('.react-flow__node').first();
    await expect(node).toBeVisible({ timeout: TIMEOUTS.pageReady });
    // Select through the context menu rather than a plain click. On this route a synthetic click
    // lands on the node's own open affordance and navigates to the task instead of selecting it —
    // long-standing behaviour of the graph, unrelated to where the inspector renders. The
    // right-click path goes through the same `onSelectNode` a real single click does.
    await node.click({ button: 'right' });
    await page.keyboard.press('Escape');

    const inspector = page.locator('[aria-label="Selection details"]');
    await expect(inspector).toBeVisible({ timeout: TIMEOUTS.sweep });

    // Neither presentation is a modal overlay — that is what changed.
    await expect(inspector).not.toHaveAttribute('role', 'dialog');

    const docked = page.getByRole('complementary', { name: 'Selection details' });
    if (expected === 'docked') {
      // A real column: a sibling of the canvas, so the graph keeps the rest of the row.
      await expect(docked).toBeVisible();
      const box = await inspector.boundingBox();
      expect(box?.width).toBeLessThan(width / 2);
    } else {
      // Covering, not shrinking — which is what lets the compact path skip a refit entirely.
      await expect(docked).toHaveCount(0);
    }
    expect(await hasHorizontalOverflow(page)).toBe(false);

    for (const scheme of ['light', 'dark'] as const) {
      await setColorScheme(page, scheme);
      await page.screenshot({
        path: `${SHOT_DIR}graph-${expected}-${String(width)}-${scheme}.png`,
      });
    }
  }
});
