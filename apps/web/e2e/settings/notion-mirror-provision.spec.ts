/**
 * The Notion mirror's full flow, end to end, against the in-memory provider.
 *
 * @remarks
 * A functional spec rather than a screenshot one: it proves that designing, provisioning and
 * projecting actually run — that the databases stop reporting "not created", that rows appear, and
 * that a second provision is idempotent rather than duplicating everything.
 *
 * It runs entirely on the mock mirror (`APP_MODE=local`), which is the point: the repo's
 * zero-external-accounts rule means this path has to be verifiable with no Notion workspace, no
 * OAuth app, and no network.
 */
import type { Page } from '@playwright/test';

import { signUpAndOnboard } from '../helpers/app';
import { apiFetch, apiJson } from '../helpers/net';
import { orgHref, TIMEOUTS } from '../helpers/constants';
import { expect, test } from '../helpers/fixtures';

/** Connect Notion, returning the integration id. */
async function connectNotion(page: Page, orgId: string): Promise<string> {
  const res = await apiFetch(page, `/v1/orgs/${orgId}/integrations`, {
    method: 'POST',
    body: { provider: 'notion', pattern: 'connector' },
  });
  if (!res.ok) throw new Error(`connect notion ${String(res.status)}`);
  return (res.body as { id: string }).id;
}

/** Give the workspace real rows so the projection has something to write. */
async function seedTasks(page: Page, orgId: string, count: number): Promise<void> {
  const teams = await apiJson<{ items: { id: string }[] }>(page, `/v1/orgs/${orgId}/teams`);
  const teamId = teams.items[0]?.id;
  if (teamId === undefined) throw new Error('onboarding produced no team');
  for (let i = 0; i < count; i += 1) {
    await apiJson(page, `/v1/orgs/${orgId}/tasks`, {
      method: 'POST',
      body: { title: `Projected task ${String(i + 1)}`, teamId },
    });
  }
}

interface MirrorDatabase {
  entityType: string;
  provisionedAt: string | null;
  externalDataSourceId: string | null;
  rowCount: number;
}

/** Read the designed databases. */
async function databases(page: Page, orgId: string, id: string): Promise<MirrorDatabase[]> {
  const res = await apiJson<{ items: MirrorDatabase[] }>(
    page,
    `/v1/orgs/${orgId}/integrations/${id}/notion/databases`,
  );
  return res.items;
}

test.describe('notion mirror provisioning', () => {
  test('designs, provisions, and projects real rows', async ({ page }) => {
    const { orgId } = await signUpAndOnboard(page, 'NotionProvision');
    const integrationId = await connectNotion(page, orgId);
    await seedTasks(page, orgId, 3);

    // Seeding happens on first read: nine designs, none of them claiming to exist in Notion.
    const designed = await databases(page, orgId, integrationId);
    expect(designed).toHaveLength(9);
    expect(designed.every((d) => d.provisionedAt === null)).toBe(true);
    expect(designed.every((d) => d.externalDataSourceId === null)).toBe(true);

    const parents = await apiJson<{ items: { id: string }[] }>(
      page,
      `/v1/orgs/${orgId}/integrations/${integrationId}/notion/parent-pages`,
    );
    const parentPageId = parents.items[0]?.id;
    expect(parentPageId).toBeDefined();

    const run = await apiJson<{ status: string; processed: number }>(
      page,
      `/v1/orgs/${orgId}/integrations/${integrationId}/notion/provision`,
      { method: 'POST', body: { containerPageId: parentPageId } },
    );
    // The run is a real sync_run on the shared spine, so a failure would be recorded rather than
    // reported as an optimistic success.
    expect(run.status).toBe('succeeded');

    const provisioned = await databases(page, orgId, integrationId);
    expect(provisioned.every((d) => d.provisionedAt !== null)).toBe(true);
    expect(provisioned.every((d) => d.externalDataSourceId !== null)).toBe(true);

    const tasks = provisioned.find((d) => d.entityType === 'task');
    expect(tasks?.rowCount).toBe(3);

    // Provisioning again must not create a second set of databases, because it is also the repair
    // path for a database somebody deleted in Notion.
    const before = provisioned.map((d) => d.externalDataSourceId).sort();
    await apiJson(page, `/v1/orgs/${orgId}/integrations/${integrationId}/notion/provision`, {
      method: 'POST',
      body: { containerPageId: parentPageId },
    });
    const after = (await databases(page, orgId, integrationId))
      .map((d) => d.externalDataSourceId)
      .sort();
    expect(after).toEqual(before);

    // And the hub reflects it: no longer "Not created yet".
    await page.goto(orgHref(orgId, 'settings/connections/notion'), {
      waitUntil: 'domcontentloaded',
    });
    await expect(page.getByText(/rows in 9 databases/)).toBeVisible({
      timeout: TIMEOUTS.pageReady,
    });
  });
});
