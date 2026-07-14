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
 * A route may contain the literal placeholder `:orgId`, substituted from the session's metadata
 * sidecar (`<session>.meta.json`, written by `dev-session.ts`).
 *
 * Usage (from `apps/web`):
 *   tsx e2e/tools/capture-shots.ts --session=<path> --out=<dir> <route> [<route> ...]
 *
 * Example:
 *   tsx e2e/tools/capture-shots.ts --session=playwright/.auth/dev-session.json \
 *     --out=.data/design-review/2026-07-06 /today /orgs/:orgId/agents /orgs/:orgId/athena
 */
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
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

async function main(): Promise<void> {
  const { session, outDir, routes } = parseArgs(process.argv.slice(2));
  const meta = JSON.parse(readFileSync(`${session}.meta.json`, 'utf8')) as SessionMeta;

  mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({ storageState: session, ignoreHTTPSErrors: true });
  const page = await context.newPage();

  for (const route of routes) {
    const path = route.replace(':orgId', meta.orgId);
    const slug = routeSlug(route);
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport);
      for (const colorScheme of COLOR_SCHEMES) {
        await page.emulateMedia({ colorScheme });
        await page.goto(`${meta.baseURL}${path}`, { waitUntil: 'networkidle' });
        await page.waitForFunction(() => document.body.innerText.trim().length > 0);
        await page.evaluate(async () => document.fonts.ready);
        await page.waitForTimeout(1500); // settle client data, layout, and theme transitions
        const file = `${outDir}/${slug}-${viewport.label}-${colorScheme}.png`;
        await page.screenshot({ path: file });
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
