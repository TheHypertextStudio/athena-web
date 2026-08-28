import { type Page, expect } from '@playwright/test';

import { signUpAndOnboard } from '../helpers/app';
import { test } from '../helpers/fixtures';

/**
 * Installability and offline behaviour, end to end against the running dev stack.
 *
 * @remarks
 * These specs need no account: everything asserted here — the manifest, the worker, the caching
 * rules, the offline fallback — is the same for a signed-out visitor as a signed-in one, and
 * deliberately so. Offline support has to be installed *before* it is needed, so the worker
 * registers on every route rather than only inside the authenticated shell.
 *
 * The suite runs against the same production build shape the deployment serves. That makes the
 * production worker's complete static precache part of the contract: an offline route can stay in
 * the running app only when the route's code is already available to the client router.
 *
 * Each spec starts from a clean slate — an installed worker from a previous spec would otherwise
 * decide the result of the next one.
 */

/**
 * Load a page and wait until a freshly installed worker is controlling it — and until the app's
 * own reaction to that has settled.
 *
 * @remarks
 * No unregister/reset step, deliberately. Playwright gives every test its own browser context with
 * its own storage, so each spec already starts with no worker and no caches — and an explicit reset
 * was actively harmful: after `unregister()` the page keeps its old controller until it navigates,
 * so a `controller` check could not tell the outgoing worker from the incoming one and the specs
 * raced each other.
 *
 * On a cold context the worker installs, activates, and calls `clients.claim()`, which is what
 * makes `controller` become non-null — so waiting on it is an exact signal rather than a guess.
 *
 * That signal is not the end of the story, though: `ServiceWorkerProvider` listens for the exact
 * same `controllerchange` event and reacts to it with `window.location.reload()` — including this
 * very first claim on a cold context, not only a later update. Returning as soon as `controller`
 * is set handed callers a page whose own reload could still be in flight, racing whatever they did
 * next: `page.evaluate` landing on a destroyed execution context, an explicit `page.reload()`
 * aborting against one the app already started. The `load` listener below is armed BEFORE the
 * `waitForFunction` resolves, so it catches a reload that starts the instant the controller
 * becomes truthy, and this does not return until that reload (if any) has actually finished.
 */
async function loadControlled(page: Page, path: string): Promise<void> {
  await page.goto(path);
  const appReload = page.waitForEvent('load', { timeout: 20_000 }).catch(() => undefined);
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), null, {
    timeout: 20_000,
  });
  await appReload;
}

/** Wait for the production worker's static manifest to finish populating Cache Storage. */
async function waitForProductionPrecache(page: Page): Promise<void> {
  const workerSource = await (await page.request.get('/sw.js')).text();
  const expected = new Set(
    [...workerSource.matchAll(/["'](\/_next\/static\/[^"']+)["']/g)]
      .flatMap((match) => (match[1] ? [match[1]] : []))
      .filter((path) => !path.endsWith('/')),
  ).size;
  expect(expected, 'the production worker should publish a static manifest').toBeGreaterThan(0);

  await expect
    .poll(
      async () => {
        const caches = await cacheContents(page);
        const staticEntry = Object.entries(caches).find(([name]) =>
          name.startsWith('docket-static-'),
        );
        return staticEntry ? new Set(staticEntry[1]).size : 0;
      },
      { message: 'the production worker should finish its static precache', timeout: 30_000 },
    )
    .toBe(expected);
}

/** Load an authenticated shell only after the worker knows its account and its build is ready. */
async function loadControlledForAccount(page: Page, path: string): Promise<void> {
  await loadControlled(page, path);
  await expect
    .poll(
      async () =>
        Object.entries(await cacheContents(page))
          .filter(([name]) => name === 'docket-identity')
          .flatMap(([, paths]) => paths),
      { message: 'the app should publish its account identity to the worker' },
    )
    .toContain('/__docket-offline-identity');
  await waitForProductionPrecache(page);

  // The worker learns the account from the already-rendered shell. Reload once after that signal
  // so this document navigation can become both the route entry and the account's stand-in shell.
  await page.reload({ waitUntil: 'domcontentloaded' });
}

/**
 * `page.evaluate`, tolerating a transient "Execution context was destroyed" failure.
 *
 * @remarks
 * `expect.poll` retries when its callback returns a value that doesn't match yet, but NOT when
 * the callback throws — a rejection fails the whole poll on its first occurrence, regardless of
 * the configured timeout. On this dev stack (Turbopack lazy-compiling routes on demand), a
 * request landing right as the worker claims the page can still overlap a soft reload the
 * framework triggers once that on-demand compile finishes, destroying the execution context
 * `page.evaluate` is mid-read against. That is a timing accident, not a real result, so it is
 * retried here rather than left to abort every caller's `expect.poll` on the first unlucky read.
 */
