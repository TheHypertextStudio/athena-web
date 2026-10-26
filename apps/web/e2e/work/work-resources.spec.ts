import { readFileSync } from 'node:fs';
import { expect, test } from '../helpers/fixtures';
import { signUpAndOnboard } from '../helpers/app';
import { apiJson } from '../helpers/net';

const sessionPath = process.env['E2E_SESSION'];
if (sessionPath) test.use({ storageState: sessionPath });

test('people upload, retry, download and remove context on every work type', async ({
  page,
}, info) => {
  const { orgId } = sessionPath
    ? (JSON.parse(readFileSync(`${sessionPath}.meta.json`, 'utf8')) as { orgId: string })
    : await signUpAndOnboard(page, 'Work resources');
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const teams = await apiJson<{ items: { id: string }[] }>(page, `/v1/orgs/${orgId}/teams`);
  for (const kind of ['task', 'project', 'program', 'initiative'] as const) {
    const work = await apiJson<{ id: string }>(page, `/v1/orgs/${orgId}/${kind}s`, {
      method: 'POST',
      body:
        kind === 'task'
          ? { title: 'Acceptance fixture · Task context', teamId: teams.items[0]?.id }
          : { name: `Acceptance fixture · ${kind} context` },
    });
    await page.goto(`/orgs/${orgId}/${kind}s/${work.id}?tab=resources`, {
      waitUntil: 'domcontentloaded',
    });
    const upload = page.getByRole('button', { name: 'Upload file', exact: true });
    await expect(upload).toBeVisible({ timeout: 40_000 });
    const endpoint = `**/v1/orgs/${orgId}/uploads`;
    const byteEndpoint = `**/v1/file-uploads/*/bytes`;
    const offsets: number[] = [];
    const requestIds: string[] = [];
    if (kind === 'program') {
      await page.route(endpoint, async (route) => {
        requestIds.push((route.request().postDataJSON() as { requestId: string }).requestId);
        await route.continue();
      });
      await page.route(byteEndpoint, async (route) => {
        const start = Number(
          /bytes (\d+)-/.exec(route.request().headers()['content-range'] ?? '')?.[1],
        );
        offsets.push(start);
        if (offsets.length === 2) await route.fulfill({ status: 503 });
        else await route.continue();
      });
    }
    const fileName = `${kind}-context.txt`;
    const contents =
      kind === 'program'
        ? Buffer.alloc(12 * 1024 * 1024, 97)
        : Buffer.from(`Acceptance fixture for ${kind} context`);
    await upload.focus();
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), upload.press('Enter')]);
    await chooser.setFiles({
      name: fileName,
      mimeType: 'text/plain',
      buffer: contents,
    });
    if (kind === 'program') {
      await page.getByRole('button', { name: 'Try again', exact: true }).click();
    }
    const file = page.getByRole('link', { name: `Download ${fileName}`, exact: true });
    await expect(file).toBeVisible();
    if (kind === 'program') {
      expect(requestIds).toHaveLength(2);
      expect(requestIds[0]).not.toBe('');
      expect(requestIds[1]).toBe(requestIds[0]);
      expect(offsets).toEqual([0, 8 * 1024 * 1024, 8 * 1024 * 1024]);
      await page.unroute(endpoint);
      await page.unroute(byteEndpoint);
    }
    const [download] = await Promise.all([page.waitForEvent('download'), file.click()]);
    const downloaded = info.outputPath(fileName);
    await download.saveAs(downloaded);
    expect(readFileSync(downloaded)).toEqual(contents);
    await page.getByRole('button', { name: `Remove ${fileName}`, exact: true }).click();
    await expect(file).toHaveCount(0);
    await page.reload();
    await expect(page.getByText('No resources yet', { exact: true })).toBeVisible();
  }
});
