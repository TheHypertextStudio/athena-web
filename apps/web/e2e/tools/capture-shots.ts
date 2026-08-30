/**
 * `pnpm --filter @docket/web exec tsx e2e/tools/capture-shots.ts` — capture the design-review
 * skill's responsive shot set (desktop, phone, narrow phone, and short phone in light and dark)
 * for a list of routes, using a session saved by {@link file://./dev-session.ts}.
 *
 * @remarks
 * The `design-review` skill (`.claude/skills/design-review/SKILL.md`) expects screenshots of
 * every audited surface at two viewports and both color schemes. Authenticated, org-scoped
 * surfaces (Today, an agent session, the Athena chat thread) can't be reached by a fresh
 * unauthenticated browser tab — this tool loads the storage state {@link file://./dev-session.ts}
 * persisted, so it drives an already-signed-in session instead of repeating the passkey ceremony
 * per capture.
 *
 * A route may contain `:orgId` (the personal audit workspace) or `:sharedOrgId`. The tool creates
 * one complete, entitled local audit workspace through the authenticated test session, so every
 * shared route has the records its responsive states need.
 *
 * Usage (from `apps/web`):
 *   tsx e2e/tools/capture-shots.ts --session=<path> --out=<dir> <route> [<route> ...]
 *
 * Example:
 *   tsx e2e/tools/capture-shots.ts --session=playwright/.auth/dev-session.json \
 *     --out=.data/design-review/2026-07-06 /today /orgs/:orgId/agents /orgs/:orgId/athena
 */
import { chromium } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { createMobileAuditFixture } from '../helpers/mobile-audit-fixture';
import type { MobileAuditFixture } from '../helpers/mobile-audit-fixture';
import { MOBILE_LAYOUT_ROUTE_CASES } from '../helpers/mobile-layout-audit-cases';
import { TIMEOUTS } from '../helpers/constants';

interface SessionMeta {
  email: string;
  orgId: string;
  sharedOrgId?: string;
  mobileAuditFixture?: MobileAuditFixture;
  baseURL: string;
}

interface CliArgs {
  session: string;
  outDir: string;
  routes: string[];
  audit: boolean;
  start: number;
  limit?: number;
}

/** The mobile remediation matrix: four viewports × two color schemes. */
const VIEWPORTS = [
  { label: '1440x900', width: 1440, height: 900 },
  { label: '390x844', width: 390, height: 844 },
  { label: '320x844', width: 320, height: 844 },
  { label: '390x600', width: 390, height: 600 },
];
const COLOR_SCHEMES: ('light' | 'dark')[] = ['light', 'dark'];

function parseArgs(argv: string[]): CliArgs {
  const flags = new Map<string, string>();
  const routes: string[] = [];
  for (const arg of argv) {
    const match = /^--([^=]+)=(.*)$/.exec(arg);
    if (match) {
      const [, key, value] = match;
      if (key !== undefined && value !== undefined) flags.set(key, value);
    } else {
      routes.push(arg);
    }
  }
  const audit = argv.includes('--audit');
  if (!audit && routes.length === 0) {
    throw new Error('capture-shots: pass at least one route, e.g. /today');
  }
  return {
    session: resolve(flags.get('session') ?? 'playwright/.auth/dev-session.json'),
    outDir: resolve(flags.get('out') ?? '.data/design-review-shots'),
    routes,
    audit,
    start: flags.has('start') ? Number.parseInt(flags.get('start') ?? '', 10) : 0,
    limit: flags.has('limit') ? Number.parseInt(flags.get('limit') ?? '', 10) : undefined,
  };
}

/** Replace stable local audit fixture tokens in a route case. */
function resolveAuditRoute(route: string, meta: SessionMeta, sharedOrgId: string): string {
  const fixture = meta.mobileAuditFixture;
  const values: Record<string, string | undefined> = {
    orgId: meta.orgId,
    sharedOrgId,
    projectId: fixture?.projectId,
    cycleId: fixture?.cycleId,
    initiativeId: fixture?.initiativeId,
    programId: fixture?.programId,
    actorId: fixture?.personId,
    taskId: fixture?.taskId,
    teamId: fixture?.teamId,
    seriesId: fixture?.recurrenceSeriesId,
    sessionId: fixture?.agentSessionId,
  };
  return route.replace(/:([A-Za-z][A-Za-z0-9]*)/g, (token, name: string) => {
    const value = values[name];
    if (value === undefined) {
      throw new Error(
        `capture-shots: ${token} requires --with-mobile-audit-fixture session metadata`,
      );
    }
    return value;
  });
}

