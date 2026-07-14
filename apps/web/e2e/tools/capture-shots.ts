/**
 * `pnpm --filter @docket/web exec tsx e2e/tools/capture-shots.ts` — capture the design-review
 * skill's "standard shot set" (1440×900 + 390×844, light + dark) for a list of routes, using a
 * session saved by {@link file://./dev-session.ts}.
 *
 * @remarks
 * The `design-review` skill (`.claude/skills/design-review/SKILL.md`) expects screenshots of
 * every audited surface at two viewports and both color schemes. Authenticated, org-scoped
 * surfaces (Today, an agent session, the Athena chat thread) can't be reached by a fresh
 * unauthenticated browser tab — this tool loads the storage state {@link file://./dev-session.ts}
 * persisted, so it drives an already-signed-in session instead of repeating the passkey ceremony
 * per capture.
 *
 * A route may contain `:orgId` (the personal audit workspace) or `:sharedOrgId`. The shared
 * workspace is discovered or created through the authenticated test session, so a complete
 * Settings audit never requires manual setup or another sign-in ceremony.
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

interface SessionMeta {
  email: string;
  orgId: string;
  baseURL: string;
}

interface CliArgs {
  session: string;
  outDir: string;
  routes: string[];
}

interface OrgSummary {
  readonly id: string;
  readonly name: string;
  readonly isPersonal: boolean;
}

/** The design-review skill's standard shot set: two viewports × two color schemes. */
const VIEWPORTS = [
  { label: '1440x900', width: 1440, height: 900 },
  { label: '390x844', width: 390, height: 844 },
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
  if (routes.length === 0) {
    throw new Error('capture-shots: pass at least one route, e.g. /today');
  }
  return {
    session: resolve(flags.get('session') ?? 'playwright/.auth/dev-session.json'),
    outDir: resolve(flags.get('out') ?? '.data/design-review-shots'),
    routes,
  };
}

/** A filesystem-safe name for a route, e.g. `/orgs/:orgId/athena` → `orgs-orgId-athena`. */
function routeSlug(route: string): string {
  return route.replace(/^\/+|\/+$/g, '').replace(/[/:]+/g, '-') || 'root';
}

/** Wait until client data and loading placeholders have resolved. */
async function waitForSettledPage(page: Page): Promise<void> {
  await page.waitForFunction(() => document.body.innerText.trim().length > 0);
  await page.evaluate(async () => document.fonts.ready);
  await page.waitForFunction(
    () => {
      const loadingText = /\bLoading(?: your)? [^\n]*…/i.test(document.body.innerText);
      return !loadingText && document.querySelector('.animate-pulse') === null;
    },
    undefined,
    { timeout: 20_000 },
  );
  await page.waitForTimeout(500);
}

/** Navigate to a review route and fail before capture when the surface did not resolve. */
async function openReviewRoute(page: Page, url: string): Promise<void> {
  const response = await page.goto(url, { waitUntil: 'networkidle' });
  if (!response?.ok()) {
    throw new Error(`Could not capture ${url}: HTTP ${String(response?.status() ?? 'unknown')}`);
  }
  if (page.url().includes('/sign-in')) {
    throw new Error(`Could not capture ${url}: the saved test session is no longer authenticated`);
  }
  await waitForSettledPage(page);
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

/** Resolve a reusable shared workspace, creating one through the authenticated test session. */
async function ensureSharedWorkspace(page: Page, baseURL: string): Promise<string> {
  await openReviewRoute(page, `${baseURL}/settings/workspaces`);
  return page.evaluate(async () => {
    const listResponse = await fetch('/v1/orgs');
    if (!listResponse.ok) throw new Error('Could not list audit workspaces');
    const list = (await listResponse.json()) as { items: OrgSummary[] };
    const existing = list.items.find(
      (workspace) => !workspace.isPersonal && workspace.name === 'Settings Audit Workspace',
    );
    if (existing) return existing.id;

    const createResponse = await fetch('/v1/orgs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Settings Audit Workspace',
        purpose: 'Visual verification for workspace administration.',
        vocabulary: 'startup',
      }),
    });
    if (!createResponse.ok) throw new Error('Could not create the shared audit workspace');
    const created = (await createResponse.json()) as { organization: { id: string } };
    return created.organization.id;
  });
}

async function main(): Promise<void> {
  const { session, outDir, routes } = parseArgs(process.argv.slice(2));
  const meta = JSON.parse(readFileSync(`${session}.meta.json`, 'utf8')) as SessionMeta;

  mkdirSync(outDir, { recursive: true });

  for (const route of routes) {
    // A fresh browser per route avoids Chromium carrying damaged compositor tiles from one
    // responsive/theme capture set into the next surface.
    const browser = await chromium.launch();
    const context = await browser.newContext({ storageState: session, ignoreHTTPSErrors: true });
    const setupPage = await context.newPage();
    const sharedOrgId = route.includes(':sharedOrgId')
      ? await ensureSharedWorkspace(setupPage, meta.baseURL)
      : null;
    await setupPage.close();
    const path = route
      .replaceAll(':orgId', meta.orgId)
      .replaceAll(':sharedOrgId', sharedOrgId ?? meta.orgId);
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
    const page = await context.newPage();
    await page.setViewportSize({ width: 320, height: 844 });
    await page.emulateMedia({ colorScheme: 'light' });
    await openReviewRoute(page, `${meta.baseURL}${path}`);
    const overflow = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    if (overflow.scrollWidth > overflow.clientWidth) {
      throw new Error(
        `${path} overflows at 320px (${String(overflow.scrollWidth)} > ${String(overflow.clientWidth)})`,
      );
    }
    await page.close();
    console.log(`[capture-shots] 320px overflow check passed: ${path}`);
    await browser.close();
  }
}

main().catch((error: unknown) => {
  console.error('[capture-shots] failed:', error);
  process.exit(1);
});
