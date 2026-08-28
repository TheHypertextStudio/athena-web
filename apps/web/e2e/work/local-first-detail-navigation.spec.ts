import { signUpAndOnboard } from '../helpers/app';
import { orgHref } from '../helpers/constants';
import { expect, test } from '../helpers/fixtures';
import { apiJson } from '../helpers/net';

/** Verify explicit pointer intent warms the aggregate before the entity document opens. */
test('a task row opens from its prefetched aggregate without an RSC transition', async ({
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
  let rscRequests = 0;
  page.on('request', (request) => {
    if (/[?&]_rsc=/u.test(request.url())) rscRequests += 1;
  });
  const aggregateResponse = page.waitForResponse(
    (response) => new URL(response.url()).pathname === aggregatePath && response.ok(),
  );
  await row.hover();
  await aggregateResponse;

  await row.click();
  await expect(page.getByRole('textbox', { name: 'Task title', exact: true })).toHaveValue(title);
  await expect(page.getByRole('status', { name: 'Loading task' })).toHaveCount(0);
  expect(rscRequests).toBe(0);
});
