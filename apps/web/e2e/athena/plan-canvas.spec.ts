/**
 * The planning canvas, end to end: a plan drafted through the API renders as draft nodes, a
 * project confirms into a real project with its tasks, and an initiative's detail page hands the
 * person onto the canvas.
 *
 * @remarks
 * Athena's own turns are not driven here — the loop needs a provider — so the plan is drafted the
 * way her tools draft it, through the same routes and reducer. What only a browser can prove is
 * the surface: containment, the inspector, the confirmation, and the entry point.
 */
import type { Page, Response, TestInfo } from '@playwright/test';
import { signUpAndOnboard } from '../helpers/app';
import { orgHref, TIMEOUTS } from '../helpers/constants';
import { expect, test } from '../helpers/fixtures';
import { apiFetch } from '../helpers/net';
import { renderedContrastRatio } from '../helpers/calendar-ui';
import { setColorScheme } from '../helpers/ui';
import { waitForCaptureAnimations } from '../tools/capture-animations';

const SEED_OPS = [
  {
    op: 'upsert_node',
    node: {
      ref: 'init',
      kind: 'initiative',
      fields: { title: 'Spring giving campaign', summary: 'Raise $120k by May.' },
    },
  },
  {
    op: 'upsert_node',
    node: {
      ref: 'p-outreach',
      kind: 'project',
      parentRef: 'init',
      fields: { title: 'Donor outreach' },
    },
  },
  {
    op: 'upsert_node',
    node: { ref: 'p-push', kind: 'project', parentRef: 'init', fields: { title: 'Two-week push' } },
  },
  {
    op: 'upsert_node',
    node: {
      ref: 't1',
      kind: 'task',
      parentRef: 'p-outreach',
      fields: { title: 'Segment lapsed donors' },
    },
  },
  {
    op: 'upsert_node',
    node: {
      ref: 't2',
      kind: 'task',
      parentRef: 'p-outreach',
      fields: { title: 'Write the appeal letter' },
    },
  },
  {
    op: 'upsert_node',
    node: {
      ref: 's1',
      kind: 'task',
      parentRef: 't2',
      fields: { title: 'Pull the donor merge fields' },
    },
  },
  { op: 'add_edge', fromRef: 'p-outreach', toRef: 'p-push' },
];

