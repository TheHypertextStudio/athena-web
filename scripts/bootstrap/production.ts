import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** Run Docket's existing guided production reconciler behind the standard project hook. */
export function reconcileDocketProduction(): number {
  if (process.env['CI'] === '1' && process.env['BOOTSTRAP_APPROVED'] !== '1') {
    console.error('Production setup needs approval. Re-run ./bootstrap production --yes.');
    return 2;
  }
  const result = spawnSync(
    'pnpm',
    ['exec', 'tsx', 'scripts/bootstrap.ts', '--skip-local', '--production'],
    { cwd: ROOT, env: process.env, stdio: 'inherit' },
  );
  if (result.error) {
    console.error(`Could not start Docket production setup: ${result.error.message}`);
    return 7;
  }
  return result.status ?? 5;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exit(reconcileDocketProduction());
}
