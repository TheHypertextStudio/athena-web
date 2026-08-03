/**
 * `@docket/api` — CIMD trust allowlist, non-strict mode.
 *
 * @remarks
 * Isolated in its own file (rather than added to `mcp-cimd.test.ts`) because it needs
 * `MCP_CIMD_STRICT` unset for its whole module graph, including `env`'s own module-scope parse —
 * flipping that env var mid-file via `vi.resetModules()` was observed to leave the rest of that
 * file's shared `db`/`cimd` bindings in an inconsistent state. A fresh test file gets its own
 * module registry for free.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { CimdDeps } from '../../src/mcp/cimd';
import type * as CimdModule from '../../src/mcp/cimd';
import { getMigratedDb } from '../support/db';

let cimd!: typeof CimdModule;

beforeAll(async () => {
  vi.stubEnv('MCP_CIMD_STRICT', '');
  await getMigratedDb();
  cimd = await import('../../src/mcp/cimd');
});

function deps(metadata: Record<string, unknown>, addresses = ['93.184.216.34']): CimdDeps {
  return {
    resolveHost: vi.fn(async () => addresses.map((address) => ({ address, family: 4 as const }))),
    fetchJson: vi.fn(async () => metadata),
  };
}

describe('CIMD trust allowlist, non-strict mode', () => {
  it('skips the allowlist check entirely and accepts an otherwise-unlisted host', async () => {
    await expect(
      cimd.resolveCimdClient(
        'https://outside.example/client.json',
        deps({
          client_id: 'https://outside.example/client.json',
          redirect_uris: ['https://outside.example/callback'],
        }),
      ),
    ).resolves.toMatchObject({ clientId: 'https://outside.example/client.json' });
  });

  it('still enforces the private-network guard even when the allowlist is off', async () => {
    await expect(
      cimd.resolveCimdClient(
        'https://outside.example/client.json',
        deps(
          {
            client_id: 'https://outside.example/client.json',
            redirect_uris: ['https://outside.example/callback'],
          },
          ['10.0.0.1'],
        ),
      ),
    ).rejects.toMatchObject({ code: 'invalid_client' });
  });
});
