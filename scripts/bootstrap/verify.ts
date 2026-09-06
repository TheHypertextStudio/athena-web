import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { parseEnvFile } from '../env-file';

import { validateLocalConfig } from './local-config';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * Verify the configuration portion of Docket bootstrap.
 *
 * @param target - Local or production verification boundary.
 * @param root - Repository root; injectable for fixtures.
 * @returns a process-compatible exit status.
 */
export function verifyDocketConfig(target: 'local' | 'production', root = ROOT): number {
  if (target === 'production') {
    console.error(
      'Production application acceptance is not yet automated; run the documented production smoke test.',
    );
    return 7;
  }
  const diagnostics = validateLocalConfig(parseEnvFile(resolve(root, '.env.local')));
  for (const issue of diagnostics) {
    console.error(`FAIL ${issue.id}: ${issue.message}`);
    console.error(`  ${issue.recovery}`);
  }
  if (diagnostics.length > 0) return 8;
  console.log('PASS local.config verified');
  return 0;
}

function main(): void {
  const target = process.argv[2];
  if (target !== 'local' && target !== 'production') {
    console.error('usage: scripts/bootstrap-verify {local|production}');
    process.exit(6);
  }
  process.exit(verifyDocketConfig(target));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main();