test.describe('Planning canvas', () => {
  test('renders a drafted plan, confirms a project, and opens from an initiative', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const runtimeErrors: string[] = [];
    page.on('pageerror', (error) => runtimeErrors.push(error.message));
    const { orgId } = await signUpAndOnboard(page, 'PlanCanvas');

    // --- Draft a plan the way Athena's tools do -------------------------------------------
    const started = await apiFetch(page, '/v1/me/plans', {
      method: 'POST',
      body: { organizationId: orgId, title: 'Spring giving campaign' },
    });
    expect(started.status, 'the plan should start').toBe(201);
    const planId = (started.body as { id: string }).id;
    const drafted = await apiFetch(page, `/v1/me/plans/${planId}`, {
      method: 'PATCH',
      body: { revision: 0, ops: SEED_OPS },
    });
    expect(drafted.status, 'the batch should apply').toBe(200);

    // --- The canvas shows the draft with tasks inside their project -----------------------
    await page.goto(orgHref(orgId, `plans/${planId}`), { waitUntil: 'domcontentloaded' });
    const outreach = page.locator('[data-plan-ref="p-outreach"]');
    await expect(outreach).toBeVisible({ timeout: TIMEOUTS.pageReady });
    await expect(outreach).toHaveAttribute('data-plan-status', 'draft');
    await expect(page.getByRole('navigation', { name: 'Workspace', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Open navigation', exact: true })).toHaveCount(0);
    const help = page.getByRole('button', { name: 'Ask Athena about this plan', exact: true });
    const conversation = page.getByRole('dialog', { name: 'Plan with Athena', exact: true });
    await expect(conversation).toBeHidden();
    await help.click();
    await expect(conversation).toBeVisible();
    expect((await conversation.boundingBox())?.width).toBe(448);
    const message = conversation.getByRole('combobox', { name: 'Message Athena' });
    await message.fill('Help me organize the outreach before the fundraising event.');
    await conversation.getByRole('button', { name: 'Back to plan', exact: true }).click();
    await expect(conversation).toBeHidden();
    await expect(help).toBeFocused();
    await help.click();
    await expect(message).toHaveValue(
      'Help me organize the outreach before the fundraising event.',
    );
    await page.keyboard.press('Escape');
    await expect(conversation).toBeHidden();

    // A container rests collapsed, naming its tasks in miniature; one click shows the rows.
    await expect(outreach.getByTestId('plan-mini-tasks')).toContainText('Segment lapsed donors');
    await expect(page.locator('[data-plan-ref="t1"]')).toBeHidden();
    await outreach.getByRole('button', { name: 'Show 2 tasks' }).first().click();
    await expect(page.locator('[data-plan-ref="t1"]')).toBeVisible();
    // A subtask is its own row, one level in beneath its feature task, folding with it.
    const subtask = page.locator('[data-plan-ref="s1"]');
    await expect(subtask).toBeVisible();
    await expect(subtask).toHaveAttribute('data-plan-depth', '1');
    const feature = page.locator('[data-plan-ref="t2"]');
    const featureBox = await feature.boundingBox();
    const subtaskBox = await subtask.boundingBox();
    expect(subtaskBox?.x ?? 0).toBeGreaterThan(featureBox?.x ?? 0);
    expect(subtaskBox?.y ?? 0).toBeGreaterThan(featureBox?.y ?? 0);
    await feature.getByTestId('plan-subtask-toggle').click();
    await expect(subtask).toBeHidden();
    await feature.getByTestId('plan-subtask-toggle').click();
    await expect(subtask).toBeVisible();
    // The chrome floats over the board: one bar as a region, and no band above the canvas.
    const bar = page.getByRole('region', { name: 'Plan' });
    await expect(bar).toBeVisible();
    await expect(bar.getByTestId('plan-counts')).toContainText('6 drafts');
    // Nothing selected, so no inspector column floats beside the board.
    await expect(page.getByRole('complementary', { name: 'Selection details' })).toHaveCount(0);

    // --- Selecting a project floats the inspector naming what Confirm creates -----------
    // The container's centre is a task row (its own node), so aim at the header band.
    await outreach.click({ position: { x: 120, y: 24 } });
    const inspector = page.getByRole('complementary', { name: 'Selection details' });
    await expect(inspector).toBeVisible({ timeout: TIMEOUTS.ui });
    await expect(inspector.locator('[data-presentation="floating"]')).toBeVisible();
    const confirm = inspector.getByRole('button', { name: /^Confirm/ });
    await expect(confirm).toHaveAttribute('title', /3 tasks/);
    await confirm.click();

    // --- The project and its tasks are real now; the initiative came along --------------
    await expect(outreach).toHaveAttribute('data-plan-status', 'confirmed', {
      timeout: TIMEOUTS.ui,
    });
    await expect(page.locator('[data-plan-ref="t1"]')).toHaveAttribute(
      'data-plan-status',
      'confirmed',
    );
    await expect(subtask).toHaveAttribute('data-plan-status', 'confirmed');
    await expect(page.locator('[data-plan-ref="p-push"]')).toHaveAttribute(
      'data-plan-status',
      'draft',
    );
    // One line names what the commit created, with Undo beside it.
    const result = page.getByTestId('plan-result');
    await expect(result).toHaveAttribute('data-phase', 'created');
    // Escape closes the floating inspector and clears the selection, which gives the counts
    // their place in the bar back.
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('plan-counts')).toContainText('1 draft', {
      timeout: TIMEOUTS.ui,
    });
    const projects = await apiFetch(page, `/v1/orgs/${orgId}/projects`);
    const names = (projects.body as { items: { name: string }[] }).items.map((p) => p.name);
    expect(names).toContain('Donor outreach');
    expect(names).not.toContain('Two-week push');

    // --- Undo reverses the whole commit and puts its nodes back in draft -----------------
    await result.getByRole('button', { name: 'Undo' }).click();
    await expect(result).toHaveAttribute('data-phase', 'undone', { timeout: TIMEOUTS.ui });
    await expect(result.getByRole('button', { name: 'Undo' })).toHaveCount(0);
    await expect(outreach).toHaveAttribute('data-plan-status', 'draft', { timeout: TIMEOUTS.ui });
    await expect(subtask).toHaveAttribute('data-plan-status', 'draft');
    const afterUndo = await apiFetch(page, `/v1/orgs/${orgId}/projects`);
    const remaining = (afterUndo.body as { items: { name: string }[] }).items.map((p) => p.name);
    expect(remaining).not.toContain('Donor outreach');

    // --- Plan with Athena on an initiative lands on that initiative's plan ---------------
    const initiative = await apiFetch(page, `/v1/orgs/${orgId}/initiatives`, {
      method: 'POST',
      body: { name: 'Brand refresh' },
    });
    expect(initiative.status, 'the initiative should create').toBe(201);
    const initiativeId = (initiative.body as { id: string }).id;
    await page.goto(orgHref(orgId, `initiatives/${initiativeId}`), {
      waitUntil: 'domcontentloaded',
    });
    const planAction = page.getByTestId('plan-with-athena');
    await expect(planAction).toBeVisible({ timeout: TIMEOUTS.pageReady });
    await planAction.click();
    await expect(page).toHaveURL(new RegExp(`/orgs/${orgId}/plans/[^/]+$`), {
      timeout: TIMEOUTS.pageReady,
    });
    const root = page.locator('[data-plan-ref="root"]');
    await expect(root).toBeVisible({ timeout: TIMEOUTS.pageReady });
    await expect(root).toHaveAttribute('data-plan-status', 'confirmed');
    // Explicit Plan with Athena enters contextual help, seeded with the opening line.
    const rail = page.getByRole('dialog', { name: 'Plan with Athena', exact: true });
    await expect(rail.getByRole('combobox', { name: 'Message Athena' })).toHaveValue(
      /Help me plan/,
      {
        timeout: TIMEOUTS.ui,
      },
    );
    expect(runtimeErrors).toEqual([]);
  });
});

test('phone search reveals a project from a newly opened plan', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const { orgId } = await signUpAndOnboard(page, 'PhonePlanSearch');
  for (let iteration = 0; iteration < 8; iteration += 1) {
    const started = await apiFetch(page, '/v1/me/plans', {
      method: 'POST',
      body: { organizationId: orgId, title: 'Spring giving campaign' },
    });
    const planId = (started.body as { id: string }).id;
    await apiFetch(page, `/v1/me/plans/${planId}`, {
      method: 'PATCH',
      body: { revision: 0, ops: SEED_OPS },
    });
    await page.goto(orgHref(orgId, `plans/${planId}`), { waitUntil: 'domcontentloaded' });
    if (iteration === 0) {
      await page.getByRole('button', { name: 'Ask Athena about this plan', exact: true }).click();
      const conversation = page.getByRole('dialog', { name: 'Plan with Athena', exact: true });
      await expect(conversation).toBeVisible();
      expect((await conversation.boundingBox())?.width).toBe(390);
      const contrast: Record<string, number> = {};
      for (const scheme of ['light', 'dark'] as const) {
        await setColorScheme(page, scheme);
        await conversation.evaluate((dialog) => getComputedStyle(dialog).backgroundColor);
        await waitForCaptureAnimations(page);
        contrast[scheme] = await renderedContrastRatio(
          conversation.getByText('Tell Athena what this plan needs.', { exact: true }),
        );
        expect(contrast[scheme]).toBeGreaterThanOrEqual(4.5);
      }
      await testInfo.attach('planning-contrast', {
        body: JSON.stringify(contrast),
        contentType: 'application/json',
      });
      await conversation.getByRole('combobox', { name: 'Message Athena' }).focus();
      await page.keyboard.press('Tab');
      await expect
        .poll(() => conversation.evaluate((dialog) => dialog.contains(document.activeElement)))
        .toBe(true);
      await page.keyboard.press('Shift+Tab');
      await expect
        .poll(() => conversation.evaluate((dialog) => dialog.contains(document.activeElement)))
        .toBe(true);
      await page.keyboard.press('Escape');
      await expect(conversation).toBeHidden();
      await expect(
        page.getByRole('button', { name: 'Ask Athena about this plan', exact: true }),
      ).toBeFocused();
      await setColorScheme(page, 'light');
    }
    await page.getByRole('button', { name: 'Fit to view', exact: true }).click();
    await page.getByRole('button', { name: 'Search the plan', exact: true }).click();
    await page
      .getByRole('textbox', { name: 'Search the plan', exact: true })
      .fill('Donor outreach');
    const target = page.locator('[data-plan-ref="p-outreach"]');
    try {
      await expect(target).toBeVisible({ timeout: 5000 });
      await target.getByRole('button', { name: 'Show 2 tasks' }).first().click();
      await expect(page.locator('[data-plan-ref="t1"]')).toBeVisible();
    } catch (error) {
      const layout = await page.locator('.react-flow').evaluate((canvas) => ({
        viewport: canvas.querySelector('.react-flow__viewport')?.getAttribute('style'),
        nodes: Array.from(canvas.querySelectorAll('.react-flow__node')).map((node) => ({
          id: node.getAttribute('data-id'),
          style: node.getAttribute('style'),
          box: node.getBoundingClientRect().toJSON(),
          text: node.textContent,
        })),
      }));
      await testInfo.attach('phone-search-layout', {
        body: JSON.stringify(layout, null, 2),
        contentType: 'application/json',
      });
      throw error;
    }
  }
});

