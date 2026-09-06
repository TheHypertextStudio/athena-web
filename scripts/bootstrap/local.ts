import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  reconcileLocalConfig,
  type LocalConfigOptions,
  type LocalConfigResult,
} from './local-config';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * Converge the Docket-owned portion of local bootstrap.
 *
 * @param root - Repository root; injectable for black-box fixtures.
 * @param overrides - Test-only platform and secret generation overrides.
 * @returns the shared local configuration result.
 */
export function reconcileDocketLocal(
  root = ROOT,
  overrides: Pick<LocalConfigOptions, 'platform' | 'generateSecret'> = {
    platform: process.platform === 'darwin' ? 'darwin' : 'linux',
  },
): LocalConfigResult {
  return reconcileLocalConfig({
    envPath: resolve(root, '.env.local'),
    examplePath: resolve(root, '.env.example'),
    platform: overrides.platform,
    ...(overrides.generateSecret ? { generateSecret: overrides.generateSecret } : {}),
  });
}

function main(): void {
  const result = reconcileDocketLocal();
  for (const issue of result.diagnostics) {
    console.error(`BLOCKED ${issue.id}: ${issue.message}`);
    console.error(`  ${issue.recovery}`);
  }
  if (result.diagnostics.length > 0) process.exit(8);
  console.log(result.changed ? 'CHANGE local.config reconciled' : 'PASS local.config converged');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main();
