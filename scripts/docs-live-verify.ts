/** Confirm the documentation site is reachable through the product domain after a release. */
import { resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  checkDocs,
  DOCS_CHECK_NAMES,
  verifyProduction,
  writeReportAndExit,
  type Fetcher,
  type ProductionCheck,
} from './production-verify';

/**
 * How many times the docs probe runs before the site is called broken.
 *
 * @remarks
 * Vercel promotes the web build only once the `deploy-api` job's check passes
 * (`docs/engineering/deployment.md`), so a release-triggered run can arrive while the promotion is
 * still in flight and read the previous build. Ten attempts a half-minute apart covers that window
 * without turning a genuine outage into a five-minute wait for most runs, because a healthy site
 * passes on the first attempt and never sleeps at all.
 */
const DEFAULT_ATTEMPTS = 10;

/** Pause between docs probes, in milliseconds. */
const DEFAULT_DELAY_MS = 30_000;

/** Tuning and boundary seams for {@link verifyDocsLive}. */
export interface DocsVerificationOptions {
  /** Maximum docs probes before reporting failure. Defaults to {@link DEFAULT_ATTEMPTS}. */
  readonly attempts?: number;
  /** Milliseconds between probes. Defaults to {@link DEFAULT_DELAY_MS}. */
  readonly delayMs?: number;
  /** Delay implementation. Tests supply one that resolves immediately. */
  readonly sleep?: (milliseconds: number) => Promise<void>;
}

/** Outcome of a live documentation check, split by whether a failure fails the run. */
export interface DocsVerificationReport {
  /** ISO timestamp the report was produced at. */
  readonly generatedAt: string;
  /** Whether every gating check passed. Advisory results never affect this. */
  readonly passed: boolean;
  /** How many docs probes ran, including the one that settled the outcome. */
  readonly attempts: number;
  /** Documentation checks. A failure here fails the run. */
  readonly gating: readonly ProductionCheck[];
  /** The rest of the public production surface, reported without gating the run. */
  readonly advisory: readonly ProductionCheck[];
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((settle) => setTimeout(settle, milliseconds));
}

/**
 * Probe the docs site until every check passes or the attempts run out.
 *
 * @remarks
 * Retrying absorbs a promotion still in flight and a transient CDN blip; it cannot mask a
 * misconfigured rewrite, because a destination that does not resolve fails identically every time.
 *
 * @param fetcher - Fetch implementation.
 * @param options - Attempt count, delay, and the delay implementation.
 * @returns The final check results and how many attempts it took to reach them.
 */
export async function pollDocs(
  fetcher: Fetcher,
  options: DocsVerificationOptions = {},
): Promise<{ checks: ProductionCheck[]; attempts: number }> {
  const limit = Math.max(1, options.attempts ?? DEFAULT_ATTEMPTS);
  const delayMs = options.delayMs ?? DEFAULT_DELAY_MS;
  const wait = options.sleep ?? sleep;

  let checks: ProductionCheck[] = [];
  for (let attempt = 1; attempt <= limit; attempt += 1) {
    checks = await checkDocs(fetcher);
    if (checks.every((check) => check.passed)) return { checks, attempts: attempt };
    if (attempt < limit) await wait(delayMs);
  }
  return { checks, attempts: limit };
}

/**
 * Verify the live documentation site, and report the rest of the public surface alongside it.
 *
 * @remarks
 * Only the documentation checks gate. The remaining checks come from the same
 * {@link verifyProduction} pass that `pnpm launch:verify-prod` runs, so this reports the whole
 * public surface while keeping an unrelated API-contract wobble from failing a release that
 * shipped working docs.
 *
 * @param fetcher - Fetch implementation. Tests supply a deterministic boundary double.
 * @param options - Polling configuration.
 * @returns A report whose `passed` reflects the documentation checks alone.
 */
export async function verifyDocsLive(
  fetcher: Fetcher = fetch,
  options: DocsVerificationOptions = {},
): Promise<DocsVerificationReport> {
  const docs = await pollDocs(fetcher, options);
  const full = await verifyProduction(fetcher);
  return {
    generatedAt: new Date().toISOString(),
    passed: docs.checks.every((check) => check.passed),
    attempts: docs.attempts,
    gating: docs.checks,
    advisory: full.checks.filter((check) => !DOCS_CHECK_NAMES.includes(check.name)),
  };
}

function line(label: string, check: ProductionCheck): string {
  return `${label}\t${check.name}\t${check.detail}\n`;
}

/**
 * Render a report as the tab-separated lines the workflow log shows.
 *
 * @param report - The report to render.
 * @returns The full report text, ending in a newline.
 */
export function formatReport(report: DocsVerificationReport): string {
  const gating = report.gating.map((check) => line(check.passed ? 'PASS' : 'FAIL', check));
  const advisory = report.advisory.map((check) => line(check.passed ? 'PASS' : 'WARN', check));
  return [
    `documentation (gating, settled after ${String(report.attempts)} attempt(s))\n`,
    ...gating,
    'rest of the public surface (advisory)\n',
    ...advisory,
  ].join('');
}

async function main(): Promise<void> {
  const report = await verifyDocsLive();
  await writeReportAndExit(formatReport(report), report.passed);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await main();