/** Observe the parsed server surface before hydration so replacement cannot pass unnoticed. */
async function observeInitialActivity(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const observer = new MutationObserver(() => {
      const activity = document.querySelector('[data-navigation-context="activity"]');
      if (!activity) return;
      (window as Window & { initialPlanningSurface?: Element }).initialPlanningSurface = activity;
      observer.disconnect();
    });
    observer.observe(document, { childList: true, subtree: true });
  });
}

/** The first interaction must use the server-rendered surface without replacing its tree. */
async function expectActivityPreserved(page: Page): Promise<void> {
  expect(
    await page.evaluate(
      () =>
        (window as Window & { initialPlanningSurface?: Element }).initialPlanningSurface ===
        document.querySelector('[data-navigation-context="activity"]'),
    ),
    'first click preserved the server-rendered activity',
  ).toBe(true);
}

/** Verify the delivered document has ready metadata and begins with its actual activity. */
async function expectActivityDocument(
  page: Page,
  response: Response | null,
  testInfo: TestInfo,
): Promise<void> {
  expect(response, 'navigation delivered a server document').not.toBeNull();
  if (!response) throw new Error('Navigation did not deliver a server document.');
  const html = await response.text();
  await testInfo.attach('activity-server-document', { body: html, contentType: 'text/html' });
  const initial = await page.evaluate((markup) => {
    const document = new DOMParser().parseFromString(markup, 'text/html');
    return {
      title: document.head.querySelector('title')?.textContent,
      description: document.head.querySelector('meta[name="description"]')?.getAttribute('content'),
      competingMetadata: document.querySelector('body > div[hidden]:not([id])') !== null,
      activityPresent: document.querySelector('[data-navigation-context="activity"]') !== null,
    };
  }, html);
  expect(initial).toEqual({
    title: 'Docket',
    description: 'Keep task estimates, calendar placement, and tracked time together.',
    competingMetadata: false,
    activityPresent: true,
  });
}

