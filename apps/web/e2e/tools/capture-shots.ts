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
 *   tsx e2e/tools/capture-shots.ts --session=<path> --out=<dir> --scenarios=<json>
 *
 * Named scenario files contain an array of `CaptureScenario` records (see capture-scenarios.ts).
 * Each record declares a route, ordered accessible interactions, optional readiness target, and
 * explicitly labelled loading/error interception. Per-frame fixture requests use the standard
 * dev-stack API_URL, and substitute response fields such as {{created.data.id}}. No browser-code
 * evaluation is accepted. Native dialog actions arm the next dialog before the triggering action;
 * browser chrome itself is outside page screenshots. --allow-state=loading|error also works for
 * ordinary route captures. --continue-on-error records the first failed frame per state to
 * --failures=<jsonl> (default: <out>/failures.jsonl), skips its remaining frames, and exits 1
 * after capturing the rest of the state matrix. Existing rendering, viewport, theme, and overflow checks still apply.
 *
 * Example:
 *   tsx e2e/tools/capture-shots.ts --session=playwright/.auth/dev-session.json \
 *     --out=.data/design-review/2026-07-06 /today /orgs/:orgId/agents /orgs/:orgId/athena
 *
 *   # Another app in the same stack — the session cookie spans `.docket.localhost`.
 *   tsx e2e/tools/capture-shots.ts --session=playwright/.auth/dev-session.json \
 *     --base-url=http://<prefix>.admin.docket.localhost:1355 --out=.data/admin /users /audit
 */
import { chromium } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

import { visitBlueprintDailyPlanner } from '../helpers/work-template-blueprints';
import { createMobileAuditFixture } from '../helpers/mobile-audit-fixture';
import type { MobileAuditFixture } from '../helpers/mobile-audit-fixture';
import {
  MOBILE_LAYOUT_ROUTE_CASES,
  type MobileLayoutRouteCase,
} from '../helpers/mobile-layout-audit-cases';
import { assertLocalCaptureBaseUrl } from './capture-policy';
import { parseCaptureArgs, type CliArgs } from './capture-cli';
import {
  applyCaptureScenario,
  installCaptureMocks,
  parseCaptureScenarios,
  prepareCaptureScenario,
  type CaptureScenario,
} from './capture-scenarios';

interface SessionMeta {
  email: string;
  orgId: string;
  sharedOrgId?: string;
  mobileAuditFixture?: MobileAuditFixture;
  baseURL: string;
}

interface CaptureCase extends MobileLayoutRouteCase {
  scenario?: CaptureScenario;
}

/** The mobile remediation matrix: four viewports × two color schemes. */
const VIEWPORTS = [
  { label: '1440x900', width: 1440, height: 900 },
  { label: '390x844', width: 390, height: 844 },
  { label: '320x844', width: 320, height: 844 },
  { label: '390x600', width: 390, height: 600 },
];
const COLOR_SCHEMES: ('light' | 'dark')[] = ['light', 'dark'];

