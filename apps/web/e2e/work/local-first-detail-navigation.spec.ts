import { signUpAndOnboard } from '../helpers/app';
import { orgHref } from '../helpers/constants';
import { expect, test } from '../helpers/fixtures';
import { apiJson } from '../helpers/net';

/** Verify a list row paints its local snapshot while the only aggregate reconciliation is held. */
test('a task row paints locally without an RSC transition or speculative detail data', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const { orgId } = await signUpAndOnboard(page, 'LocalFirstNavigation');
  const teams = await apiJson<{ items: readonly { id: string }[] }>(
    page,
    `/v1/orgs/${orgId}/teams`,
  );
  const teamId = teams.items[0]?.id;
  if (!teamId) throw new Error('Onboarding did not create a team.');
  const title = 'Paint this task from the row snapshot';
  const task = await apiJson<{ id: string }>(page, `/v1/orgs/${orgId}/tasks`, {
    method: 'POST',
    body: { title, teamId },
  });

  await page.goto(orgHref(orgId, 'tasks'), { waitUntil: 'domcontentloaded' });
  const row = page.getByText(title, { exact: true }).first();
  await expect(row).toBeVisible();

  const aggregatePath = `/v1/orgs/${orgId}/tasks/${task.id}/aggregate-detail`;
  const postShellApiPaths: string[] = [];
  let rscRequests = 0;
  let releaseApi!: () => void;
  const apiHeld = new Promise<void>((resolve) => {
    releaseApi = resolve;
  });
  page.on('request', (request) => {
    if (/[?&]_rsc=/u.test(request.url())) rscRequests += 1;
  });
  await page.route('**/v1/**', async (route) => {
    postShellApiPaths.push(new URL(route.request().url()).pathname);
    await apiHeld;
    await route.continue();
  });

  try {
    await page.evaluate((entityTitle) => {
      const timing = { clickedAt: null as number | null, identityPaintAt: null as number | null };
      (window as unknown as Record<string, unknown>)['__localFirstNavigationTiming'] = timing;
      const observer = new MutationObserver(() => {
        if (timing.identityPaintAt !== null) return;
        const heading = Array.from(document.querySelectorAll('h1')).find(
          (candidate) => candidate.textContent === entityTitle,
        );
        if (heading === undefined) return;
        window.requestAnimationFrame(() => {
          timing.identityPaintAt ??= performance.now();
          observer.disconnect();
        });
      });
      observer.observe(document.body, { childList: true, subtree: true, characterData: true });
      window.addEventListener(
        'click',
        () => {
          timing.clickedAt = performance.now();
        },
        { capture: true, once: true },
      );
    }, title);
    await row.click();
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible({
      timeout: 200,
    });
    const identityPaintMs = await page.evaluate(() => {
      const timing = (window as unknown as Record<string, unknown>)['__localFirstNavigationTiming'];
      if (typeof timing !== 'object' || timing === null) return null;
      const { clickedAt, identityPaintAt } = timing as {
        readonly clickedAt: unknown;
        readonly identityPaintAt: unknown;
      };
      return typeof clickedAt === 'number' && typeof identityPaintAt === 'number'
        ? identityPaintAt - clickedAt
        : null;
    });
    if (identityPaintMs === null) throw new Error('The browser did not record the identity paint.');
    expect(identityPaintMs).toBeLessThan(200);
    await expect.poll(() => postShellApiPaths).toEqual([aggregatePath]);
    expect(rscRequests).toBe(0);
  } finally {
    releaseApi();
  }
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
});
