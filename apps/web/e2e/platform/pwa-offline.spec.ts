import { type Page, expect, test } from '@playwright/test';

/**
 * Installability and offline behaviour, end to end against the running dev stack.
 *
 * @remarks
 * These specs need no account: everything asserted here — the manifest, the worker, the caching
 * rules, the offline fallback — is the same for a signed-out visitor as a signed-in one, and
 * deliberately so. Offline support has to be installed *before* it is needed, so the worker
 * registers on every route rather than only inside the authenticated shell.
 *
 * The suite runs against `pnpm dev`, which builds a **development** worker. That is the
 * interesting case to pin: a development worker must not cache build output, because Turbopack
 * rebuilds dev chunks in place and caching them would serve stale code and break hot reload.
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
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1);
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
      await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
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

  test('does not cache build output in development', async ({ page }) => {
    // Turbopack rebuilds dev chunks in place, so caching them would serve stale code. This is what
    // makes the worker safe to register in development at all.
    await loadControlled(page, '/sign-in');

    // Reload so the page actually requests its chunks through the now-active worker; a "stays
    // empty" assertion only means something once the traffic it would have cached has happened.
    await page.reload();

    await expect
      .poll(async () => {
        const caches = await cacheContents(page);
        const staticEntry = Object.entries(caches).find(([name]) =>
          name.startsWith('docket-static-'),
        );
        return staticEntry ? staticEntry[1].length : 0;
      })
      .toBe(0);
  });
});
