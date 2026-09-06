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
import { signUpAndOnboard } from '../helpers/app';
import { orgHref, TIMEOUTS } from '../helpers/constants';
import { expect, test } from '../helpers/fixtures';
import { apiFetch } from '../helpers/net';

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
  { op: 'add_edge', fromRef: 'p-outreach', toRef: 'p-push' },
];

test.describe('Planning canvas', () => {
  test('renders a drafted plan, confirms a project, and opens from an initiative', async ({
    page,
  }) => {
    test.setTimeout(240_000);
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
    await expect(page.locator('[data-plan-ref="t1"]')).toBeVisible();
    await expect(page.getByTestId('plan-counts')).toContainText('2 projects');
    await expect(page.getByTestId('plan-counts')).toContainText('5 draft');

    // --- Selecting a project opens the inspector naming what Confirm creates -------------
    // The container's centre is a task row (its own node), so aim at the header band.
    await outreach.click({ position: { x: 120, y: 24 } });
    const confirm = page.getByRole('button', { name: /^Confirm/ }).first();
    await expect(confirm).toBeVisible({ timeout: TIMEOUTS.ui });
    await expect(confirm).toContainText('2 tasks');
    await confirm.click();

    // --- The project and its tasks are real now; the initiative came along --------------
    await expect(outreach).toHaveAttribute('data-plan-status', 'confirmed', {
      timeout: TIMEOUTS.ui,
    });
    await expect(page.locator('[data-plan-ref="t1"]')).toHaveAttribute(
      'data-plan-status',
      'confirmed',
    );
    await expect(page.locator('[data-plan-ref="p-push"]')).toHaveAttribute(
      'data-plan-status',
      'draft',
    );
    await expect(page.getByTestId('plan-counts')).toContainText('1 draft');
    const projects = await apiFetch(page, `/v1/orgs/${orgId}/projects`);
    const names = (projects.body as { items: { name: string }[] }).items.map((p) => p.name);
    expect(names).toContain('Donor outreach');
    expect(names).not.toContain('Two-week push');

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
  });
});
