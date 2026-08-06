import type { Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { signUpAndOnboard } from '../helpers/app';
import { expect, test } from '../helpers/fixtures';
import { apiJson } from '../helpers/net';

/**
 * A whole offline session, end to end: an edit made with no connection, kept on screen, surviving a
 * reload, and reaching the server on its own once the connection returns — plus the route document
 * the worker serves for a reload with no network.
 *
 * @remarks
 * Every step here is a claim that was false before this work. An offline edit used to fail outright,
 * the banner used to say changes could not be saved, and reloading a route offline used to render a
 * generic waiting-room page. All three are asserted against a real browser, a real service worker,
 * real IndexedDB and the real API.
 *
 * It also captures the evidence screenshots — two viewports, both colour schemes — because a claim
 * about what a person is told is a claim about pixels.
 *
 * **One assertion is deliberately weaker against the dev stack than it would be in production, and
 * the reason is worth stating rather than hiding.** In development the worker passes `/_next/static`
 * straight through instead of caching it, because Turbopack rebuilds those URLs in place and caching
 * them would serve stale code. So an offline *reload* against `pnpm dev` receives the cached document
 * and then cannot fetch the scripts that would hydrate it: the shell is present in the DOM but never
 * paints. This spec therefore asserts the document is the app's own shell (and specifically not the
 * offline page) rather than asserting it is interactive. Against a production build the same reload
 * hydrates, because `/_next/static` is content-hashed and cache-first there.
 */

/** Where the evidence screenshots land. Gitignored, like every other capture in `.data`. */
const SHOTS = join(process.cwd(), '.data/pwa/offline-sync');

/** The task shape the assertions need back from the API. */
interface TaskRow {
  readonly id: string;
  readonly title: string;
}

test.describe('offline reads, offline writes, and sync on reconnect', () => {
  test('queues an edit made offline, shows it as pending, and syncs it on reconnect', async ({
    page,
    context,
  }) => {
    mkdirSync(SHOTS, { recursive: true });
    const { orgId } = await signUpAndOnboard(page, 'pwa-sync');

    // A task to work with, created the way a person would.
    const title = `Offline subject ${String(Date.now())}`;
    await page.goto(`/orgs/${orgId}/tasks`);
    await page.getByRole('button', { name: 'New task' }).click();
    await page.getByPlaceholder('Task title').fill(title);
    await page.getByRole('button', { name: 'Create task' }).click();
    await expect(page.getByText(title)).toBeVisible();

    // Open the task's own page while online. A route never visited online genuinely cannot come
    // back offline, and this spec does not pretend otherwise.
    await page.getByRole('link', { name: title }).first().click();
    await expect(page.locator('#main-content')).toBeVisible();
    const detailUrl = new URL(page.url()).pathname;
    // Visited twice more: the very first authenticated navigation lands before the shell has told
    // the worker who is signed in, and the worker stores nothing until it knows.
    for (const route of ['/today', detailUrl, detailUrl]) {
      await page.goto(route);
      await expect(page.locator('#main-content')).toBeVisible();
    }
    // The query persister throttles its writes by a second; give it its beat.
    await page.waitForTimeout(2_000);

    await context.setOffline(true);
    try {
      // ---- An edit with no connection, on the page already open. ----
      const renamed = `${title} offline edit`;
      const heading = page.getByRole('textbox', { name: /title/i }).first();
      await heading.fill(renamed);
      await heading.press('Enter');

      // It stays on screen: the optimistic cache is kept, not rolled back. Asserted on the
      // field's value rather than page text — the title is an `<input>`, so `getByText` would not
      // see it whether or not the edit survived.
      await expect(heading).toHaveValue(renamed);

      // And the app says where the change is and what happens next.
      const indicator = page.getByTestId('offline-sync-indicator');
      await expect(indicator).toBeVisible();
      await expect(indicator).toContainText('Saved on this device');
      await expect(indicator).toContainText('back online');
      await indicator.getByRole('button', { name: 'Show changes' }).click();
      await expect(page.getByTestId('pending-sync-marker').first()).toContainText('Pending sync');

      await captureEvidence(page);

      // ---- The route document comes back for a reload with no network. ----
      // `domcontentloaded`: see the note at the top of this file for why `load` never fires here.
      await page.reload({ waitUntil: 'domcontentloaded' });
      const served = await page.content();
      expect(served, 'the worker should serve the app shell, not the offline page').toContain(
        'id="main-content"',
      );
      expect(served).not.toContain('Docket can&#x27;t load this page without a connection');

      // ---- And the change reaches the server with nobody doing anything. ----
      await context.setOffline(false);
      await page.reload();
      await expect(page.locator('#main-content')).toBeVisible();

      // Polled against the server, not against the indicator. "The queue looks empty" is not
      // evidence the write landed — an outbox that has not finished loading also looks empty — so
      // the assertion that matters asks the API what it actually holds.
      await expect
        .poll(
          async () => {
            const server = await apiJson<{ items: TaskRow[] }>(page, `/v1/orgs/${orgId}/tasks`);
            return server.items.map((task) => task.title);
          },
          { timeout: 90_000, message: 'the queued rename should reach the server on its own' },
        )
        .toContain(renamed);

      // Only then is an empty queue meaningful.
      await expect(page.getByTestId('offline-sync-indicator')).toHaveCount(0);
    } finally {
      await context.setOffline(false);
    }
  });
});

/** The standard shot set: two viewports, both colour schemes. */
async function captureEvidence(page: Page): Promise<void> {
  for (const viewport of [
    { label: '1440x900', width: 1440, height: 900 },
    { label: '390x844', width: 390, height: 844 },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.waitForTimeout(400);
      await page.screenshot({ path: join(SHOTS, `offline-sync-${viewport.label}-${scheme}.png`) });
    }
  }
  await page.emulateMedia({ colorScheme: 'light' });
  await page.setViewportSize({ width: 1440, height: 900 });
}
