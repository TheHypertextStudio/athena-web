import { cp, readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

import { assertWorkerArtifactConfig } from '../apps/web/worker-artifact-config';

// Product artifact assembly only; shared release-engineering owns provider deployment/seeding.
const source: unknown = JSON.parse(await readFile('wrangler.jsonc', 'utf8'));
const prebuilt: unknown = JSON.parse(await readFile('wrangler.site.jsonc', 'utf8'));
assertWorkerArtifactConfig(source, prebuilt);
await rm('.artifact', { recursive: true, force: true });
const result = spawnSync(
  'pnpm',
  [
    'exec',
    'wrangler',
    'deploy',
    '--dry-run',
    '--config',
    'wrangler.jsonc',
    '--env',
    'staging',
    '--env-file',
    '/dev/null',
    '--autoconfig=false',
    '--outdir',
    '.artifact',
  ],
  { stdio: 'inherit' },
);
if (result.error) throw result.error;
if (result.status !== 0) throw new Error('Workers artifact bundling failed');
await cp('.open-next/assets', '.artifact/.open-next/assets', { recursive: true });
await cp(
  '.open-next/.build/open-next.config.edge.mjs',
  '.artifact/.open-next/.build/open-next.config.edge.mjs',
);
await cp('.open-next/cache', '.artifact/.open-next/cache', { recursive: true });
await cp('wrangler.site.jsonc', '.artifact/wrangler.site.jsonc');
