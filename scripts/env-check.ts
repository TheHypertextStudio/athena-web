/**
 * `pnpm env:check` — validate the environment contract and explain the first failure.
 *
 * @remarks
 * Walks the single-source {@link VAR_REGISTRY}, parses each var with its own zod
 * schema, and on the first failing **required** var prints the var name + its
 * `where` hint and exits non-zero. A complete dev env exits 0. This validates
 * without importing a composition (which would throw on the first missing var and
 * hide the rest), so the report can name the offending var precisely.
 */
import { resolve } from 'node:path';
import process from 'node:process';

import { VAR_REGISTRY } from '../packages/env/src/registry';

import { loadEnvFile } from './env-file';

function main(): void {
  // Layer local overrides first, then the committed example as a fallback.
  loadEnvFile(resolve(process.cwd(), '.env.local'));
  loadEnvFile(resolve(process.cwd(), '.env'));

  const failures: { name: string; where: string; reason: string }[] = [];

  for (const spec of VAR_REGISTRY) {
    const raw = process.env[spec.name];
    const present = raw !== undefined && raw !== '';
    if (!present) {
      if (spec.required) {
        failures.push({ name: spec.name, where: spec.where, reason: 'missing (required)' });
      }
      continue;
    }
    const result = spec.zod.safeParse(raw);
    if (!result.success) {
      failures.push({
        name: spec.name,
        where: spec.where,
        reason: result.error.issues.map((i) => i.message).join('; '),
      });
    }
  }

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
