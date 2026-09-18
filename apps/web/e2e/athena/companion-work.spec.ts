import type { Locator, Page, Route } from '@playwright/test';

import { signUpAndOnboard } from '../helpers/app';
import { expect, test } from '../helpers/fixtures';

/**
 * Press the Athena shortcut until the panel it reveals is on screen.
 *
 * @remarks
 * The shortcut is bound on hydration, so a single press right after a navigation can land before
 * anything is listening. The handler reveals rather than toggles, so pressing again is harmless.
 */
async function openAthenaPanel(page: Page, panel: Locator): Promise<void> {
  await expect(async () => {
    await page.keyboard.press('Meta+J');
    await expect(panel).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 60_000 });
}

const createdAt = '2026-09-18T09:00:00.000Z';
const decidedAt = '2026-09-18T09:05:00.000Z';

/** An empty, settled conversation — what `GET /v1/orgs/:orgId/sessions/chat` answers with. */
const emptyThread = {
  id: 'athena_companion_work_thread',
  kind: 'chat',
  status: 'completed',
  objective: 'Chat',
  startedAt: createdAt,
  endedAt: createdAt,
  createdAt,
  activities: [],
  result: null,
} as const;

/** The one job the fixture drives through its whole lifecycle: proposal, decision, receipt. */
interface JobFixture {
  readonly jobId: string;
  readonly objective: string;
}

/**
 * Install the personal Athena API fixture for one job that starts `awaiting_approval` with a
 * gated action, and moves to `completed` with a receipt once its decision activity is approved.
 *
 * @remarks
 * The fixture is stateful: a `decided` flag flips when the decision `PUT` lands, and every
 * subsequent read (`pulse`, the queue, the detail) reflects the new lifecycle state — mirroring
 * what `useAthenaActions`' re-read of the detail, and the queue invalidation that follows it,
 * actually observe against the real API. Also serves an empty org chat thread and an empty
 * elicitation list so nothing on the page falls through to the real backend.
 */
async function installAthenaFixture(page: Page, orgId: string): Promise<JobFixture> {
  const jobId = 'athena_companion_work_job';
  const activityId = 'athena_companion_work_decision';
  const objective = 'Move the printing tasks to next cycle';
  let decided = false;

  function rawSummary(): Readonly<Record<string, unknown>> {
    return {
      id: jobId,
      kind: 'job',
      status: decided ? 'completed' : 'awaiting_approval',
      queueState: decided ? 'finished' : 'needs_you',
      objective,
      context: { workspaceId: orgId },
      workspace: { id: orgId, name: 'Personal workspace' },
      startedAt: createdAt,
      endedAt: decided ? decidedAt : null,
      createdAt,
    };
  }

  function rawDetail(): Readonly<Record<string, unknown>> {
    const proposal = {
      id: activityId,
      sessionId: jobId,
      organizationId: orgId,
      type: 'action',
      approvalStatus: decided ? 'applied' : 'proposed',
      body: { action: { kind: 'update', summary: 'Move 2 printing tasks to next cycle' } },
      createdAt,
    };
    const receipt = {
      id: 'athena_companion_work_receipt',
      sessionId: jobId,
      organizationId: null,
      type: 'response',
      body: { text: 'Moved the printing tasks to next cycle.' },
      createdAt: decidedAt,
    };
    return {
      ...rawSummary(),
      activities: decided ? [proposal, receipt] : [proposal],
    };
  }

  /** `GET /v1/me/athena/pulse` — the ambient count the shell's rail status reads. */
  function pulseBody(): Readonly<Record<string, unknown>> {
    return { needsYou: decided ? 0 : 1, working: 0 };
  }

  /** `GET /v1/me/athena` — the grouped queue every reader (rail, strip, ledger) shares. */
  function queueBody(): Readonly<Record<string, unknown>> {
    const summary = rawSummary();
    const openLane = decided ? [] : [summary];
    const finishedLane = decided ? [summary] : [];
    return {
      counts: { needsYou: openLane.length, working: 0, finished: finishedLane.length },
      currentChat: null,
      sessions: { needsYou: openLane, working: [], finished: finishedLane },
    };
  }

  const detailPath = `/v1/me/athena/sessions/${jobId}`;
  const decisionPath = `${detailPath}/activity/${activityId}/decision`;

  /** Match one `/v1/me/athena**` request to the fixed body it should answer with, if any. */
  function athenaRouteBody(method: string, path: string): Readonly<Record<string, unknown>> | null {
    if (method === 'GET' && path === '/v1/me/athena/pulse') return pulseBody();
    if (method === 'GET' && path === '/v1/me/athena') return queueBody();
    if (method === 'GET' && path === detailPath) return rawDetail();
    if (method === 'PUT' && path === decisionPath) {
      decided = true;
      return { ok: true };
    }
    return null;
  }

  await page.route('**/v1/me/athena**', async (route: Route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const body = athenaRouteBody(request.method(), path);
    if (body === null) {
      await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });

  await page.route('**/v1/orgs/*/sessions/chat', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(emptyThread),
    });
  });

  // Nothing on the page should reach the real elicitation queue for this journey; an empty list
  // keeps the pending-questions surface quiet, and any non-GET call (the presence heartbeat) gets
  // a harmless 200 since that mutation's own errors are deliberately ignored.
  await page.route('**/v1/me/elicitations**', async (route: Route) => {
    const request = route.request();
    if (request.method() === 'GET' && new URL(request.url()).pathname === '/v1/me/elicitations') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [] }),
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  return { jobId, objective };
}

test('delegated work is decided in the thread, and the ledger finds it after', async ({ page }) => {
  const { orgId } = await signUpAndOnboard(page, 'companion-work');
  const { objective } = await installAthenaFixture(page, orgId);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/today');

  const rail = page.getByRole('complementary', { name: 'Athena' });
  await openAthenaPanel(page, rail);

  // The Working strip pins the one open job above the thread.
  await expect(rail.getByRole('button', { name: /Working · 1/ })).toBeVisible();

  // The same job is a card in the thread, named by its objective.
  const railJobCard = rail.getByRole('article', { name: objective });
  await expect(railJobCard).toBeVisible();

  // Its first decision option is Approve — clicking it settles the gated action.
  await railJobCard.getByRole('button', { name: 'Approve' }).click();

  // The queue invalidation this triggers carries the job out of both open lanes: the strip has
  // nothing left to pin, so it renders nothing at all.
  await expect(rail.getByRole('button', { name: /Working/ })).toHaveCount(0);

  // The card stays put and now shows the finished receipt.
  await expect(railJobCard.getByRole('heading', { name: /Work finished/i })).toBeVisible();

  // The wide view reads the same queue: the job now lives in the Done lane.
  await page.goto(`/athena?workspace=${orgId}`);
  const ledger = page.getByRole('navigation', { name: 'Athena work' });
  await ledger.getByRole('tab', { name: /Done/ }).click();

  const doneRow = ledger.getByRole('button', { name: objective });
  await expect(doneRow).toBeVisible();
  await doneRow.click();

  // Clicking the row scrolls the thread's own card into view rather than opening a second one.
  // Scoped to the page's main landmark: the docked utility rail also renders its own copy of the
  // same job card from the same queue, and at this width it is present beside `<main>` too.
  const wideJobCard = page.getByRole('main').getByRole('article', { name: objective });
  await expect(wideJobCard).toBeVisible();
});