async function evaluateResilient<T>(page: Page, fn: () => T | Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await page.evaluate(fn);
    } catch (err) {
      const destroyed =
        err instanceof Error && err.message.includes('Execution context was destroyed');
      if (!destroyed || attempt >= 5) throw err;
      await page.waitForTimeout(200);
    }
  }
}

/**
 * Every cache entry the worker currently holds, keyed by cache name.
 *
 * @remarks
 * Read through `expect.poll` by the callers rather than after a fixed sleep. Caches are populated
 * asynchronously as requests complete, so any single timeout is either flaky or needlessly slow —
 * and a cache assertion that samples too early passes for the wrong reason.
 */
async function cacheContents(page: Page): Promise<Record<string, string[]>> {
  return evaluateResilient(page, async () => {
    const names = await caches.keys();
    const out: Record<string, string[]> = {};
    for (const name of names) {
      const cache = await caches.open(name);
      out[name] = (await cache.keys()).map((request) => new URL(request.url).pathname);
    }
    return out;
  });
}

test.describe('PWA installability', () => {
  test('serves a manifest a browser will accept for install', async ({ page, request }) => {
    await page.goto('/sign-in');

    const response = await request.get('/manifest.webmanifest');
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('manifest');

    const manifest = (await response.json()) as {
      start_url: string;
      scope: string;
      display: string;
      icons: { sizes: string; purpose?: string }[];
    };

    // `/` is the marketing route group, so an installed app launching there would open the
    // marketing site instead of the product.
    expect(manifest.start_url).toBe('/today');
    expect(manifest.scope).toBe('/');
    expect(manifest.display).toBe('standalone');

    // Chrome requires a 192px and a 512px icon before it will offer an install prompt, and a
    // maskable variant is what stops Android's crop clipping the mark.
    const sizes = manifest.icons.map((icon) => icon.sizes);
    expect(sizes).toContain('192x192');
    expect(sizes).toContain('512x512');
    expect(manifest.icons.some((icon) => icon.purpose === 'maskable')).toBe(true);
  });

  test('links the manifest and declares a theme colour per scheme', async ({ page }) => {
    await page.goto('/sign-in');

    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
      'href',
      '/manifest.webmanifest',
    );
    // A single theme colour would leave installed window chrome mismatched in one of the two
    // schemes, since the app's canvas differs between them.
    await expect(page.locator('meta[name="theme-color"][media*="light"]')).toHaveCount(1);
    await expect(page.locator('meta[name="theme-color"][media*="dark"]')).toHaveCount(1);
    // Without viewport-fit=cover the shell's safe-area insets all resolve to zero.
    await expect(page.locator('meta[name="viewport"]')).toHaveAttribute(
      'content',
      /viewport-fit=cover/,
    );
    // Four Apple assets, not one: Safari picks by declared size, and the set is exported from the
    // committed Icon Composer document (see tests/pwa/apple-icons.test.ts).
    const appleIcons = page.locator('link[rel="apple-touch-icon"]');
    await expect(appleIcons).toHaveCount(4);
    for (const size of ['120x120', '152x152', '167x167', '180x180']) {
      await expect(page.locator(`link[rel="apple-touch-icon"][sizes="${size}"]`)).toHaveCount(1);
    }
  });

  test('serves every Apple icon it advertises', async ({ page, request }) => {
    await page.goto('/sign-in');
    const hrefs = await page
      .locator('link[rel="apple-touch-icon"]')
      .evaluateAll((links) =>
        links.map((link) => (link as HTMLLinkElement).getAttribute('href') ?? ''),
      );
    expect(hrefs.length).toBe(4);
    for (const href of hrefs) {
      const response = await request.get(href);
      expect(response.status(), `${href} should resolve`).toBe(200);
      expect(response.headers()['content-type']).toContain('image/png');
    }
  });

  test('every icon the manifest advertises actually resolves', async ({ request }) => {
    const manifest = (await (await request.get('/manifest.webmanifest')).json()) as {
      icons: { src: string }[];
    };

    for (const icon of manifest.icons) {
      const response = await request.get(icon.src);
      expect(response.status(), `${icon.src} should resolve`).toBe(200);
      expect(response.headers()['content-type']).toContain('image/png');
    }
  });
});

