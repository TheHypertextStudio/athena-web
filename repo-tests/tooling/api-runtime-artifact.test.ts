import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '../..');

function source(path: string): string {
  return readFileSync(resolve(ROOT, path), 'utf8');
}

describe('production API runtime artifact', () => {
  it('builds JavaScript into the image and starts it without a TypeScript loader', () => {
    const buildScript = source('apps/api/scripts/build-runtime.mjs');
    const dockerfile = source('apps/api/Dockerfile');
    const manifest = JSON.parse(source('apps/api/package.json')) as {
      scripts?: Record<string, string>;
    };
    const mcpServer = source('apps/api/src/mcp/server.ts');

    expect(manifest.scripts?.['build:runtime']).toBe('node scripts/build-runtime.mjs');
    expect(manifest.scripts?.['start']).toBe('node dist/server.mjs');
    expect(dockerfile).toContain('pnpm --filter @docket/api build:runtime');
    expect(dockerfile).toContain('CMD ["node", "dist/server.mjs"]');
    expect(dockerfile).not.toMatch(/CMD \[[^\n]*(?:tsx|\.ts")/u);
    expect(buildScript).toContain('__DOCKET_RELEASE_VERSION__');
    expect(buildScript).toContain("readFileSync(resolve(workspaceRoot, 'package.json'), 'utf8')");
    expect(mcpServer).toContain('typeof __DOCKET_RELEASE_VERSION__');
    expect(mcpServer).not.toContain("from '../../../../package.json'");
  });

  it('runs production migrations from the prebuilt JavaScript artifact', () => {
    const deployment = source('.github/workflows/deploy.yml');

    expect(deployment).toContain('node /app/packages/db/dist/migrate.mjs');
    expect(deployment).not.toContain('node --import=tsx/esm /app/packages/db/src/migrate.ts');
  });
});
