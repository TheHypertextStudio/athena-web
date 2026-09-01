/**
 * `pnpm env:check` — validate the environment contract and explain the first failure.
 *
 * @remarks
 * Checks every surface against the single-source `VAR_REGISTRY` via {@link checkEnvForTarget},
 * parsing each var with its own zod schema, then prints the first failure with its `where` hint and
 * exits non-zero. A complete dev env exits 0. This validates without importing a composition (which
 * would throw on the first missing var and hide the rest), so the report can name the offending var
 * precisely.
 *
 * A local `.env.local` backs every surface at once, so this unions the issues across all targets and
 * de-duplicates them — a var shared by the api and the web app must be reported once, not four
 * times.
 */
import { resolve } from 'node:path';
import process from 'node:process';

import { ALL } from '../packages/env/src/registry-types';
import { checkEnvForTarget, type EnvIssue } from '../packages/env/src/registry';

import { loadEnvFile } from './env-file';

function main(): void {
  // Layer local overrides first, then the committed example as a fallback.
  loadEnvFile(resolve(process.cwd(), '.env.local'));
  loadEnvFile(resolve(process.cwd(), '.env'));

  const seen = new Map<string, EnvIssue>();
  for (const target of ALL) {
    for (const issue of checkEnvForTarget(target, process.env)) {
      if (!seen.has(issue.name)) seen.set(issue.name, issue);
    }
  }
  const failures = [...seen.values()];

  const [first, ...rest] = failures;
  if (!first) {
    console.log('✓ env:check — all required environment variables are present and valid.');
    process.exit(0);
  }

  console.error(`✗ env:check failed — ${failures.length} problem(s). First:\n`);
  console.error(`  ${first.name}: ${first.reason}`);
  console.error(`    where: ${first.where}`);
  if (rest.length > 0) {
    console.error(`\n  + ${rest.length} more: ${rest.map((f) => f.name).join(', ')}`);
  }
  process.exit(1);
}

main();