/** Replace stable local audit fixture tokens in a route case. */
function resolveAuditRoute(
  route: string,
  meta: SessionMeta,
  sharedOrgId: string | undefined,
): string {
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
async function waitForSettledPage(page: Page, allowLoading = false): Promise<void> {
  await page.waitForFunction(() => document.body.innerText.trim().length > 0);
  await page.waitForFunction(
    () => {
      // Next can commit the route document before its generated utility stylesheet finishes
      // loading. A screenshot at that point is plain HTML and says nothing about the product's
      // layout, so wait for both a rendered utility and the app's typeface before accepting it.
      const layoutRoot = document.querySelector<HTMLElement>('[class~="flex"]');
      return (
        layoutRoot !== null &&
        getComputedStyle(layoutRoot).display === 'flex' &&
        getComputedStyle(document.body).fontFamily.includes('IBM Plex Sans')
      );
    },
    undefined,
    { timeout: 20_000 },
  );
  await page.evaluate(async () => document.fonts.ready);
  if (allowLoading) return;
  const waitForNoLoadingState = (): Promise<unknown> =>
    page.waitForFunction(
      () => {
        const loadingText = /\bLoading(?: your)? [^\n]*…/i.test(document.body.innerText);
        return (
          !loadingText &&
          [...document.querySelectorAll('[data-schedule-measuring]')].every(
            (element) => element.getClientRects().length === 0,
          ) &&
          document.querySelector('[data-calendar-page] h1[aria-label="Calendar"]') === null &&
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

/**
 * Navigate to a review route and fail before capture when the surface did not resolve.
 *
 * @param page - The page to navigate.
 * @param url - The absolute route URL.
 * @param allowSignIn - Whether landing on `/sign-in` is the intended capture rather than a failure.
 */
async function openReviewRoute(
  page: Page,
  url: string,
  allowSignIn = false,
  allowState?: CliArgs['allowState'],
): Promise<void> {
  // Next development builds a route on its first request. Billing took 30.4 seconds on a cold
  // compile, which exceeded Playwright's default navigation timeout even though the route returned
  // 200. DOM readiness plus the explicit settled-page check below gives cold routes the same
  // 60-second budget as the e2e helpers without waiting on background requests to become idle.
  const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  if (!response?.ok()) {
    throw new Error(`Could not capture ${url}: HTTP ${String(response?.status() ?? 'unknown')}`);
  }
  if (!allowSignIn && page.url().includes('/sign-in')) {
    throw new Error(`Could not capture ${url}: the saved test session is no longer authenticated`);
  }
  if (
    new URL(url).pathname.includes('/settings/') &&
    !/\/(?:settings\/templates|work-templates)\/[^/]+\/?$/.test(new URL(url).pathname)
  ) {
    await page.locator('[role="dialog"]').waitFor({ state: 'visible', timeout: 20_000 });
  }
  await waitForSettledPage(page, allowState === 'loading');
  const failure = await page.evaluate(() => {
    const visibleText = document.body.innerText;
    return /(?:this page doesn['’]t exist|page unavailable|application error|could not load)/i.test(
      visibleText,
    );
  });
  if (failure && allowState !== 'error') {
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
async function captureCleanFrame(options: {
  context: BrowserContext;
  url: string;
  viewport: (typeof VIEWPORTS)[number];
  colorScheme: (typeof COLOR_SCHEMES)[number];
  setup?: MobileLayoutRouteCase['setup'];
  allowSignIn: boolean;
  scenario: CaptureScenario | undefined;
  allowState: CliArgs['allowState'];
  failureArtifact: string;
}): Promise<Buffer> {
  const { context, url, viewport, colorScheme, setup, allowSignIn, scenario, allowState } = options;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const page = await context.newPage();
    try {
      await page.setViewportSize(viewport);
      const device = await context.newCDPSession(page);
      await device.send('Emulation.setTouchEmulationEnabled', {
        enabled: viewport.width < 640,
        maxTouchPoints: 1,
      });
      await page.emulateMedia({ colorScheme });
      const prepared = scenario ? await prepareCaptureScenario(page, scenario) : undefined;
      if (prepared) await installCaptureMocks(page, prepared);
      const resolvedUrl = prepared ? `${new URL(url).origin}${prepared.route}` : url;
      const permittedState = prepared?.allowState ?? allowState;
      await openReviewRoute(page, resolvedUrl, allowSignIn, permittedState);
      if (setup) await setup(page);
      if (prepared) {
        await applyCaptureScenario(page, prepared);
        await waitForSettledPage(page, permittedState === 'loading');
      }
      const overflow = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }));
      if (overflow.scrollWidth > overflow.clientWidth) {
        throw new Error(
          `${url} overflows at ${viewport.label} (${String(overflow.scrollWidth)} > ${String(overflow.clientWidth)})`,
        );
      }
      const candidate = await page.screenshot({ type: 'png' });
      const damaged = (await blackPixelRatio(page, candidate)) > 0.02;
      if (!damaged) return candidate;
      console.warn(
        `[capture-shots] discarded black-tiled frame (${url}, attempt ${String(attempt)})`,
      );
    } catch (error: unknown) {
      await recordFailedCapture(page, options.failureArtifact);
      throw error;
    } finally {
      await page.close();
    }
  }
  throw new Error(`Could not capture a clean frame after four attempts: ${url}`);
}

/** Save diagnostic frames separately; failed captures never become accepted gallery evidence. */
async function recordFailedCapture(page: Page, prefix: string): Promise<void> {
  await page.screenshot({ path: `${prefix}.failed.png`, timeout: 5_000 }).catch(() => undefined);
  const text = await page
    .locator('body')
    .innerText({ timeout: 2_000 })
    .catch(() => '[body unavailable]');
  writeFileSync(`${prefix}.failed.txt`, `${page.url()}\n\n${text}`);
}

/**
 * The shared workspace id, building one only when a route actually needs it.
 *
 * @remarks
 * The workspace exists to resolve `:orgId`/`:sharedOrgId` tokens and the mobile audit's fixture
 * routes, and building it requires an authenticated *product* document. A capture naming no such
 * token — a plain route list, or another app in the stack — must neither pay for it nor fail on
 * `/today` when that is not a route the app under capture serves.
 *
 * @param options - The authenticated context, the session metadata, and whether a route needs it.
 * @returns the shared workspace id, or `undefined` when none was needed.
 */
async function resolveSharedWorkspace(options: {
  context: BrowserContext;
  meta: SessionMeta;
  needed: boolean;
}): Promise<string | undefined> {
  const { context, meta, needed } = options;
  if (!needed || meta.sharedOrgId !== undefined) return meta.sharedOrgId;

  const setupPage = await context.newPage();
  // Settings can complete a client redirect after its document first settles. The audit fixture
  // uses page.evaluate for authenticated same-origin writes, so that redirect destroys its
  // execution context mid-request. Today is a stable authenticated document and needs no profile
  // route transition before the local-only fixture is created.
  const setupResponse = await setupPage.goto(`${meta.baseURL}/today`, {
    waitUntil: 'domcontentloaded',
  });
  if (!setupResponse?.ok() || setupPage.url().includes('/sign-in')) {
    throw new Error('Could not open an authenticated setup document for the mobile audit fixture');
  }
  await setupPage.waitForTimeout(500);
  const orgId = (await createMobileAuditFixture(setupPage)).orgId;
  await setupPage.close();
  return orgId;
}

function captureCases({
  audit,
  start,
  limit,
  routes,
  clickButton,
  clickRow,
  clickMenuItem,
  clickTab,
  clickAfter,
  scenarios,
}: CliArgs): readonly CaptureCase[] {
  if (scenarios) {
    return parseCaptureScenarios(JSON.parse(readFileSync(scenarios, 'utf8')))
      .slice(start, limit === undefined ? undefined : start + limit)
      .map((scenario) => ({
        id: scenario.id,
        route: scenario.route,
        ...(scenario.authenticated === undefined ? {} : { authenticated: scenario.authenticated }),
        scenario,
      }));
  }
  if (audit)
    return MOBILE_LAYOUT_ROUTE_CASES.slice(start, limit === undefined ? undefined : start + limit);
  return routes.map((route) => ({
    id: routeSlug(route),
    route,
    setup:
      clickButton || clickRow || clickTab || clickAfter.length
        ? async (page: Page): Promise<void> => {
            if (clickButton)
              await page.getByRole('button', { name: clickButton, exact: true }).click();
            if (clickRow)
              await page
                .getByRole('row')
                .filter({ has: page.getByText(clickRow, { exact: true }) })
                .click();
            if (clickMenuItem)
              await page.getByRole('menuitem', { name: clickMenuItem, exact: true }).click();
            if (clickTab) await page.getByRole('tab', { name: clickTab, exact: true }).click();
            for (const name of clickAfter)
              await page.getByRole('button', { name, exact: true }).click();
            await waitForSettledPage(page);
          }
        : undefined,
  }));
}

async function prepareAuthoringCapture(
  context: BrowserContext,
  baseURL: string,
  cases: readonly MobileLayoutRouteCase[],
): Promise<void> {
  if (
    !cases.some((entry) =>
      /^\/orgs\/[^/]+\/(?:settings\/templates|work-templates)(?:\/[^/]+)?\/?$/.test(
        entry.route.split(/[?#]/)[0] ?? '',
      ),
    )
  )
    return;
  const preparation = await context.newPage();
  await preparation.goto(baseURL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await visitBlueprintDailyPlanner(preparation);
  await preparation.close();
}

/** Record the first failed frame without admitting its diagnostics to the accepted shot set. */
function reportCaptureFailure(
  options: CliArgs,
  entry: CaptureCase,
  {
    viewport,
    colorScheme,
  }: { viewport: (typeof VIEWPORTS)[number]; colorScheme: (typeof COLOR_SCHEMES)[number] },
  error: unknown,
): void {
  const outDir = options.outDir;
  const message = error instanceof Error ? error.message : String(error);
  appendFileSync(
    options.failures ?? `${outDir}/failures.jsonl`,
    `${JSON.stringify({
      caseId: entry.id,
      route: entry.route,
      viewport,
      colorScheme,
      error: message,
      failureArtifact: `${outDir}/failures/${entry.id}-${viewport.label}-${colorScheme}`,
    })}\n`,
  );
  console.error(`[capture-shots] state failed; skipping remaining frames: ${entry.id}: ${message}`);
}

/** Capture the selected state matrix with stable frame filenames and an optional receipt stream. */
async function captureSelectedCases({
  options,
  selectedCases,
  context,
  anonymousContext,
  meta,
  sharedOrgId,
}: {
  options: CliArgs;
  selectedCases: readonly CaptureCase[];
  context: BrowserContext;
  anonymousContext: BrowserContext;
  meta: SessionMeta;
  sharedOrgId: string | undefined;
}): Promise<number> {
  const { frameStart, frameLimit, outDir, records } = options;
  let failureCount = 0;
  const selectedFrames = VIEWPORTS.flatMap((viewport) =>
    COLOR_SCHEMES.map((colorScheme) => ({ viewport, colorScheme })),
  ).slice(frameStart, frameLimit === undefined ? undefined : frameStart + frameLimit);
  for (const entry of selectedCases) {
    // Every capture uses a fresh Page so Chromium cannot carry damaged compositor tiles from one
    // responsive/theme capture set into the next surface.
    const path = resolveAuditRoute(entry.route, meta, sharedOrgId);
    const slug = entry.id;
    const entryContext = entry.authenticated === false ? anonymousContext : context;
    for (const { viewport, colorScheme } of selectedFrames) {
      try {
        const file = `${outDir}/${slug}-${viewport.label}-${colorScheme}.png`;
        const frame = await captureCleanFrame({
          context: entryContext,
          url: `${meta.baseURL}${path}`,
          viewport,
          colorScheme,
          setup: entry.setup,
          allowSignIn: entry.authenticated === false,
          scenario: entry.scenario ? { ...entry.scenario, route: path } : undefined,
          allowState: options.allowState,
          failureArtifact: `${outDir}/failures/${entry.id}-${viewport.label}-${colorScheme}`,
        });
        writeFileSync(file, frame);
        if (records) {
          appendFileSync(
            records,
            `${JSON.stringify({
              caseId: entry.id,
              route: entry.route,
              viewport,
              colorScheme,
              file,
              ...(entry.scenario ? { scenario: entry.scenario } : {}),
            })}\n`,
          );
        }
        console.log(`[capture-shots] ${file}`);
      } catch (error: unknown) {
        if (!options.continueOnError) throw error;
        failureCount += 1;
        reportCaptureFailure(options, entry, { viewport, colorScheme }, error);
        break;
      }
    }
  }
  return failureCount;
}

async function main(): Promise<void> {
  const options = parseCaptureArgs(process.argv.slice(2));
  const { session, outDir, baseURL, audit, start, limit, frameStart, frameLimit } = options;
  const meta = JSON.parse(readFileSync(`${session}.meta.json`, 'utf8')) as SessionMeta;
  // Apply the override first, then assert: `--base-url` points at another app in the same local
  // stack, so it must still satisfy the same locality check as the session's own origin.
  if (baseURL !== undefined) meta.baseURL = baseURL;
  assertLocalCaptureBaseUrl(meta.baseURL);
  if (audit && (!Number.isInteger(start) || start < 0)) {
    throw new Error('capture-shots: --start must be a non-negative integer');
  }
  if (audit && limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
    throw new Error('capture-shots: --limit must be a positive integer');
  }
  if (
    !Number.isInteger(frameStart) ||
    frameStart < 0 ||
    frameStart >= VIEWPORTS.length * COLOR_SCHEMES.length
  ) {
    throw new Error('capture-shots: --frame-start must select one of the eight audit frames');
  }
  if (frameLimit !== undefined && (!Number.isInteger(frameLimit) || frameLimit <= 0)) {
    throw new Error('capture-shots: --frame-limit must be a positive integer');
  }
  const selectedCases = captureCases(options);
  if (selectedCases.length === 0) {
    throw new Error('capture-shots: the selected audit route set is empty');
  }

  mkdirSync(outDir, { recursive: true });
  mkdirSync(`${outDir}/failures`, { recursive: true });

  // GPU compositing occasionally returns a vertically shifted bitmap on this host even though the
  // page DOM and its bounding rectangles are correct. Audit evidence must show the rendered page,
  // not that compositor corruption, so use Chromium's software path for every captured frame.
  const browser = await chromium.launch({ args: ['--disable-gpu', '--disable-gpu-compositing'] });
  // This is an online product audit. A persisted service worker can serve its offline fallback
  // after the local dev process restarts, which turns a capture into recovery-UI evidence instead
  // of the route it was asked to inspect. Offline behavior has its own dedicated browser suite.
  const context = await browser.newContext({
    storageState: session,
    ignoreHTTPSErrors: true,
    serviceWorkers: 'block',
  });
  const anonymousContext = await browser.newContext({
    ignoreHTTPSErrors: true,
    serviceWorkers: 'block',
  });
  let sharedOrgId = await resolveSharedWorkspace({
    context,
    meta,
    needed: audit || selectedCases.some((entry) => /:(?:orgId|sharedOrgId)\b/.test(entry.route)),
  });

  const needsFixture = selectedCases.some((entry) =>
    /:(?:projectId|cycleId|initiativeId|programId|actorId|taskId|teamId|seriesId|sessionId)\b/.test(
      entry.route,
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

  await prepareAuthoringCapture(context, meta.baseURL, selectedCases);

  const failureCount = await captureSelectedCases({
    options,
    selectedCases,
    context,
    anonymousContext,
    meta,
    sharedOrgId,
  });
  await browser.close();
  if (failureCount > 0)
    throw new Error(`${String(failureCount)} capture states failed; inspect failures.jsonl`);
}

main().catch((error: unknown) => {
  console.error('[capture-shots] failed:', error);
  process.exit(1);
});
