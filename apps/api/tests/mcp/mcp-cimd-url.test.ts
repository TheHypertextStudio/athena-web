import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { CimdDeps } from '../../src/mcp/cimd';
import type * as CimdModule from '../../src/mcp/cimd';

let cimd: typeof CimdModule;

beforeAll(async () => {
  cimd = await import('../../src/mcp/cimd');
});

function deps(metadata: Record<string, unknown>, addresses = ['93.184.216.34']): CimdDeps {
  return {
    resolveHost: vi.fn(async () => addresses.map((address) => ({ address, family: 4 as const }))),
    fetchJson: vi.fn(async () => metadata),
  };
}

describe('CIMD client_id URL validation', () => {
  it('rejects a client_id that does not parse as a URL at all', async () => {
    await expect(
      cimd.resolveCimdClient('not a url', deps({ client_id: 'not a url', redirect_uris: [] })),
    ).rejects.toMatchObject({ code: 'invalid_client' });
  });

  it('rejects a client_id URL carrying credentials or a fragment', async () => {
    await expect(
      cimd.resolveCimdClient(
        'https://user:pass@allowed.example/client.json',
        deps({ client_id: 'https://user:pass@allowed.example/client.json', redirect_uris: [] }),
      ),
    ).rejects.toMatchObject({ code: 'invalid_client' });
    await expect(
      cimd.resolveCimdClient(
        'https://allowed.example/client.json#frag',
        deps({ client_id: 'https://allowed.example/client.json#frag', redirect_uris: [] }),
      ),
    ).rejects.toMatchObject({ code: 'invalid_client' });
  });

  it('rejects a client_id whose host is a raw IP rather than a DNS name', async () => {
    await expect(
      cimd.resolveCimdClient(
        'https://93.184.216.34/client.json',
        deps({ client_id: 'https://93.184.216.34/client.json', redirect_uris: [] }),
      ),
    ).rejects.toMatchObject({ code: 'invalid_client' });
  });
});

describe('CIMD private-network resolution guard', () => {
  const CLIENT_ID = 'https://allowed.example/client.json';
  const validDoc = {
    client_id: CLIENT_ID,
    redirect_uris: ['https://allowed.example/callback'],
  };

  it('refuses when DNS resolves to no addresses at all', async () => {
    await expect(cimd.resolveCimdClient(CLIENT_ID, deps(validDoc, []))).rejects.toMatchObject({
      code: 'invalid_client',
    });
  });

  it.each([
    ['loopback', '127.0.0.1'],
    ['this-network', '0.5.5.5'],
    ['shared-nat', '100.64.0.1'],
    ['link-local', '169.254.1.1'],
    ['private-16', '172.16.0.1'],
    ['private-24', '192.168.1.1'],
    ['benchmarking', '198.18.0.1'],
    ['documentation-3', '198.51.100.1'],
    ['documentation-1', '192.0.2.1'],
    ['documentation-2', '203.0.113.5'],
    ['multicast', '224.0.0.1'],
  ])('refuses an IPv4 %s address (%s)', async (_label, address) => {
    await expect(
      cimd.resolveCimdClient(CLIENT_ID, deps(validDoc, [address])),
    ).rejects.toMatchObject({ code: 'invalid_client' });
  });

  it('accepts an ordinary public IPv4 address', async () => {
    await expect(
      cimd.resolveCimdClient(CLIENT_ID, deps(validDoc, ['93.184.216.34'])),
    ).resolves.toMatchObject({ clientId: CLIENT_ID });
  });

  it.each([
    ['unspecified', '::'],
    ['loopback', '::1'],
    ['unique-local-fc', 'fc00::1'],
    ['unique-local-fd', 'fd12::1'],
    ['link-local-fe8', 'fe80::1'],
    ['link-local-fea', 'fea0::1'],
    ['multicast', 'ff02::1'],
    ['documentation', '2001:db8::1'],
    ['v4-mapped private', '::ffff:127.0.0.1'],
  ])('refuses an IPv6 %s address (%s)', async (_label, address) => {
    const d: CimdDeps = {
      resolveHost: vi.fn(async () => [{ address, family: 6 as const }]),
      fetchJson: vi.fn(async () => validDoc),
    };
    await expect(cimd.resolveCimdClient(CLIENT_ID, d)).rejects.toMatchObject({
      code: 'invalid_client',
    });
  });

  it('accepts an ordinary public IPv6 address, including a v4-mapped public one', async () => {
    for (const address of ['2606:4700:4700::1111', '::ffff:93.184.216.34']) {
      const d: CimdDeps = {
        resolveHost: vi.fn(async () => [{ address, family: 6 as const }]),
        fetchJson: vi.fn(async () => validDoc),
      };
      await expect(cimd.resolveCimdClient(CLIENT_ID, d)).resolves.toMatchObject({
        clientId: CLIENT_ID,
      });
    }
  });

  it('refuses when only one of several resolved addresses is private', async () => {
    await expect(
      cimd.resolveCimdClient(CLIENT_ID, deps(validDoc, ['93.184.216.34', '10.0.0.1'])),
    ).rejects.toMatchObject({ code: 'invalid_client' });
  });
});