test.describe('offline behaviour', () => {
  test('registers a worker that takes control and precaches the offline page', async ({ page }) => {
    await loadControlled(page, '/sign-in');

    // Polled for the same reason every other cache assertion in this file is: the precache fills
    // asynchronously as the worker claims the page, so a single read samples an arbitrary moment
    // — and, via evaluateResilient, tolerates landing on a destroyed execution context rather
    // than failing the whole poll on the first unlucky read.
    await expect
      .poll(
        async () =>
          evaluateResilient(page, async () => {
            const names = await caches.keys();
            const precacheName = names.find((name) => name.startsWith('docket-precache-'));
            if (!precacheName) return [];
            const cache = await caches.open(precacheName);
            return (await cache.keys()).map((request) => new URL(request.url).pathname).sort();
          }),
        { message: 'the worker should precache the offline page' },
      )
      .toContain('/offline.html');
  });

  test('serves the offline page for a navigation with no network, keeping the URL', async ({
    page,
    context,
  }) => {
    await loadControlled(page, '/sign-in');

    await context.setOffline(true);
    try {
      await page.goto('/today', { waitUntil: 'domcontentloaded' });

      await expect(page.getByRole('heading', { name: /offline|reach Docket/i })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Reload' })).toBeVisible();
      // The requested URL is preserved on purpose: this is a waiting room, so reloading once the
      // connection returns lands on the real route rather than stranding someone.
      expect(new URL(page.url()).pathname).toBe('/today');
    } finally {
      await context.setOffline(false);
    }
  });

  test('never caches API or auth traffic', async ({ page }) => {
    // The security floor. If an authenticated response ever entered Cache Storage, the worker would
    // need per-user cache partitioning and sign-out would have to purge it — neither of which it
    // does, precisely because this holds.
    await loadControlled(page, '/sign-in');

    // Poll rather than sample once: this must hold at every moment, not merely at one arbitrary
    // instant after a sleep.
    await expect
      .poll(async () =>
        Object.values(await cacheContents(page))
          .flat()
          .filter((path) => path.startsWith('/v1') || path.startsWith('/api/auth')),
      )
      .toEqual([]);
  });

  test('precaches build output in production', async ({ page }) => {
    await loadControlled(page, '/sign-in');
    await waitForProductionPrecache(page);
  });
});

/**
 * What an authenticated person sees when the network goes away.
 *
 * @remarks
 * Separate from the specs above because these need an account: the document cache is keyed on the
 * signed-in user and stores nothing at all until a page has named one, so none of this can be
 * exercised signed out — which is itself the security property `documents.ts` is built around.
 *
 * The claim under test is the one the whole feature exists to make: **the app shell stays on
 * screen**. Not a waiting room with a retry button, but Docket — its navigation, its workspace, its
 * tab bar — with the requested route rendered from what was already cached.
 */
test.describe('offline with a session', () => {
  test('keeps the shell for a route that has no document of its own', async ({ page, context }) => {
    // The case that matters most and used to fail: most routes are parameterized, so a route nobody
    // opened online is the normal case rather than the edge one.
    await signUpAndOnboard(page, 'offline-shell');
    await loadControlledForAccount(page, '/today');
    await expect(page.getByRole('navigation', { name: 'Home' })).toBeVisible();

    await context.setOffline(true);
    try {
      await page.goto('/tasks', { waitUntil: 'domcontentloaded' });

      // The shell, not offline.html. The waiting room has no navigation at all, so this single
      // assertion separates the two outcomes.
      await expect(page.getByRole('navigation', { name: 'Home' })).toBeVisible();
      expect(new URL(page.url()).pathname).toBe('/tasks');
    } finally {
      await context.setOffline(false);
    }
  });

  test('stores the document it served as a stand-in shell, keyed on the account', async ({
    page,
  }) => {
    await signUpAndOnboard(page, 'offline-key');
    await loadControlledForAccount(page, '/today');

    await expect
      .poll(
        async () =>
          Object.entries(await cacheContents(page))
            .filter(([name]) => name.startsWith('docket-documents-'))
            .flatMap(([, paths]) => paths),
        { message: 'a served document should also become the stand-in shell' },
      )
      .toContain('/__docket-offline-shell');
  });

  test('never lets an offline click become a document load', async ({ page, context }) => {
    // A document load offline is what tore the running application down: Next's RSC fetch fails and
    // the router falls back to a full navigation. Marking the window and finding the mark still
    // there proves the document survived the click.
    await signUpAndOnboard(page, 'offline-nav');
    await loadControlledForAccount(page, '/today');

    await context.setOffline(true);
    try {
      await page.evaluate(() => {
        (window as unknown as { __docketDocument?: number }).__docketDocument = 1;
      });

      await page.getByRole('link', { name: 'Tasks' }).first().click();

      await expect.poll(() => new URL(page.url()).pathname).toBe('/tasks');
      const survived = await page.evaluate(
        () => (window as unknown as { __docketDocument?: number }).__docketDocument,
      );
      expect(survived, 'the document was replaced, so the shell was torn down').toBe(1);
    } finally {
      await context.setOffline(false);
    }
  });
});
