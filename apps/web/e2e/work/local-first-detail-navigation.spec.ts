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
    const clickedAt = performance.now();
    await row.click();
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible({
      timeout: 200,
    });
    expect(performance.now() - clickedAt).toBeLessThan(200);
    expect(postShellApiPaths).toEqual([aggregatePath]);
    expect(rscRequests).toBe(0);
  } finally {
    releaseApi();
  }
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
});
