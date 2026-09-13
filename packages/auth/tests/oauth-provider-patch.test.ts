import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { readFile, realpath } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const providerEntry = require.resolve('@better-auth/oauth-provider');
const providerRequire = createRequire(providerEntry);

describe('pinned OAuth provider runtime patch', () => {
  it('pins the reviewed provider release and preserves Promise.all failure ordering while draining siblings', async () => {
    const packageRoot = resolve(dirname(providerEntry), '..');
    const metadata = JSON.parse(await readFile(resolve(packageRoot, 'package.json'), 'utf8')) as {
      version: string;
    };
    const installed = await readFile(providerEntry, 'utf8');

    expect(metadata.version).toBe('1.6.19');
    expect(installed).toContain('const tokenOutcome = Promise.all(tokenPromises)');
    expect(installed).toContain('await Promise.allSettled(tokenPromises)');
    expect(installed).toContain('if ("error" in outcome) throw outcome.error');
    expect(installed.indexOf('Promise.allSettled(tokenPromises)')).toBeLessThan(
      installed.indexOf('if ("error" in outcome) throw outcome.error'),
    );
    expect(installed).not.toContain('reserveVerificationValue');
  });

  it('uses one physical Better Auth core context across Docket and the provider', async () => {
    const directContext = await realpath(require.resolve('@better-auth/core/context'));
    const providerContext = await realpath(providerRequire.resolve('@better-auth/core/context'));

    expect(providerContext).toBe(directContext);
  });
});
