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
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';

import { VAR_REGISTRY } from '../packages/env/src/registry';

/** Minimal `.env` parser (KEY=VALUE, `#` comments, optional quotes) — no dependency. */
function loadEnvFile(file: string): void {
  let text: string;
  try {
    text = readFileSync(resolve(process.cwd(), file), 'utf8');
  } catch {
    return; // file absent — fine
  }
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] ??= value;
  }
}

function main(): void {
  // Layer local overrides first, then the committed example as a fallback.
  loadEnvFile('.env.local');
  loadEnvFile('.env');

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