/** A filesystem-safe name for a route, e.g. `/orgs/:orgId/athena` → `orgs-orgId-athena`. */
function routeSlug(route: string): string {
  return route.replace(/^\/+|\/+$/g, '').replace(/[/:]+/g, '-') || 'root';
}

/** Wait until client data and loading placeholders have resolved. */
async function waitForSettledPage(page: Page): Promise<void> {
  await page.waitForFunction(() => document.body.innerText.trim().length > 0);
  await page.evaluate(async () => document.fonts.ready);
  const waitForNoLoadingState = (): Promise<unknown> =>
    page.waitForFunction(
      () => {
        const loadingText = /\bLoading(?: your)? [^\n]*…/i.test(document.body.innerText);
        return (
          !loadingText &&
          document.querySelector('.animate-pulse') === null &&
          document.querySelector('[data-slot="skeleton"]') === null
        );
      },
      undefined,
      { timeout: 20_000 },
    );
  await waitForNoLoadingState();
  // A lazy settings panel can mount its query skeleton after the route shell first reports no
  // loading state. Require the resolved state to survive one render window before capture.
  await page.waitForTimeout(500);
  await waitForNoLoadingState();
}

/** Navigate to a review route and fail before capture when the surface did not resolve. */
async function openReviewRoute(page: Page, url: string): Promise<void> {
  // Next development builds a route on its first request. Billing took 30.4 seconds on a cold
  // compile, which exceeded Playwright's default navigation timeout even though the route returned
  // 200. DOM readiness plus the explicit settled-page check below gives cold routes the same
  // 60-second budget as the e2e helpers without waiting on background requests to become idle.
  const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  if (!response?.ok()) {
    throw new Error(`Could not capture ${url}: HTTP ${String(response?.status() ?? 'unknown')}`);
  }
  if (page.url().includes('/sign-in')) {
    throw new Error(`Could not capture ${url}: the saved test session is no longer authenticated`);
  }
  if (new URL(url).pathname.includes('/settings/')) {
    await page.locator('[role="dialog"]').waitFor({ state: 'visible', timeout: 20_000 });
  }
  await waitForSettledPage(page);
  const failure = await page.evaluate(() => {
    const visibleText = document.body.innerText;
    return /(?:this page doesn['’]t exist|page unavailable|application error|could not load)/i.test(
      visibleText,
    );
  });
  if (failure) {
    throw new Error(`Could not capture ${url}: the route rendered an application failure state`);
  }
}

/** Measure exact-black pixels in a PNG so damaged Chromium compositor tiles can be rejected. */
async function blackPixelRatio(page: Page, png: Buffer): Promise<number> {
  return page.evaluate(async (base64) => {
    const binary = atob(base64);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Could not inspect screenshot pixels');
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
    let black = 0;
    let sampled = 0;
    for (let index = 0; index < pixels.length; index += 16) {
      sampled += 1;
      const red = pixels[index] ?? 255;
      const green = pixels[index + 1] ?? 255;
      const blue = pixels[index + 2] ?? 255;
      if (red < 3 && green < 3 && blue < 3) black += 1;
    }
    return black / sampled;
  }, png.toString('base64'));
}

/** Capture one integrity-checked frame, recreating the page when Chromium emits black tiles. */
async function captureCleanFrame(
  context: BrowserContext,
  url: string,
  viewport: (typeof VIEWPORTS)[number],
  colorScheme: (typeof COLOR_SCHEMES)[number],
): Promise<Buffer> {
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const page = await context.newPage();
    await page.setViewportSize(viewport);
    await page.emulateMedia({ colorScheme });
    await openReviewRoute(page, url);
    const overflow = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    if (overflow.scrollWidth > overflow.clientWidth) {
      throw new Error(
        `${url} overflows at ${viewport.label} (${String(overflow.scrollWidth)} > ${String(overflow.clientWidth)})`,
      );
    }
    await page.screenshot({ type: 'png' });
    await page.waitForTimeout(150);
    const candidate = await page.screenshot({ type: 'png' });
    const damaged = (await blackPixelRatio(page, candidate)) > 0.02;
    await page.close();
    if (!damaged) return candidate;
    console.warn(
      `[capture-shots] discarded black-tiled frame (${url}, attempt ${String(attempt)})`,
    );
  }
  throw new Error(`Could not capture a clean frame after four attempts: ${url}`);
}

