/**
 * Capture the final staff billing surfaces and enforce responsive and keyboard checks.
 *
 * Run from `apps/web` with an authenticated Better Auth storage state:
 * `tsx e2e/tools/capture-admin-billing-launch.ts --session=<path> --org-id=<id> --out=<dir>`.
 */
import { chromium, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const args = new Map(
  process.argv.slice(2).map((argument) => {
    const [key, ...value] = argument.replace(/^--/, '').split('=');
    return [key, value.join('=')];
  }),
);
const session = resolve(args.get('session') ?? 'playwright/.auth/dev-session.json');
const orgId = args.get('org-id');
const outDir = resolve(args.get('out') ?? '.data/billing-launch-evidence');
const baseURL =
  args.get('base-url') ?? process.env['ADMIN_BASE_URL'] ?? 'https://admin.docket.localhost';

if (!orgId) throw new Error('Pass --org-id=<organization id>');

const routes = [
  { label: 'paid-organization', path: `/orgs/${orgId}` },
  { label: 'discount-queue', path: '/discounts' },
];
const viewports = [
  { label: 'desktop', width: 1440, height: 900 },
  { label: 'mobile', width: 390, height: 844 },
];
const themes = ['light', 'dark'] as const;

/** Wait until the route has rendered its data instead of a loading placeholder. */
async function waitForSettledPage(page: Page): Promise<void> {
  await page.waitForFunction(
    () =>
      document.body.innerText.trim().length > 0 &&
      document.querySelector('.animate-pulse') === null &&
      document.querySelector('[data-slot="skeleton"]') === null,
    undefined,
    { timeout: 20_000 },
  );
  await page.evaluate(async () => document.fonts.ready);
  await page.waitForTimeout(300);
}

/** Prove that keyboard focus reaches named actions on the rendered route. */
async function checkKeyboardAndNames(page: Page): Promise<void> {
  const unnamed = await page.locator('a, button, input, select, textarea').evaluateAll((elements) =>
    elements
      .filter((element) => {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0;
      })
      .filter((element) => {
        const text = element.textContent.trim();
        const label = element.getAttribute('aria-label');
        const labelledBy = element.getAttribute('aria-labelledby');
        const title = element.getAttribute('title');
        const placeholder = element.getAttribute('placeholder');
        const nativeLabels =
          'labels' in element && element.labels
            ? Array.from(element.labels as NodeListOf<HTMLLabelElement>).some((nativeLabel) =>
                Boolean(nativeLabel.textContent.trim()),
              )
            : false;
        return !text && !label && !labelledBy && !title && !placeholder && !nativeLabels;
      })
      .map((element) => element.outerHTML.slice(0, 160)),
  );
  if (unnamed.length > 0) {
    throw new Error(`Visible controls without names: ${unnamed.join(' | ')}`);
  }

  await page.locator('body').click({ position: { x: 1, y: 1 } });
  await page.keyboard.press('Tab');
  const focused = await page.evaluate(() => {
    const element = document.activeElement;
    return element !== null && element !== document.body && element !== document.documentElement;
  });
  if (!focused) throw new Error('Tab did not move focus to a control');
}

async function main(): Promise<void> {
  mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({ storageState: session, ignoreHTTPSErrors: true });

  for (const route of routes) {
    for (const viewport of viewports) {
      for (const theme of themes) {
        const page = await context.newPage();
        await page.setViewportSize(viewport);
        await page.emulateMedia({ colorScheme: theme });
        const response = await page.goto(`${baseURL}${route.path}`, {
          waitUntil: 'domcontentloaded',
          timeout: 60_000,
        });
        if (!response?.ok() || page.url().includes('/sign-in')) {
          throw new Error(`Could not open ${route.path} with the saved staff session`);
        }
        await waitForSettledPage(page);
        await checkKeyboardAndNames(page);
        const image = await page.screenshot({ type: 'png', fullPage: true });
        const file = `${outDir}/${route.label}-${viewport.label}-${theme}.png`;
        writeFileSync(file, image);
        console.log(`[billing-launch] captured ${file}`);
        await page.close();
      }
    }

    const page = await context.newPage();
    await page.setViewportSize({ width: 320, height: 844 });
    await page.goto(`${baseURL}${route.path}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await waitForSettledPage(page);
    const width = await page.evaluate(() => ({
      client: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    if (width.scroll > width.client) {
      throw new Error(`${route.path} overflows at 320px (${width.scroll} > ${width.client})`);
    }
    console.log(`[billing-launch] 320px overflow check passed for ${route.path}`);
    await page.close();
  }

  await browser.close();
}

await main();