test('archived plans explain their state after fresh loads in both layouts and themes', async ({
  page,
}, testInfo) => {
  await observeInitialActivity(page);
  const errors: string[] = [];
  let load = 'setup';
  page.on('pageerror', (error) => errors.push(`${load} pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`${load} console: ${message.text()}`);
  });
  const { orgId } = await signUpAndOnboard(page, 'ArchivedPlan');
  const started = await apiFetch(page, '/v1/me/plans', {
    method: 'POST',
    body: { organizationId: orgId, title: 'Spring giving campaign' },
  });
  const planId = (started.body as { id: string }).id;
  await apiFetch(page, `/v1/me/plans/${planId}`, {
    method: 'PATCH',
    body: { revision: 0, ops: SEED_OPS },
  });
  await apiFetch(page, `/v1/me/plans/${planId}/archive`, { method: 'POST' });
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    for (const scheme of ['light', 'dark'] as const) {
      load = `${viewport.width} ${scheme}`;
      await setColorScheme(page, scheme);
      await page.goto('about:blank');
      const response = await page.goto(orgHref(orgId, `plans/${planId}`), {
        waitUntil: 'domcontentloaded',
      });
      await expectActivityDocument(page, response, testInfo);
      await page.getByRole('button', { name: 'Search the plan', exact: true }).click();
      await expectActivityPreserved(page);
      await page
        .getByRole('textbox', { name: 'Search the plan', exact: true })
        .fill('Donor outreach');
      await page
        .locator('[data-plan-ref="p-outreach"] .group-hover\\:bg-surface-container-high')
        .click();
      await expect(
        page.getByText('This plan is archived. You can view its work here.', { exact: true }),
      ).toBeVisible();
      await expect(page.getByLabel('Title', { exact: true })).toBeDisabled();
    }
  }
  await testInfo.attach('archived-load-errors', {
    body: JSON.stringify(errors),
    contentType: 'application/json',
  });
  expect(
    errors.filter((error) =>
      /hydrat|server rendered HTML|didn.t match|hasn.t mounted yet/i.test(error),
    ),
  ).toEqual([]);
});
