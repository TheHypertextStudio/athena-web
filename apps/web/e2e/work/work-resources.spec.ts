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
    const endpoint = `**/v1/orgs/${orgId}/work-resources/${kind}/${work.id}/upload`;
    const requestIds: string[] = [];
    if (kind === 'program') {
      await page.route(endpoint, async (route) => {
        const body = route.request().postDataBuffer()?.toString('utf8') ?? '';
        const id = /name="requestId"\r\n\r\n([^\r]+)/.exec(body)?.[1];
        requestIds.push(id ?? '');
        if (requestIds.length === 1) {
          await route.fulfill({
            status: 503,
            contentType: 'application/json',
            body: JSON.stringify({ type: 'about:blank', title: 'Unavailable', status: 503 }),
          });
        } else await route.continue();
      });
    }
    const fileName = `${kind}-context.txt`;
    const contents = `Acceptance fixture for ${kind} context`;
    await upload.focus();
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), upload.press('Enter')]);
    await chooser.setFiles({
      name: fileName,
      mimeType: 'text/plain',
      buffer: Buffer.from(contents),
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
      await page.unroute(endpoint);
    }
    const [download] = await Promise.all([page.waitForEvent('download'), file.click()]);
    const downloaded = info.outputPath(fileName);
    await download.saveAs(downloaded);
    expect(readFileSync(downloaded, 'utf8')).toBe(contents);
    await page.getByRole('button', { name: `Remove ${fileName}`, exact: true }).click();
    await expect(file).toHaveCount(0);
    await page.reload();
    await expect(page.getByText('No resources yet', { exact: true })).toBeVisible();
  }
});