async function main(): Promise<void> {
  const { session, outDir, routes, audit, start, limit } = parseArgs(process.argv.slice(2));
  const meta = JSON.parse(readFileSync(`${session}.meta.json`, 'utf8')) as SessionMeta;
  if (audit && (!Number.isInteger(start) || start < 0)) {
    throw new Error('capture-shots: --start must be a non-negative integer');
  }
  if (audit && limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
    throw new Error('capture-shots: --limit must be a positive integer');
  }
  const selectedRoutes = audit
    ? MOBILE_LAYOUT_ROUTE_CASES.slice(start, limit === undefined ? undefined : start + limit).map(
        (entry) => entry.route,
      )
    : routes;
  if (selectedRoutes.length === 0) {
    throw new Error('capture-shots: the selected audit route set is empty');
  }

  mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch();
  // This is an online product audit. A persisted service worker can serve its offline fallback
  // after the local dev process restarts, which turns a capture into recovery-UI evidence instead
  // of the route it was asked to inspect. Offline behavior has its own dedicated browser suite.
  const context = await browser.newContext({
    storageState: session,
    ignoreHTTPSErrors: true,
    serviceWorkers: 'block',
  });
  let sharedOrgId = meta.sharedOrgId;
  if (sharedOrgId === undefined) {
    const setupPage = await context.newPage();
    // Settings can complete a client redirect after its document first settles. The audit fixture
    // uses page.evaluate for authenticated same-origin writes, so that redirect destroys its
    // execution context mid-request. Today is a stable authenticated document and needs no profile
    // route transition before the local-only fixture is created.
    const setupResponse = await setupPage.goto(`${meta.baseURL}/today`, {
      waitUntil: 'domcontentloaded',
    });
    if (!setupResponse?.ok() || setupPage.url().includes('/sign-in')) {
      throw new Error(
        'Could not open an authenticated setup document for the mobile audit fixture',
      );
    }
    await setupPage.waitForTimeout(500);
    sharedOrgId = (await createMobileAuditFixture(setupPage)).orgId;
    await setupPage.close();
  }

  const needsFixture = selectedRoutes.some((route) =>
    /:(?:projectId|cycleId|initiativeId|programId|actorId|taskId|teamId|seriesId|sessionId)\b/.test(
      route,
    ),
  );
  if (needsFixture) {
    if (meta.mobileAuditFixture === undefined) {
      const setupPage = await context.newPage();
      const setupResponse = await setupPage.goto(`${meta.baseURL}/today`, {
        waitUntil: 'domcontentloaded',
      });
      if (!setupResponse?.ok() || setupPage.url().includes('/sign-in')) {
        throw new Error(
          'Could not open an authenticated setup document for the mobile audit fixture',
        );
      }
      await setupPage.waitForTimeout(500);
      meta.mobileAuditFixture = await createMobileAuditFixture(setupPage);
      writeFileSync(`${session}.meta.json`, JSON.stringify(meta, null, 2));
      await setupPage.close();
    }
    // Detail records only exist in the fixture workspace. A session can carry an older shared
    // workspace id for ordinary route captures, so dynamic audit routes must select this owner.
    sharedOrgId = meta.mobileAuditFixture.orgId;
  }

  for (const route of selectedRoutes) {
    // Every capture uses a fresh Page so Chromium cannot carry damaged compositor tiles from one
    // responsive/theme capture set into the next surface.
    const path = resolveAuditRoute(route, meta, sharedOrgId);
    const slug = routeSlug(route);
    for (const viewport of VIEWPORTS) {
      for (const colorScheme of COLOR_SCHEMES) {
        const file = `${outDir}/${slug}-${viewport.label}-${colorScheme}.png`;
        const frame = await captureCleanFrame(
          context,
          `${meta.baseURL}${path}`,
          viewport,
          colorScheme,
        );
        writeFileSync(file, frame);
        console.log(`[capture-shots] ${file}`);
      }
    }
  }
  await browser.close();
}

main().catch((error: unknown) => {
  console.error('[capture-shots] failed:', error);
  process.exit(1);
});
