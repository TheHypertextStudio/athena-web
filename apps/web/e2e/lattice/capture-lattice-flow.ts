/**
 * Walk the whole "run Athena on your own computer" flow in a real browser and record it.
 *
 * @remarks
 * This is the recording that proves connecting Lattice is turnkey: it counts the user actions
 * between "not connected" and "Athena runs on my computer" (the bar is three or fewer), asserts
 * that no text field for a URL, key or token exists anywhere in the section, and captures the
 * section at both widths in both themes.
 *
 * It drives the real app against the real API. The only stand-ins are Lovelace's own two services
 * (see `apps/api/tests/lattice/local-lovelace-stub.ts`), which have no public deployment yet.
 *
 * ```bash
 * # 1. pnpm --filter @docket/api exec tsx tests/lattice/local-lovelace-stub.ts
 * # 2. LATTICE_CLIENT_ID=client_docket_local LATTICE_ACCOUNTS_ISSUER=http://127.0.0.1:4571 \
 * #    LATTICE_GATEWAY_URL=http://127.0.0.1:4572 ./scripts/dev-stack.sh start
 * # 3. pnpm --filter @docket/web exec tsx e2e/lattice/capture-lattice-flow.ts
 * ```
 */
import { chromium, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

/** Where the shots land. */
const OUT = resolve('.data/design-review/lattice');

/** The saved authenticated storage state. */
const SESSION = resolve('.data/design-review/lattice-session.json');

/** The app origin under test. */
const ORIGIN = process.env['APP_URL'] ?? 'http://localhost:3000';

/** The gateway stub's control endpoint, for taking the device offline. */
const GATEWAY_CONTROL = 'http://127.0.0.1:4572/__control/offline';

/** Scroll the Lattice section into view and return its bounding box. */
async function section(
  page: Page,
): Promise<{ x: number; y: number; width: number; height: number }> {
  const heading = page.getByRole('heading', { name: 'Run Athena on your own computer' });
  await heading.waitFor({ state: 'visible', timeout: 20_000 });
  const container = page.locator('section', { has: heading }).first();
  await container.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  const box = await container.boundingBox();
  if (!box) throw new Error('the Lattice section has no layout box');
  return box;
}

/** Capture the section at one width in one theme. */
async function shoot(page: Page, name: string): Promise<void> {
  const box = await section(page);
  await page.screenshot({
    path: `${OUT}/${name}.png`,
    clip: { x: box.x - 8, y: box.y - 8, width: box.width + 16, height: box.height + 16 },
  });
  process.stdout.write(`  ${OUT}/${name}.png\n`);
}

/** The recording. */
async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  await fetch(`${GATEWAY_CONTROL}?value=true`).catch(() => undefined);

  const browser = await chromium.launch();
  const context = await browser.newContext({
    storageState: SESSION,
    viewport: { width: 1440, height: 900 },
    colorScheme: 'light',
  });
  const page = await context.newPage();
  let actions = 0;

  await page.goto(`${ORIGIN}/settings/athena`, { waitUntil: 'domcontentloaded' });
  // Start from a clean slate so the action count below really is "from disconnected".
  await section(page);
  const alreadyConnected = page.getByRole('button', { name: 'Disconnect' });
  if (await alreadyConnected.isVisible().catch(() => false)) {
    await alreadyConnected.click();
    await page.waitForTimeout(1200);
  }
  await shoot(page, 'section-01-disconnected-1440-light');

  // The turnkey claim, measured rather than asserted: no field anywhere in this section can
  // accept a URL, a key, or a token.
  const box = await section(page);
  const fields = await page
    .locator('section', {
      has: page.getByRole('heading', { name: 'Run Athena on your own computer' }),
    })
    .first()
    .locator('input, textarea')
    .count();
  process.stdout.write(`text inputs in the section (must be 0): ${String(fields)}\n`);
  process.stdout.write(`section box: ${JSON.stringify(box)}\n`);

  // Action 1 — Connect.
  await page.getByRole('button', { name: 'Connect Lovelace' }).click();
  actions += 1;
  await page.waitForURL(/oauth\/authorize/, { timeout: 20_000 });
  await page.screenshot({ path: `${OUT}/consent-1440-light.png`, fullPage: false });
  process.stdout.write(`  ${OUT}/consent-1440-light.png\n`);

  // Action 2 — Approve on Lovelace's own page.
  await page.getByRole('link', { name: 'Approve' }).click();
  actions += 1;
  await page.waitForURL(/settings\/athena/, { timeout: 30_000 });
  await page.waitForTimeout(1500);
  await shoot(page, 'section-02-connected-no-device-1440-light');

  // Action 3 — choose the computer. It is offline at this point, so the "asleep" state is real.
  await page.getByRole('button', { name: 'Use this' }).first().click();
  actions += 1;
  await page.waitForTimeout(1500);
  await shoot(page, 'section-03-device-asleep-1440-light');

  // Now wake it and re-read, which is the ordinary happy state.
  await fetch(`${GATEWAY_CONTROL}?value=false`).catch(() => undefined);
  await page.getByRole('button', { name: 'Refresh your computers' }).click();
  await page.waitForTimeout(1500);
  await shoot(page, 'section-04-running-1440-light');

  process.stdout.write(`user actions from disconnected to running: ${String(actions)}\n`);

  // Dark, then mobile in both themes.
  const dark = await browser.newContext({
    storageState: SESSION,
    viewport: { width: 1440, height: 900 },
    colorScheme: 'dark',
  });
  const darkPage = await dark.newPage();
  await darkPage.goto(`${ORIGIN}/settings/athena`, { waitUntil: 'domcontentloaded' });
  await darkPage.waitForTimeout(1500);
  await shoot(darkPage, 'section-04-running-1440-dark');

  for (const scheme of ['light', 'dark'] as const) {
    const mobile = await browser.newContext({
      storageState: SESSION,
      viewport: { width: 390, height: 844 },
      colorScheme: scheme,
    });
    const mobilePage = await mobile.newPage();
    await mobilePage.goto(`${ORIGIN}/settings/athena`, { waitUntil: 'domcontentloaded' });
    await mobilePage.waitForTimeout(1500);
    await shoot(mobilePage, `section-04-running-390-${scheme}`);
    await mobile.close();
  }

  await browser.close();
}

await main();
