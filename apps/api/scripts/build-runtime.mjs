import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workspaceRoot = resolve(apiRoot, '../..');
const releaseVersion = JSON.parse(
  readFileSync(resolve(workspaceRoot, 'package.json'), 'utf8'),
).version;

const shared = {
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
  bundle: true,
  define: { __DOCKET_VERSION__: JSON.stringify(releaseVersion) },
  format: 'esm',
  platform: 'node',
  target: 'node24',
  packages: 'bundle',
  external: ['@electric-sql/pglite'],
  sourcemap: true,
};

await Promise.all([
  build({
    ...shared,
    entryPoints: [resolve(apiRoot, 'src/server.ts')],
    outfile: resolve(apiRoot, 'dist/server.mjs'),
  }),
  build({
    ...shared,
    entryPoints: [resolve(workspaceRoot, 'packages/db/src/migrate.ts')],
    outfile: resolve(workspaceRoot, 'packages/db/dist/migrate.mjs'),
  }),
]);
